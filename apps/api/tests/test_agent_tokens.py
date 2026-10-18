# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm.attributes import set_committed_value
from sqlmodel import Session

from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import AgentScope, User
from humancompiler_api.services import AgentTokenService, agent_token_service

USER_ID = UUID("12345678-1234-1234-1234-123456789012")
OTHER_USER_ID = UUID("87654321-4321-4321-4321-210987654321")


@pytest.fixture(autouse=True)
def seed_users(session: Session):
    session.add(User(id=USER_ID, email="agent-user@example.com"))
    session.add(User(id=OTHER_USER_ID, email="other-agent-user@example.com"))
    session.commit()


def test_generated_token_format():
    token, prefix = AgentTokenService.generate_token()

    assert prefix.startswith("hc_agent_")
    assert len(prefix) == 17
    assert token.startswith(prefix + "_")


def test_create_token_stores_only_hash(session: Session):
    model, token = agent_token_service.create_token(
        session,
        USER_ID,
        "laptop",
        [AgentScope.TASKS_READ, AgentScope.PROJECTS_READ, AgentScope.TASKS_READ],
    )

    assert model.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in model.token_hash
    assert token.startswith(model.token_prefix + "_")
    assert model.scopes == ["projects:read", "tasks:read"]
    found = agent_token_service.get_active_token_by_secret(session, token)
    assert found is not None
    assert found.id == model.id


def test_create_token_stores_description(session: Session):
    model, _ = agent_token_service.create_token(
        session,
        USER_ID,
        "laptop",
        [AgentScope.QUICK_TASKS_WRITE],
        description="Home laptop",
    )

    assert model.description == "Home laptop"


def test_create_token_rejects_empty_scopes(session: Session):
    with pytest.raises(ValueError):
        agent_token_service.create_token(session, USER_ID, "x", [])


@pytest.mark.parametrize(
    "scopes",
    [["bogus:scope"], [AgentScope.TASKS_READ, "bogus:scope"]],
)
def test_create_token_rejects_unknown_scopes(session: Session, scopes):
    with pytest.raises(ValueError):
        agent_token_service.create_token(session, USER_ID, "x", scopes)

    assert agent_token_service.list_active_tokens(session, USER_ID) == []


def test_unknown_secret_is_not_found(session: Session):
    assert agent_token_service.get_active_token_by_secret(session, "nope") is None


def test_revoked_token_is_not_found_immediately(session: Session):
    model, token = agent_token_service.create_token(
        session, USER_ID, "laptop", [AgentScope.TASKS_READ]
    )
    assert model.id is not None

    revoked = agent_token_service.revoke_token(session, model.id, USER_ID)

    assert revoked.revoked_at is not None
    assert agent_token_service.get_active_token_by_secret(session, token) is None
    assert agent_token_service.list_active_tokens(session, USER_ID) == []


def test_list_active_tokens_returns_only_own_tokens(session: Session):
    own, _ = agent_token_service.create_token(
        session, USER_ID, "own", [AgentScope.TASKS_READ]
    )
    agent_token_service.create_token(
        session, OTHER_USER_ID, "other", [AgentScope.TASKS_READ]
    )

    tokens = agent_token_service.list_active_tokens(session, USER_ID)

    assert [t.id for t in tokens] == [own.id]


def test_revoke_other_users_token_raises(session: Session):
    model, token = agent_token_service.create_token(
        session, OTHER_USER_ID, "other", [AgentScope.TASKS_READ]
    )
    assert model.id is not None

    with pytest.raises(ResourceNotFoundError):
        agent_token_service.revoke_token(session, model.id, USER_ID)

    assert agent_token_service.get_active_token_by_secret(session, token) is not None


def test_revoke_unknown_or_already_revoked_token_raises(session: Session):
    model, _ = agent_token_service.create_token(
        session, USER_ID, "laptop", [AgentScope.TASKS_READ]
    )
    assert model.id is not None
    agent_token_service.revoke_token(session, model.id, USER_ID)

    with pytest.raises(ResourceNotFoundError):
        agent_token_service.revoke_token(session, model.id, USER_ID)
    with pytest.raises(ResourceNotFoundError):
        agent_token_service.revoke_token(session, uuid4(), USER_ID)


def test_touch_last_used_throttles_to_five_minutes(session: Session):
    model, _ = agent_token_service.create_token(
        session, USER_ID, "laptop", [AgentScope.TASKS_READ]
    )
    t0 = datetime(2026, 10, 18, 0, 0, tzinfo=UTC)

    assert agent_token_service.touch_last_used(session, model, now=t0) is True
    assert (
        agent_token_service.touch_last_used(
            session, model, now=t0 + timedelta(minutes=4, seconds=59)
        )
        is False
    )
    assert model.last_used_at is not None
    assert model.last_used_at.replace(tzinfo=UTC) == t0
    assert (
        agent_token_service.touch_last_used(
            session, model, now=t0 + timedelta(minutes=5)
        )
        is True
    )
    assert model.last_used_at.replace(tzinfo=UTC) == t0 + timedelta(minutes=5)


def test_touch_last_used_handles_naive_datetime(session: Session):
    model, _ = agent_token_service.create_token(
        session, USER_ID, "laptop", [AgentScope.TASKS_READ]
    )
    # SQLite hands back naive datetimes; mimic that without writing it.
    set_committed_value(model, "last_used_at", datetime(2026, 10, 18, 0, 0))

    assert (
        agent_token_service.touch_last_used(
            session, model, now=datetime(2026, 10, 18, 0, 6, tzinfo=UTC)
        )
        is True
    )
