# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Tests for collecting the daily digest and deciding who gets it (no real Resend)."""

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api import daily_digest, proposal_service
from humancompiler_api.email_service import DailyDigest
from humancompiler_api.models import (
    AgentProposal,
    EmailNotificationLog,
    EmailNotificationStatus,
    EmailNotificationType,
    Goal,
    GoalStatus,
    ProjectStatus,
    ProposalKind,
    ProposalStatus,
    QuickTask,
    Task,
    TaskStatus,
    UserSettings,
)
from humancompiler_api.proposal_payloads import normalize_payload
from tests.agent_api_helpers import (
    seed_goal,
    seed_project,
    seed_quick_task,
    seed_task,
    seed_user,
)

JST = proposal_service.APP_TIMEZONE

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
USER_C = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")

EXPERIMENT_PAYLOAD = {
    "question": "q",
    "method": "m",
    "supports_if": "s",
    "refutes_if": "r",
    "effort": "e",
}


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """An instant given in JST on a day of November 2026, as aware UTC."""
    return datetime(2026, 11, day, hour, minute, tzinfo=JST).astimezone(UTC)


def email_of(user_id: UUID) -> str:
    return f"agent-read-{user_id}@example.com"


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class FakeEmailService:
    def __init__(self, results: list[bool] | None = None) -> None:
        self.is_enabled = True
        self.results: list[bool] = list(results or [])
        self.calls: list[tuple[str, DailyDigest]] = []

    def send_daily_digest(
        self, to_email: str, digest: DailyDigest, user_id: UUID
    ) -> bool:
        self.calls.append((to_email, digest))
        return self.results.pop(0) if self.results else True


def add_user(session: Session, user_id: UUID, **overrides: Any) -> UUID:
    seed_user(session, user_id)
    values: dict[str, Any] = {
        "email_notifications_enabled": True,
        "email_daily_digest_enabled": True,
        "email_daily_digest_hour": 9,
    }
    values.update(overrides)
    session.add(UserSettings(id=uuid4(), user_id=user_id, **values))
    session.commit()
    return user_id


def add_proposal(
    session: Session,
    user_id: UUID,
    created_at: datetime,
    *,
    title: str = "Proposal",
    status: ProposalStatus = ProposalStatus.PENDING,
    agent_name: str = "Distiller",
    project_id: UUID | None = None,
) -> AgentProposal:
    row = AgentProposal(
        id=uuid4(),
        user_id=user_id,
        agent_name=agent_name,
        kind=ProposalKind.EXPERIMENT.value,
        title=title,
        payload=normalize_payload(ProposalKind.EXPERIMENT, EXPERIMENT_PAYLOAD),
        idempotency_key=f"key-{uuid4()}",
        project_id=project_id,
        status=status.value,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    session.commit()
    return row


def add_log(
    session: Session,
    user_id: UUID,
    created_at: datetime,
    *,
    status: EmailNotificationStatus = EmailNotificationStatus.SENT,
) -> None:
    sent = status is EmailNotificationStatus.SENT
    session.add(
        EmailNotificationLog(
            id=uuid4(),
            user_id=user_id,
            notification_type=EmailNotificationType.DAILY_DIGEST,
            status=status,
            sent_at=created_at if sent else None,
            error_message="Failed to send email"
            if status is EmailNotificationStatus.FAILED
            else None,
            created_at=created_at,
        )
    )
    session.commit()


def logs_of(session: Session, user_id: UUID = USER_A) -> list[EmailNotificationLog]:
    return list(
        session.exec(
            select(EmailNotificationLog)
            .where(EmailNotificationLog.user_id == user_id)
            .order_by(EmailNotificationLog.created_at)  # type: ignore[arg-type]
        ).all()
    )


def goal_of(session: Session, user_id: UUID) -> Goal:
    return seed_goal(session, seed_project(session, user_id))


def due_task(
    session: Session,
    goal: Goal,
    due: datetime | None,
    *,
    title: str = "Task",
    status: TaskStatus = TaskStatus.PENDING,
) -> Task:
    task = seed_task(session, goal, status=status)
    task.due_date = due
    task.title = title
    session.add(task)
    session.commit()
    return task


def due_quick_task(
    session: Session,
    user_id: UUID,
    due: datetime | None,
    *,
    title: str = "Quick task",
    status: TaskStatus = TaskStatus.PENDING,
) -> QuickTask:
    quick_task = seed_quick_task(session, user_id, status=status)
    quick_task.due_date = due
    quick_task.title = title
    session.add(quick_task)
    session.commit()
    return quick_task


@pytest.fixture(autouse=True)
def digest_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(daily_digest.settings, "email_notifications_enabled", True)


def test_not_sent_before_hour(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 8, 59), fake) == 0
    assert fake.calls == []
    assert logs_of(session) == []


def test_sent_once_after_hour(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    fake = FakeEmailService()
    now = at(3, 9)

    assert daily_digest.run_daily_digest(session, now, fake) == 1
    assert [to for to, _ in fake.calls] == [email_of(USER_A)]
    [log] = logs_of(session)
    assert log.notification_type == EmailNotificationType.DAILY_DIGEST
    assert log.status == EmailNotificationStatus.SENT
    assert as_utc(log.sent_at) == now
    assert as_utc(log.created_at) == now
    assert log.error_message is None
    assert log.task_id is None and log.quick_task_id is None

    assert daily_digest.run_daily_digest(session, at(3, 9, 10), fake) == 0
    assert len(fake.calls) == 1
    assert len(logs_of(session)) == 1


def test_sent_late_after_missed_hour(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 15, 20), fake) == 1
    assert daily_digest.run_daily_digest(session, at(3, 15, 30), fake) == 0
    assert len(fake.calls) == 1


def test_sends_again_next_day(session: Session):
    add_user(session, USER_A)
    due_task(session, goal_of(session, USER_A), at(5, 12))
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 1
    assert daily_digest.run_daily_digest(session, at(4, 9), fake) == 1
    assert len(fake.calls) == 2
    assert [log.status for log in logs_of(session)] == [
        EmailNotificationStatus.SENT,
        EmailNotificationStatus.SENT,
    ]


def test_jst_day_boundary_for_sent_log(session: Session):
    # A: sent at 2026-11-04 01:00 JST, which is 2026-11-03T16:00Z (previous UTC day).
    add_user(session, USER_A)
    due_task(session, goal_of(session, USER_A), at(5, 12))
    blocking = at(4, 1)
    assert blocking == datetime(2026, 11, 3, 16, 0, tzinfo=UTC)
    add_log(session, USER_A, blocking)
    # B: sent at 2026-11-03 23:50 JST, the day before in JST.
    add_user(session, USER_B)
    due_task(session, goal_of(session, USER_B), at(5, 12))
    add_log(session, USER_B, at(3, 23, 50))
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(4, 9), fake) == 1
    assert [to for to, _ in fake.calls] == [email_of(USER_B)]


def test_skips_when_both_sections_empty(session: Session):
    add_user(session, USER_A)
    goal = goal_of(session, USER_A)
    due_task(session, goal, datetime(2026, 11, 7, 0, 0, tzinfo=JST))  # outside window
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 0
    assert fake.calls == []
    assert logs_of(session) == []

    # Pending proposals that are all older than the last sent_at are not new.
    add_log(session, USER_A, at(2, 9))
    add_proposal(session, USER_A, at(2, 8))
    add_proposal(session, USER_A, at(1, 12))

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 0
    assert fake.calls == []
    assert len(logs_of(session)) == 1


def test_sends_with_only_tasks_and_with_only_proposals(session: Session):
    add_user(session, USER_A)
    due_task(session, goal_of(session, USER_A), at(4, 12), title="A task")
    add_user(session, USER_B)
    add_proposal(session, USER_B, at(2, 12), title="B proposal")
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 2
    digests = dict(fake.calls)

    only_tasks = digests[email_of(USER_A)]
    assert only_tasks.task_count == 1
    assert [task.title for task in only_tasks.tasks] == ["A task"]
    assert only_tasks.new_proposal_count == 0
    assert only_tasks.proposals == []
    assert only_tasks.pending_count == 0

    only_proposals = digests[email_of(USER_B)]
    assert only_proposals.new_proposal_count == 1
    assert [p.title for p in only_proposals.proposals] == ["B proposal"]
    assert only_proposals.task_count == 0
    assert only_proposals.tasks == []


def test_new_proposals_only_after_last_sent(session: Session):
    add_user(session, USER_A)
    last_sent = at(2, 9)
    add_log(session, USER_A, last_sent - timedelta(days=1))
    add_log(session, USER_A, last_sent)
    add_log(
        session,
        USER_A,
        last_sent + timedelta(hours=1),
        status=EmailNotificationStatus.FAILED,
    )
    add_proposal(session, USER_A, last_sent - timedelta(minutes=1), title="Before")
    add_proposal(session, USER_A, last_sent + timedelta(minutes=1), title="First")
    add_proposal(session, USER_A, last_sent + timedelta(hours=2), title="Second")
    add_proposal(
        session,
        USER_A,
        last_sent + timedelta(hours=3),
        title="Accepted",
        status=ProposalStatus.ACCEPTED,
    )
    seed_user(session, USER_B)
    add_proposal(session, USER_B, last_sent + timedelta(hours=4), title="Other user")

    digest = daily_digest.build_digest(session, USER_A, at(3, 9))

    assert digest.new_proposal_count == 2
    assert [p.title for p in digest.proposals] == ["Second", "First"]
    assert digest.pending_count == 3


def test_digest_names_project_and_agent(session: Session):
    add_user(session, USER_A)
    own_project = seed_project(session, USER_A)
    seed_user(session, USER_B)
    foreign_project = seed_project(session, USER_B)
    foreign_project.title = "Foreign project"
    session.add(foreign_project)
    session.commit()
    add_proposal(
        session,
        USER_A,
        at(2, 10),
        title="Own",
        agent_name="Researcher",
        project_id=own_project.id,
    )
    add_proposal(
        session, USER_A, at(2, 11), title="Foreign", project_id=foreign_project.id
    )

    digest = daily_digest.build_digest(session, USER_A, at(3, 9))

    by_title = {p.title: p for p in digest.proposals}
    assert by_title["Own"].project_name == "Project"
    assert by_title["Own"].agent_name == "Researcher"
    assert by_title["Own"].kind == ProposalKind.EXPERIMENT.value
    assert by_title["Foreign"].project_name is None
    assert by_title["Foreign"].agent_name == "Distiller"


def test_task_window(session: Session):
    """Due dates are reloaded after expire_all() and come back as aware UTC.

    In this SQLite fixture ``Task.due_date`` reads back aware, so naive input
    is covered directly by ``test_as_utc_treats_naive_as_utc``."""
    add_user(session, USER_A)
    goal = goal_of(session, USER_A)
    last_in_window = datetime(2026, 11, 6, 23, 59, tzinfo=JST)
    overdue = datetime(2026, 11, 1, 12, 0, tzinfo=JST)
    quick_due = datetime(2026, 11, 4, 12, 0, tzinfo=JST)
    due_task(session, goal, last_in_window, title="Due Friday")
    due_task(session, goal, overdue, title="Overdue")
    due_quick_task(session, USER_A, quick_due, title="Quick")
    # Excluded.
    due_task(session, goal, datetime(2026, 11, 7, 0, 0, tzinfo=JST), title="Too late")
    due_task(session, goal, at(4, 12), title="Done", status=TaskStatus.COMPLETED)
    due_task(session, goal, at(4, 12), title="Dropped", status=TaskStatus.CANCELLED)
    due_task(session, goal, None, title="No due date")
    due_quick_task(
        session, USER_A, at(4, 12), title="Quick done", status=TaskStatus.COMPLETED
    )
    add_user(session, USER_B)
    due_task(session, goal_of(session, USER_B), at(4, 12), title="Other user")
    due_quick_task(session, USER_B, at(4, 12), title="Other user quick")
    session.expire_all()

    digest = daily_digest.build_digest(session, USER_A, at(3, 9))

    assert digest.digest_date == date(2026, 11, 3)
    assert digest.task_count == 3
    assert [t.title for t in digest.tasks] == ["Overdue", "Quick", "Due Friday"]
    assert [t.is_overdue for t in digest.tasks] == [True, False, False]
    assert [t.due_date for t in digest.tasks] == [overdue, quick_due, last_in_window]
    assert all(t.due_date.utcoffset() == timedelta(0) for t in digest.tasks)
    assert [t.context for t in digest.tasks] == [
        "Project > Goal",
        None,
        "Project > Goal",
    ]


def test_task_window_excludes_finished_goal_or_project(session: Session):
    add_user(session, USER_A)
    cases = [
        ("Goal done", ProjectStatus.PENDING, GoalStatus.COMPLETED),
        ("Goal cancelled", ProjectStatus.PENDING, GoalStatus.CANCELLED),
        ("Project done", ProjectStatus.COMPLETED, GoalStatus.PENDING),
        ("Project cancelled", ProjectStatus.CANCELLED, GoalStatus.PENDING),
        ("Project paused", ProjectStatus.PAUSED, GoalStatus.PENDING),
        ("Active", ProjectStatus.IN_PROGRESS, GoalStatus.IN_PROGRESS),
    ]
    for title, project_status, goal_status in cases:
        project = seed_project(session, USER_A, status=project_status)
        goal = seed_goal(session, project, status=goal_status)
        due_task(session, goal, at(4, 12), title=title)
    session.expire_all()

    digest = daily_digest.build_digest(session, USER_A, at(3, 9))

    assert sorted(t.title for t in digest.tasks) == ["Active", "Project paused"]


def test_caps_sections_at_twenty(session: Session):
    add_user(session, USER_A)
    for minute in range(25):
        add_proposal(session, USER_A, at(2, 10, minute), title=f"P{minute:02d}")
    goal = goal_of(session, USER_A)
    for hour in range(11):
        due_task(session, goal, at(4, hour), title=f"T{hour:02d}")
        due_quick_task(session, USER_A, at(4, hour, 30), title=f"Q{hour:02d}")

    digest = daily_digest.build_digest(session, USER_A, at(3, 9))

    assert len(digest.proposals) == 20
    assert digest.new_proposal_count == 25
    assert digest.proposals[0].title == "P24"
    assert len(digest.tasks) == 20
    assert digest.task_count == 22
    assert digest.tasks[0].title == "T00"
    assert digest.tasks[1].title == "Q00"


def test_user_switches_and_global_flag(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    add_user(session, USER_A, email_daily_digest_enabled=False)
    add_user(session, USER_B, email_notifications_enabled=False)
    add_user(session, USER_C)
    for user_id in (USER_A, USER_B, USER_C):
        add_proposal(session, user_id, at(2, 12))
    now = at(3, 9)

    monkeypatch.setattr(daily_digest.settings, "email_notifications_enabled", False)
    fake = FakeEmailService()
    assert daily_digest.run_daily_digest(session, now, fake) == 0
    assert fake.calls == []

    monkeypatch.setattr(daily_digest.settings, "email_notifications_enabled", True)
    fake.is_enabled = False
    assert daily_digest.run_daily_digest(session, now, fake) == 0
    assert fake.calls == []

    fake.is_enabled = True
    assert daily_digest.run_daily_digest(session, now, fake) == 1
    assert [to for to, _ in fake.calls] == [email_of(USER_C)]
    assert logs_of(session, USER_A) == []
    assert logs_of(session, USER_B) == []


def test_failure_logged_retried_and_capped(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    fake = FakeEmailService(results=[False, False, False])

    for minute in (0, 10, 20):
        assert daily_digest.run_daily_digest(session, at(3, 9, minute), fake) == 0
    assert len(fake.calls) == 3
    logs = logs_of(session)
    assert [log.status for log in logs] == [EmailNotificationStatus.FAILED] * 3
    assert all(log.sent_at is None for log in logs)
    assert all(log.error_message == "Failed to send email" for log in logs)

    assert daily_digest.run_daily_digest(session, at(3, 9, 30), fake) == 0
    assert len(fake.calls) == 3

    assert daily_digest.run_daily_digest(session, at(4, 9), fake) == 1
    assert len(fake.calls) == 4


def test_exception_for_one_user_is_logged_and_others_continue(
    session: Session, caplog: pytest.LogCaptureFixture
):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    add_user(session, USER_B)
    add_proposal(session, USER_B, at(2, 12))

    class RaisingForA(FakeEmailService):
        def send_daily_digest(
            self, to_email: str, digest: DailyDigest, user_id: UUID
        ) -> bool:
            if to_email == email_of(USER_A):
                raise RuntimeError("boom")
            return super().send_daily_digest(to_email, digest, user_id)

    fake = RaisingForA()
    with caplog.at_level(logging.ERROR, logger=daily_digest.logger.name):
        assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 1

    assert [to for to, _ in fake.calls] == [email_of(USER_B)]
    # The reservation was committed before the send raised: it stays pending
    # and blocks A for the rest of the day instead of retrying every run.
    assert [log.status for log in logs_of(session, USER_A)] == [
        EmailNotificationStatus.PENDING
    ]
    assert [log.status for log in logs_of(session, USER_B)] == [
        EmailNotificationStatus.SENT
    ]
    [record] = [r for r in caplog.records if r.exc_info]
    assert str(USER_A) in record.getMessage()
    assert email_of(USER_A) not in caplog.text


def test_reservation_is_pending_while_sending(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    seen: list[list[tuple[EmailNotificationStatus, datetime | None]]] = []

    class Inspecting(FakeEmailService):
        def send_daily_digest(
            self, to_email: str, digest: DailyDigest, user_id: UUID
        ) -> bool:
            seen.append([(log.status, log.sent_at) for log in logs_of(session)])
            return super().send_daily_digest(to_email, digest, user_id)

    now = at(3, 9)
    assert daily_digest.run_daily_digest(session, now, Inspecting()) == 1

    assert seen == [[(EmailNotificationStatus.PENDING, None)]]
    [log] = logs_of(session)
    assert log.status == EmailNotificationStatus.SENT
    assert as_utc(log.sent_at) == now
    assert as_utc(log.created_at) == now


def test_commit_failure_after_send_does_not_resend(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    fake = FakeEmailService()
    real_commit = session.commit
    commits: list[int] = []

    def commit_failing_after_send() -> None:
        commits.append(1)
        if len(commits) == 2:  # 1: the reservation, 2: the update after the send
            raise RuntimeError("database went away")
        real_commit()

    monkeypatch.setattr(session, "commit", commit_failing_after_send)
    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 0
    assert len(fake.calls) == 1
    monkeypatch.setattr(session, "commit", real_commit)

    [log] = logs_of(session)
    assert log.status == EmailNotificationStatus.PENDING
    for minute in (10, 20, 30):
        assert daily_digest.run_daily_digest(session, at(3, 9, minute), fake) == 0
    assert len(fake.calls) == 1


def test_pending_log_from_today_blocks(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    add_log(session, USER_A, at(3, 0, 5), status=EmailNotificationStatus.PENDING)
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 0
    assert fake.calls == []


def test_pending_log_from_yesterday_does_not_block(session: Session):
    add_user(session, USER_A)
    add_proposal(session, USER_A, at(2, 12))
    add_log(session, USER_A, at(2, 23, 55), status=EmailNotificationStatus.PENDING)
    fake = FakeEmailService()

    assert daily_digest.run_daily_digest(session, at(3, 9), fake) == 1
    assert len(fake.calls) == 1
    # A pending row is not a sent digest: the proposal still counts as new.
    assert fake.calls[0][1].new_proposal_count == 1


def test_as_utc_treats_naive_as_utc():
    naive = datetime(2026, 11, 3, 15, 30)
    assert daily_digest._as_utc(naive) == datetime(2026, 11, 3, 15, 30, tzinfo=UTC)
    aware_jst = datetime(2026, 11, 4, 0, 30, tzinfo=JST)
    converted = daily_digest._as_utc(aware_jst)
    assert converted == datetime(2026, 11, 3, 15, 30, tzinfo=UTC)
    assert converted.utcoffset() == timedelta(0)
