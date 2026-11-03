# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Tests for the deadline reminder email job (no real Resend)."""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api.models import (
    EmailNotificationLog,
    EmailNotificationSettingsUpdate,
    EmailNotificationStatus,
    EmailNotificationType,
    Task,
    UserSettings,
    UserSettingsResponse,
)
from humancompiler_api.scheduler import notification_scheduler
from tests.agent_api_helpers import seed_goal, seed_project, seed_task, seed_user

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

NOW = datetime(2026, 11, 3, 3, 0, tzinfo=UTC)
FIVE_MINUTES = timedelta(minutes=5)


def email_of(user_id: UUID) -> str:
    return f"agent-read-{user_id}@example.com"


class FakeEmailService:
    """Records sends; returns queued results, then ``default``."""

    def __init__(
        self,
        results: list[bool] | None = None,
        *,
        default: bool = True,
        on_send: Callable[[str], None] | None = None,
    ) -> None:
        self.is_enabled = True
        self.results: list[bool] = list(results or [])
        self.default = default
        self.on_send = on_send
        self.calls: list[tuple[str, str, UUID]] = []

    def _send(self, kind: str, to_email: str, task_id: UUID) -> bool:
        self.calls.append((kind, to_email, task_id))
        if self.on_send is not None:
            self.on_send(to_email)
        return self.results.pop(0) if self.results else self.default

    def send_deadline_reminder(
        self,
        to_email: str,
        task_title: str,
        task_id: UUID,
        due_date: datetime,
        hours_until_due: int,
        project_title: str | None = None,
        goal_title: str | None = None,
    ) -> bool:
        return self._send("reminder", to_email, task_id)

    def send_overdue_alert(self, *args: Any, **kwargs: Any) -> bool:
        """Spy only: the real service no longer has overdue alerts."""
        self.calls.append(("overdue", kwargs.get("to_email", ""), kwargs["task_id"]))
        return True


def add_user(session: Session, user_id: UUID, **overrides: Any) -> UUID:
    seed_user(session, user_id)
    values: dict[str, Any] = {
        "email_notifications_enabled": True,
        "email_deadline_reminder_hours": 24,
    }
    values.update(overrides)
    session.add(UserSettings(id=uuid4(), user_id=user_id, **values))
    session.commit()
    return user_id


def add_task(session: Session, user_id: UUID, due: datetime) -> UUID:
    task = seed_task(session, seed_goal(session, seed_project(session, user_id)))
    task.due_date = due
    session.add(task)
    session.commit()
    return task.id


def logs_of(session: Session, user_id: UUID = USER_A) -> list[EmailNotificationLog]:
    return list(
        session.exec(
            select(EmailNotificationLog)
            .where(EmailNotificationLog.user_id == user_id)
            .order_by(EmailNotificationLog.created_at)  # type: ignore[arg-type]
        ).all()
    )


Runner = Callable[[datetime, FakeEmailService], Awaitable[None]]


@pytest.fixture
def run(session: Session, monkeypatch: pytest.MonkeyPatch) -> Runner:
    """Run the real top-level job at ``now`` on the test session with a fake."""
    monkeypatch.setattr(
        notification_scheduler.settings, "email_notifications_enabled", True
    )
    monkeypatch.setattr(
        notification_scheduler,
        "db",
        SimpleNamespace(get_engine=lambda: session.get_bind()),
    )
    monkeypatch.setattr(notification_scheduler, "Session", lambda _engine: session)

    async def _run(now: datetime, fake: FakeEmailService) -> None:
        class FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
                return now

        monkeypatch.setattr(notification_scheduler, "datetime", FrozenDatetime)
        monkeypatch.setattr(notification_scheduler, "get_email_service", lambda: fake)
        await notification_scheduler.check_and_send_deadline_emails()

    return _run


def test_log_id_is_generated_client_side():
    log = EmailNotificationLog(
        user_id=uuid4(),
        notification_type=EmailNotificationType.DEADLINE_REMINDER,
        status=EmailNotificationStatus.PENDING,
    )

    assert isinstance(log.id, UUID)


async def test_deadline_reminder_sent_once_per_day(session: Session, run: Runner):
    add_user(session, USER_A)
    task_id = add_task(session, USER_A, NOW + timedelta(hours=2))
    fake = FakeEmailService()

    await run(NOW, fake)
    await run(NOW + FIVE_MINUTES, fake)

    assert fake.calls == [("reminder", email_of(USER_A), task_id)]
    [log] = logs_of(session)
    assert log.status == EmailNotificationStatus.SENT
    assert log.notification_type == EmailNotificationType.DEADLINE_REMINDER
    assert log.task_id == task_id
    assert log.quick_task_id is None
    assert log.sent_at is not None
    assert log.error_message is None


async def test_no_overdue_alert_is_sent(session: Session, run: Runner):
    # The unused column still defaults to True; it must not matter.
    add_user(session, USER_A)
    add_task(session, USER_A, NOW - timedelta(hours=2))
    fake = FakeEmailService()

    await run(NOW, fake)
    await run(NOW + FIVE_MINUTES, fake)

    assert fake.calls == []
    assert logs_of(session) == []


def test_settings_api_no_longer_exposes_overdue_alerts():
    assert "email_overdue_alerts_enabled" not in UserSettingsResponse.model_fields
    assert (
        "email_overdue_alerts_enabled"
        not in EmailNotificationSettingsUpdate.model_fields
    )


async def test_commit_failure_after_send_does_not_resend(
    session: Session, run: Runner, monkeypatch: pytest.MonkeyPatch
):
    add_user(session, USER_A)
    add_task(session, USER_A, NOW + timedelta(hours=2))
    state = {"sent": False, "failed_commits": 0}
    real_commit = session.commit

    def commit_failing_once_after_send() -> None:
        if state["sent"] and state["failed_commits"] == 0:
            state["failed_commits"] += 1
            raise RuntimeError("simulated commit failure")
        real_commit()

    def mark_sent(_to_email: str) -> None:
        state["sent"] = True

    monkeypatch.setattr(session, "commit", commit_failing_once_after_send)
    fake = FakeEmailService(on_send=mark_sent)

    await run(NOW, fake)
    await run(NOW + FIVE_MINUTES, fake)

    assert state["failed_commits"] == 1
    assert len(fake.calls) == 1
    [log] = logs_of(session)
    assert log.status == EmailNotificationStatus.PENDING


async def test_reservation_is_pending_while_sending(session: Session, run: Runner):
    add_user(session, USER_A)
    task_id = add_task(session, USER_A, NOW + timedelta(hours=2))
    seen: list[tuple[EmailNotificationStatus, UUID | None, bool]] = []

    def look(_to_email: str) -> None:
        seen.extend(
            (log.status, log.task_id, log.sent_at is None) for log in logs_of(session)
        )

    fake = FakeEmailService(on_send=look)

    await run(NOW, fake)

    assert seen == [(EmailNotificationStatus.PENDING, task_id, True)]
    [log] = logs_of(session)
    assert log.status == EmailNotificationStatus.SENT


async def test_failed_send_retried_and_capped(session: Session, run: Runner):
    add_user(session, USER_A)
    add_task(session, USER_A, NOW + timedelta(hours=2))
    fake = FakeEmailService(default=False)

    for minutes in (0, 5, 10, 15, 20):
        await run(NOW + timedelta(minutes=minutes), fake)

    assert len(fake.calls) == notification_scheduler.MAX_FAILURES_PER_DAY == 3
    logs = logs_of(session)
    assert [log.status for log in logs] == [EmailNotificationStatus.FAILED] * 3
    assert all(log.error_message == "Failed to send email" for log in logs)
    assert all(log.sent_at is None for log in logs)


async def test_one_user_failure_does_not_break_the_next_user(
    session: Session, run: Runner, caplog: pytest.LogCaptureFixture
):
    add_user(session, USER_A)
    add_task(session, USER_A, NOW + timedelta(hours=2))
    add_user(session, USER_B)
    b_task_id = add_task(session, USER_B, NOW + timedelta(hours=2))

    def poison_session_for_a(to_email: str) -> None:
        # Fail the way production did: a flush error that leaves the shared
        # session needing a rollback.
        if to_email == email_of(USER_A):
            session.add(
                EmailNotificationLog(
                    id=uuid4(),
                    user_id=None,  # type: ignore[arg-type]
                    notification_type=EmailNotificationType.DEADLINE_REMINDER,
                )
            )
            session.flush()

    fake = FakeEmailService(on_send=poison_session_for_a)

    with caplog.at_level(logging.ERROR, logger=notification_scheduler.__name__):
        await run(NOW, fake)

    assert [to for _, to, _ in fake.calls] == [email_of(USER_A), email_of(USER_B)]
    [b_log] = logs_of(session, USER_B)
    assert b_log.status == EmailNotificationStatus.SENT
    assert b_log.task_id == b_task_id
    assert "transaction has been rolled back" not in caplog.text
    assert f"user {USER_A}" in caplog.text
    assert email_of(USER_A) not in caplog.text
    assert session.get(Task, b_task_id) is not None
