# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api import agent_audit
from humancompiler_api.agent_audit import AgentAuditMiddleware
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentAuditLog, AgentScope, AgentToken, User
from humancompiler_api.rate_limiter import DefaultRateLimitMiddleware
from humancompiler_api.routers import hooks
from humancompiler_api.scheduler import notification_scheduler
from humancompiler_api.services import agent_token_service

client = TestClient(app)

TEST_USER_ID = UUID("12345678-1234-1234-1234-123456789012")


@pytest.fixture(autouse=True)
def audit_session(session: Session, monkeypatch: pytest.MonkeyPatch):
    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    session.add(User(id=TEST_USER_ID, email="audit-user@example.com"))
    session.commit()
    yield
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def create_token(
    session: Session, scopes: list[AgentScope] | None = None
) -> tuple[AgentToken, str]:
    agent_token, token = agent_token_service.create_token(
        session,
        TEST_USER_ID,
        "Audit test",
        scopes or [AgentScope.QUICK_TASKS_WRITE],
    )
    # Read the values now; later commits expire the instance.
    session.refresh(agent_token)
    return agent_token, token


def audit_rows(session: Session) -> list[AgentAuditLog]:
    session.expire_all()
    return list(session.exec(select(AgentAuditLog)).all())


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_successful_hook_request_is_audited(session: Session):
    agent_token, token = create_token(session)
    token_id, token_prefix = agent_token.id, agent_token.token_prefix

    response = client.post(
        "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "Audit me"}
    )

    assert response.status_code == 201
    rows = audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.token_id == token_id
    assert row.user_id == TEST_USER_ID
    assert row.token_prefix == token_prefix
    assert row.method == "POST"
    assert row.route == "/api/hooks/quick-tasks"
    assert row.required_scope == "quick_tasks:write"
    assert row.status_code == 201
    assert row.duration_ms >= 0
    assert row.client_ip == "testclient"
    assert row.created_at is not None


def test_invalid_token_is_audited_with_prefix_only_when_well_formed(
    session: Session,
):
    well_formed = "hc_agent_AbCdEfGh_" + "x" * 43

    well_formed_response = client.post(
        "/api/hooks/quick-tasks", headers=bearer(well_formed), json={"title": "A"}
    )
    malformed_response = client.post(
        "/api/hooks/quick-tasks", headers=bearer("not-a-token"), json={"title": "B"}
    )

    assert well_formed_response.status_code == 401
    assert malformed_response.status_code == 401
    rows = sorted(audit_rows(session), key=lambda row: row.token_prefix is None)
    assert len(rows) == 2
    well_formed_row, malformed_row = rows
    assert well_formed_row.token_prefix == "hc_agent_AbCdEfGh"
    assert well_formed_row.user_id is None
    assert well_formed_row.token_id is None
    assert well_formed_row.required_scope == "quick_tasks:write"
    assert well_formed_row.status_code == 401
    assert malformed_row.token_prefix is None
    assert malformed_row.user_id is None
    assert malformed_row.token_id is None
    assert malformed_row.status_code == 401


def test_missing_scope_is_audited_as_403(session: Session):
    agent_token, token = create_token(session, [AgentScope.TASKS_READ])
    token_id = agent_token.id

    response = client.post(
        "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "Nope"}
    )

    assert response.status_code == 403
    rows = audit_rows(session)
    assert len(rows) == 1
    assert rows[0].status_code == 403
    assert rows[0].user_id == TEST_USER_ID
    assert rows[0].token_id == token_id
    assert rows[0].required_scope == "quick_tasks:write"


def test_request_without_token_header_is_not_audited(session: Session):
    response = client.post("/api/hooks/quick-tasks", json={"title": "Anonymous"})

    assert response.status_code == 401
    assert audit_rows(session) == []


def test_unmatched_route_is_not_audited(session: Session):
    _, token = create_token(session)

    response = client.get(
        f"/api/agent/v1/no-such-route/{uuid4()}", headers=bearer(token)
    )

    assert response.status_code == 404
    assert audit_rows(session) == []


def test_unmatched_route_with_junk_token_is_not_audited(session: Session):
    response = client.get("/api/hooks/unknown", headers=bearer("junk"))

    assert response.status_code == 404
    assert audit_rows(session) == []


def test_wrong_method_with_junk_token_is_not_audited(session: Session):
    response = client.get("/api/hooks/quick-tasks", headers=bearer("junk"))

    assert response.status_code == 405
    assert audit_rows(session) == []


def test_malformed_json_with_junk_token_is_not_audited(session: Session):
    response = client.post(
        "/api/hooks/quick-tasks",
        content="{not json",
        headers={**bearer("junk"), "Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert audit_rows(session) == []


def test_audit_row_never_contains_secret_body_or_query(session: Session):
    agent_token, token = create_token(session)
    secret = token[len(agent_token.token_prefix) + 1 :]

    response = client.post(
        "/api/hooks/quick-tasks?note=query-marker",
        headers=bearer(token),
        json={"title": "body-marker"},
    )

    assert response.status_code == 201
    rows = audit_rows(session)
    assert len(rows) == 1
    for value in rows[0].model_dump().values():
        text = str(value)
        assert token not in text
        assert secret not in text
        assert "query-marker" not in text
        assert "body-marker" not in text


def test_paths_outside_agent_prefixes_are_not_audited(session: Session):
    _, token = create_token(session)
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        user_id=str(TEST_USER_ID), email="audit-user@example.com"
    )

    agentic_response = client.get("/api/agentic", headers=bearer(token))
    tokens_response = client.get("/api/user/agent-tokens", headers=bearer(token))

    assert agentic_response.status_code == 404
    assert tokens_response.status_code == 200
    assert audit_rows(session) == []


def test_unhandled_exception_is_audited_as_500(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    _, token = create_token(session)

    def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(hooks.quick_task_service, "create_quick_task", explode)
    failing_client = TestClient(app, raise_server_exceptions=False)

    response = failing_client.post(
        "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "Boom"}
    )

    assert response.status_code == 500
    rows = audit_rows(session)
    assert len(rows) == 1
    assert rows[0].status_code == 500
    assert rows[0].route == "/api/hooks/quick-tasks"


def test_audit_write_failure_does_not_fail_response(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    _, token = create_token(session)

    def broken_session_factory() -> Session:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(agent_audit, "session_factory", broken_session_factory)

    with caplog.at_level(logging.ERROR, logger=agent_audit.__name__):
        response = client.post(
            "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "Still"}
        )

    assert response.status_code == 201
    assert "Failed to write agent audit log" in caplog.text
    assert token not in caplog.text
    assert audit_rows(session) == []


def test_audit_row_construction_failure_does_not_fail_response(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    _, token = create_token(session)

    def broken_resolve_client_ip(scope):
        raise RuntimeError("cannot resolve ip")

    monkeypatch.setattr(agent_audit, "resolve_client_ip", broken_resolve_client_ip)

    with caplog.at_level(logging.ERROR, logger=agent_audit.__name__):
        response = client.post(
            "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "Still"}
        )

    assert response.status_code == 201
    assert "Failed to write agent audit log" in caplog.text
    assert token not in caplog.text
    assert audit_rows(session) == []


def test_audit_row_construction_failure_keeps_apps_own_500(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    _, token = create_token(session)

    def explode(*args, **kwargs):
        raise RuntimeError("app boom")

    def broken_resolve_client_ip(scope):
        raise RuntimeError("audit boom")

    monkeypatch.setattr(hooks.quick_task_service, "create_quick_task", explode)
    monkeypatch.setattr(agent_audit, "resolve_client_ip", broken_resolve_client_ip)
    failing_client = TestClient(app, raise_server_exceptions=False)

    with caplog.at_level(logging.ERROR, logger=agent_audit.__name__):
        response = failing_client.post(
            "/api/hooks/quick-tasks", headers=bearer(token), json={"title": "X"}
        )

    assert response.status_code == 500
    assert "Failed to write agent audit log" in caplog.text
    assert audit_rows(session) == []


async def test_audit_failure_does_not_replace_apps_own_exception(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    _, token = create_token(session)

    async def failing_app(scope, receive, send):
        raise KeyError("app boom")

    def broken_resolve_client_ip(scope):
        raise ValueError("audit boom")

    monkeypatch.setattr(agent_audit, "resolve_client_ip", broken_resolve_client_ip)
    middleware = AgentAuditMiddleware(failing_app)
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/hooks/quick-tasks",
        "headers": [(b"authorization", f"Bearer {token}".encode())],
        "query_string": b"",
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        pass

    # The app's own exception must surface, not the audit failure.
    with pytest.raises(KeyError, match="app boom"):
        await middleware(scope, receive, send)


def test_audit_middleware_runs_inside_default_rate_limit():
    classes = [middleware.cls for middleware in app.user_middleware]  # [0] is outermost

    assert classes.index(AgentAuditMiddleware) > classes.index(
        DefaultRateLimitMiddleware
    )


def test_purge_deletes_rows_older_than_90_days(session: Session):
    now = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
    for age_days in (91, 89):
        session.add(
            AgentAuditLog(
                id=uuid4(),
                method="POST",
                route=f"/age-{age_days}",
                status_code=200,
                duration_ms=1,
                created_at=now - timedelta(days=age_days),
            )
        )
    session.commit()

    deleted = agent_audit.purge_expired_audit_logs(session, now=now)

    assert deleted == 1
    assert [row.route for row in audit_rows(session)] == ["/age-89"]


def test_retention_job_is_registered_daily(monkeypatch: pytest.MonkeyPatch):
    scheduler = notification_scheduler.get_scheduler()
    job_ids_before = {job.id for job in scheduler.get_jobs()}
    # Keep the shared module-level scheduler from actually starting.
    monkeypatch.setattr(scheduler, "start", lambda *args, **kwargs: None)

    try:
        notification_scheduler.start_notification_scheduler()
        job = scheduler.get_job("agent_audit_log_retention")

        assert job is not None
        assert job.trigger.interval == timedelta(days=1)
        # Runs shortly after boot so frequent deploys cannot starve the purge.
        assert job.next_run_time is not None
        assert job.next_run_time <= datetime.now(UTC) + timedelta(minutes=5)
        assert job.misfire_grace_time is not None
        assert job.misfire_grace_time >= 3600
    finally:
        for job in scheduler.get_jobs():
            if job.id not in job_ids_before:
                scheduler.remove_job(job.id)


async def test_retention_job_swallows_errors(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def broken_session_factory() -> Session:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(agent_audit, "session_factory", broken_session_factory)

    with caplog.at_level(logging.ERROR, logger=notification_scheduler.__name__):
        await notification_scheduler.purge_expired_agent_audit_logs()

    assert "agent audit log retention" in caplog.text


# Newer FastAPI keeps included routers nested, so scope["route"].path is
# relative to the include prefix ("/hooks/..." instead of "/api/hooks/...").
# These fake routes stand in for both shapes on any installed FastAPI version.
def fake_route(path: str) -> APIRoute:
    return APIRoute(path, endpoint=lambda: None)


@pytest.mark.parametrize(
    ("route_path", "request_path", "expected"),
    [
        # Older FastAPI: the route carries the full template
        (
            "/api/agent/v1/tasks/{task_id}",
            "/api/agent/v1/tasks/1f0c",
            "/api/agent/v1/tasks/{task_id}",
        ),
        # Newer FastAPI: the route is relative to the include prefix
        (
            "/agent/v1/tasks/{task_id}",
            "/api/agent/v1/tasks/1f0c",
            "/api/agent/v1/tasks/{task_id}",
        ),
        ("/hooks/quick-tasks", "/api/hooks/quick-tasks", "/api/hooks/quick-tasks"),
    ],
)
def test_route_template_includes_the_router_prefix(route_path, request_path, expected):
    scope = {"route": fake_route(route_path), "path": request_path}
    assert agent_audit.route_template(scope) == expected


def test_route_template_without_route_is_unmatched():
    assert agent_audit.route_template({"path": "/api/agent/v1/x"}) == "<unmatched>"


def test_route_template_never_returns_a_raw_path():
    # A route that does not match the request path must not leak the raw path
    scope = {"route": fake_route("/hooks/quick-tasks"), "path": "/api/agent/v1/9a7b"}
    assert agent_audit.route_template(scope) == "<unmatched>"
