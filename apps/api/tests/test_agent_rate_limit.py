# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api import agent_audit
from humancompiler_api.agent_rate_limit import (
    AUTH_FAILURE_LIMIT,
    TOKEN_LIMIT,
    agent_rate_limiter,
)
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentAuditLog, AgentScope, AgentToken, User
from humancompiler_api.services import agent_token_service

client = TestClient(app)

TEST_USER_ID = UUID("22345678-1234-1234-1234-123456789012")
QUICK_TASKS = "/api/hooks/quick-tasks"


@pytest.fixture(autouse=True)
def rate_limit_session(session: Session, monkeypatch: pytest.MonkeyPatch):
    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    monkeypatch.setattr(agent_rate_limiter, "enabled", True)
    agent_rate_limiter.reset()
    session.add(User(id=TEST_USER_ID, email="rate-limit-user@example.com"))
    session.commit()
    yield
    agent_rate_limiter.reset()
    app.dependency_overrides.pop(get_session, None)


def create_token(session: Session) -> tuple[AgentToken, str]:
    agent_token, token = agent_token_service.create_token(
        session, TEST_USER_ID, "Rate limit test", [AgentScope.QUICK_TASKS_WRITE]
    )
    # Read the values now; later commits expire the instance.
    session.refresh(agent_token)
    return agent_token, token


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def fake_token(i: int) -> str:
    # Well-formed but unknown; built at runtime so no secret-like literal exists.
    return f"hc_agent_{i:08d}_" + "x" * 43


def post_quick_task(headers: dict[str, str] | None = None):
    return client.post(QUICK_TASKS, headers=headers or {}, json={"title": "Limit"})


def audit_rows(session: Session) -> list[AgentAuditLog]:
    session.expire_all()
    return list(session.exec(select(AgentAuditLog)).all())


def test_limit_values():
    assert str(TOKEN_LIMIT) == "120 per 1 minute"
    assert str(AUTH_FAILURE_LIMIT) == "20 per 1 minute"


def test_token_limit_allows_120_per_minute_then_429(session: Session):
    _, token = create_token(session)

    statuses = [post_quick_task(bearer(token)).status_code for _ in range(120)]
    response = post_quick_task(bearer(token))

    assert statuses == [201] * 120
    assert response.status_code == 429
    assert response.json()["detail"] == "Agent token rate limit exceeded"
    assert int(response.headers["Retry-After"]) >= 1


def test_token_limit_is_per_token(session: Session):
    _, token_a = create_token(session)
    _, token_b = create_token(session)
    for _ in range(120):
        post_quick_task(bearer(token_a))
    assert post_quick_task(bearer(token_a)).status_code == 429

    assert post_quick_task(bearer(token_b)).status_code == 201


def test_token_limit_429_is_audited_with_token(session: Session):
    agent_token, token = create_token(session)
    token_id = agent_token.id
    for _ in range(121):
        response = post_quick_task(bearer(token))
    assert response.status_code == 429

    rows = audit_rows(session)
    assert len(rows) == 121
    # Only the last request was over the limit, so it is the single 429 row.
    limited = [row for row in rows if row.status_code == 429]
    assert len(limited) == 1
    assert limited[0].token_id == token_id
    assert limited[0].user_id == TEST_USER_ID
    assert limited[0].required_scope == "quick_tasks:write"


def test_auth_failure_limit_blocks_ip_after_20_failures(session: Session):
    _, valid_token = create_token(session)

    statuses = [post_quick_task(bearer(fake_token(i))).status_code for i in range(20)]
    blocked = post_quick_task(bearer(fake_token(20)))

    assert statuses == [401] * 20
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Too many failed agent authentication attempts"
    assert int(blocked.headers["Retry-After"]) >= 1
    # The IP stays blocked even for a valid token.
    assert post_quick_task(bearer(valid_token)).status_code == 429


def test_auth_failure_429_is_not_audited(session: Session):
    for i in range(20):
        assert post_quick_task(bearer(fake_token(i))).status_code == 401
    for i in range(20, 22):
        assert post_quick_task(bearer(fake_token(i))).status_code == 429

    rows = audit_rows(session)
    assert len(rows) == 20
    assert {row.status_code for row in rows} == {401}


def test_missing_header_does_not_count_as_auth_failure(session: Session):
    _, token = create_token(session)

    statuses = [post_quick_task().status_code for _ in range(25)]

    assert statuses == [401] * 25
    assert post_quick_task(bearer(token)).status_code == 201


def test_changing_forwarded_for_does_not_reset_auth_failures(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("FLY_APP_NAME", raising=False)

    def spoofed(i: int) -> dict[str, str]:
        return {
            **bearer(fake_token(i)),
            "X-Forwarded-For": f"198.51.100.{i}",
            "Fly-Client-IP": f"203.0.113.{i}",
        }

    statuses = [post_quick_task(spoofed(i)).status_code for i in range(20)]

    assert statuses == [401] * 20
    assert post_quick_task(spoofed(20)).status_code == 429


def test_limits_are_inactive_when_disabled(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(agent_rate_limiter, "enabled", False)

    statuses = [post_quick_task(bearer(fake_token(i))).status_code for i in range(25)]

    assert statuses == [401] * 25


def test_disabled_limiter_methods_are_noops(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(agent_rate_limiter, "enabled", False)
    token_id = UUID("32345678-1234-1234-1234-123456789012")

    for _ in range(25):
        agent_rate_limiter.record_auth_failure("192.0.2.1")
    results = [agent_rate_limiter.hit_token(token_id) for _ in range(125)]

    assert agent_rate_limiter.auth_failure_retry_after("192.0.2.1") is None
    assert results == [None] * 125


def test_token_and_auth_failure_keys_do_not_collide():
    shared_key = "32345678-1234-1234-1234-123456789012"
    for _ in range(20):
        agent_rate_limiter.record_auth_failure(shared_key)

    assert agent_rate_limiter.auth_failure_retry_after(shared_key) is not None
    assert agent_rate_limiter.hit_token(UUID(shared_key)) is None


def test_http_exception_headers_reach_the_client(session: Session):
    response = post_quick_task()

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
