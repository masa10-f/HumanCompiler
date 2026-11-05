# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api import agent_audit, agent_changes
from humancompiler_api.models import (
    AgentChange,
    AgentChangeAction,
    AgentChangeActor,
    AgentChangeEntity,
    User,
)
from humancompiler_api.scheduler import notification_scheduler

TEST_USER_ID = UUID("12345678-1234-1234-1234-123456789012")


def make_change(created_at: datetime | None = None, **overrides) -> AgentChange:
    values = {
        "user_id": TEST_USER_ID,
        "actor": AgentChangeActor.AGENT.value,
        "agent_name": "tester",
        "entity_type": AgentChangeEntity.TASK.value,
        "entity_id": uuid4(),
        "action": AgentChangeAction.CREATE.value,
        "after": {"title": "x"},
        "destructive": False,
    }
    values.update(overrides)
    if created_at is not None:
        values["created_at"] = created_at
    return AgentChange(**values)


def test_enum_values_match_the_migration():
    assert [m.value for m in AgentChangeActor] == ["agent", "user"]
    assert [m.value for m in AgentChangeEntity] == [
        "goal",
        "task",
        "context_note",
        "task_dependency",
        "log",
    ]
    assert [m.value for m in AgentChangeAction] == [
        "create",
        "update",
        "append",
        "replace",
        "revert",
    ]


def test_agent_change_defaults():
    change = make_change()

    # The id exists before any flush so callers can reference it.
    assert isinstance(change.id, UUID)
    assert change.created_at.tzinfo is not None
    assert change.created_at.utcoffset() == timedelta(0)
    assert change.before is None
    assert change.proposal_id is None
    assert change.reverts_change_id is None
    assert change.reverted_at is None


def test_agent_change_round_trips_json(session: Session):
    session.add(User(id=TEST_USER_ID, email="changes-user@example.com"))
    change = make_change(before={"title": "a"}, after={"title": "b", "n": [1, 2]})
    session.add(change)
    session.commit()

    stored = session.exec(select(AgentChange)).one()

    assert stored.before == {"title": "a"}
    assert stored.after == {"title": "b", "n": [1, 2]}


def test_purge_expired_changes(session: Session):
    session.add(User(id=TEST_USER_ID, email="changes-user@example.com"))
    now = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
    old = make_change(created_at=now - timedelta(days=366))
    recent = make_change(created_at=now - timedelta(days=364))
    session.add(old)
    session.add(recent)
    session.commit()
    recent_id = recent.id

    deleted = agent_changes.purge_expired_changes(session, now=now)

    assert deleted == 1
    session.expire_all()
    assert [row.id for row in session.exec(select(AgentChange)).all()] == [recent_id]
    assert agent_changes.RETENTION_DAYS == 365


async def test_daily_job_purges_changes(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    session.add(User(id=TEST_USER_ID, email="changes-user@example.com"))
    now = datetime.now(UTC)
    session.add(make_change(created_at=now - timedelta(days=400)))
    kept = make_change(created_at=now - timedelta(days=10))
    session.add(kept)
    session.commit()
    kept_id = kept.id
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )

    await notification_scheduler.purge_expired_agent_audit_logs()

    session.expire_all()
    assert [row.id for row in session.exec(select(AgentChange)).all()] == [kept_id]
