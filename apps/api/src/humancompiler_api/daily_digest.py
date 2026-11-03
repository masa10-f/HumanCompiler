# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Daily digest: collect each user's digest and decide who gets it today.

The day and hour are Asia/Tokyo. A user gets at most one digest per JST day,
on the first run at or after their chosen hour, and only when it has new
proposals or tasks due soon. Failed sends are retried on later runs, up to
``MAX_FAILURES_PER_DAY`` a day.
"""

import logging
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from humancompiler_api.config import settings
from humancompiler_api.email_service import (
    DailyDigest,
    DigestProposal,
    DigestTask,
    EmailService,
)
from humancompiler_api.models import (
    AgentProposal,
    EmailNotificationLog,
    EmailNotificationStatus,
    EmailNotificationType,
    Goal,
    Project,
    ProposalStatus,
    QuickTask,
    Task,
    TaskStatus,
    User,
    UserSettings,
)
from humancompiler_api.proposal_service import (
    APP_TIMEZONE,
    pending_count,
    to_web_responses,
)

logger = logging.getLogger(__name__)

MAX_ITEMS = 20
UPCOMING_DAYS = 3
MAX_FAILURES_PER_DAY = 3

_OPEN_STATUSES = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]


def _as_utc(value: datetime) -> datetime:
    """Aware UTC; a naive value (SQLite read-back) is taken as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _jst_day_start(now: datetime, days_ahead: int = 0) -> datetime:
    """Start of the JST day ``days_ahead`` days after ``now``'s, as aware UTC."""
    day = now.astimezone(APP_TIMEZONE).date() + timedelta(days=days_ahead)
    return datetime.combine(day, time.min, tzinfo=APP_TIMEZONE).astimezone(UTC)


def _last_sent_at(session: Session, user_id: UUID) -> datetime | None:
    value = session.exec(
        select(func.max(EmailNotificationLog.sent_at)).where(
            EmailNotificationLog.user_id == user_id,
            EmailNotificationLog.notification_type
            == EmailNotificationType.DAILY_DIGEST,
            EmailNotificationLog.status == EmailNotificationStatus.SENT,
        )
    ).one()
    return _as_utc(value) if value is not None else None


def _new_proposals(
    session: Session, user_id: UUID, last_sent_at: datetime | None
) -> tuple[list[DigestProposal], int]:
    conditions = [
        AgentProposal.user_id == user_id,
        col(AgentProposal.status) == ProposalStatus.PENDING.value,
    ]
    if last_sent_at is not None:
        conditions.append(col(AgentProposal.created_at) > last_sent_at)

    total = session.exec(
        select(func.count()).select_from(AgentProposal).where(*conditions)
    ).one()
    rows = list(
        session.exec(
            select(AgentProposal)
            .where(*conditions)
            .order_by(col(AgentProposal.created_at).desc(), col(AgentProposal.id))
            .limit(MAX_ITEMS)
        ).all()
    )
    proposals = [
        DigestProposal(
            kind=response.kind.value,
            title=response.title,
            project_name=response.project_name,
            agent_name=response.agent_name,
        )
        for response in to_web_responses(session, user_id, rows)
    ]
    return proposals, total


def _task_context(task: Task) -> str | None:
    goal = task.goal
    if goal is None:
        return None
    if goal.project is None:
        return goal.title
    return f"{goal.project.title} > {goal.title}"


def _window_tasks(session: Session, user_id: UUID, now: datetime) -> list[DigestTask]:
    """Open tasks and quick tasks due before the JST day (today + 4), sorted."""
    window_end = _jst_day_start(now, UPCOMING_DAYS + 1)
    tasks = session.exec(
        select(Task)
        .join(Goal, col(Task.goal_id) == col(Goal.id))
        .join(Project, col(Goal.project_id) == col(Project.id))
        .where(
            Project.owner_id == user_id,
            col(Task.due_date).isnot(None),
            col(Task.due_date) < window_end,
            col(Task.status).in_(_OPEN_STATUSES),
        )
        .options(selectinload(Task.goal).selectinload(Goal.project))
    ).all()
    quick_tasks = session.exec(
        select(QuickTask).where(
            QuickTask.owner_id == user_id,
            col(QuickTask.due_date).isnot(None),
            col(QuickTask.due_date) < window_end,
            col(QuickTask.status).in_(_OPEN_STATUSES),
        )
    ).all()

    items: list[DigestTask] = []
    for task in tasks:
        if task.due_date is None:
            continue
        due = _as_utc(task.due_date)
        items.append(
            DigestTask(
                title=task.title,
                due_date=due,
                is_overdue=due < now,
                context=_task_context(task),
            )
        )
    for quick_task in quick_tasks:
        if quick_task.due_date is None:
            continue
        due = _as_utc(quick_task.due_date)
        items.append(
            DigestTask(
                title=quick_task.title, due_date=due, is_overdue=due < now, context=None
            )
        )
    items.sort(key=lambda item: (item.due_date, item.title))
    return items


def build_digest(session: Session, user_id: UUID, now: datetime) -> DailyDigest:
    """Collect one user's digest for the JST day of ``now``."""
    now = _as_utc(now)
    proposals, new_count = _new_proposals(
        session, user_id, _last_sent_at(session, user_id)
    )
    tasks = _window_tasks(session, user_id, now)
    return DailyDigest(
        digest_date=now.astimezone(APP_TIMEZONE).date(),
        proposals=proposals,
        new_proposal_count=new_count,
        pending_count=pending_count(session, user_id),
        tasks=tasks[:MAX_ITEMS],
        task_count=len(tasks),
    )


def _blocked_today(session: Session, user_id: UUID, today_start: datetime) -> bool:
    """True when today's logs hold a sent digest or too many failures."""
    rows = session.exec(
        select(EmailNotificationLog.status, func.count())
        .where(
            EmailNotificationLog.user_id == user_id,
            EmailNotificationLog.notification_type
            == EmailNotificationType.DAILY_DIGEST,
            col(EmailNotificationLog.created_at) >= today_start,
        )
        .group_by(EmailNotificationLog.status)
    ).all()
    counts = {status: count for status, count in rows}
    return (
        counts.get(EmailNotificationStatus.SENT, 0) > 0
        or counts.get(EmailNotificationStatus.FAILED, 0) >= MAX_FAILURES_PER_DAY
    )


def run_daily_digest(
    session: Session, now: datetime, email_service: EmailService
) -> int:
    """Send today's digest to every user who is due one. Returns mails sent."""
    if not settings.email_notifications_enabled or not email_service.is_enabled:
        return 0

    now = _as_utc(now)
    hour = now.astimezone(APP_TIMEZONE).hour
    today_start = _jst_day_start(now)

    rows = session.exec(
        select(User, UserSettings)
        .join(UserSettings, col(User.id) == col(UserSettings.user_id))
        .where(
            UserSettings.email_notifications_enabled == True,  # noqa: E712
            UserSettings.email_daily_digest_enabled == True,  # noqa: E712
        )
    ).all()
    # Plain values: commits and rollbacks below expire the ORM objects.
    targets = [
        (user.id, user.email, user_settings.email_daily_digest_hour)
        for user, user_settings in rows
    ]

    sent_count = 0
    for user_id, email, digest_hour in targets:
        if hour < digest_hour:
            continue
        try:
            if _blocked_today(session, user_id, today_start):
                continue
            digest = build_digest(session, user_id, now)
            if digest.new_proposal_count == 0 and digest.task_count == 0:
                continue
            success = email_service.send_daily_digest(email, digest)
            session.add(
                EmailNotificationLog(
                    id=uuid4(),
                    user_id=user_id,
                    notification_type=EmailNotificationType.DAILY_DIGEST,
                    status=EmailNotificationStatus.SENT
                    if success
                    else EmailNotificationStatus.FAILED,
                    sent_at=now if success else None,
                    error_message=None if success else "Failed to send email",
                    created_at=now,
                )
            )
            session.commit()
            if success:
                sent_count += 1
                logger.info("Sent daily digest to user %s", user_id)
            else:
                logger.warning("Daily digest failed for user %s", user_id)
        except Exception:
            logger.exception("Error sending daily digest for user %s", user_id)
            session.rollback()
    return sent_count
