# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import base64
import json
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentAuditLog, AgentScope, ProjectStatus
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_project,
    seed_user,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


@pytest.fixture(autouse=True)
def agent_session(session: Session):
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def test_me_returns_token_identity(session: Session):
    # No read scope: /me needs authentication only
    secret = issue_token(
        session, USER_A, [AgentScope.QUICK_TASKS_WRITE], name="My agent"
    )

    response = client.get("/api/agent/v1/me", headers=bearer(secret))

    assert response.status_code == 200
    body = response.json()
    assert body["token_name"] == "My agent"
    assert body["token_prefix"] == secret[: len(body["token_prefix"])]
    assert body["token_prefix"].startswith("hc_agent_")
    assert body["scopes"] == ["quick_tasks:write"]
    assert body["user_id"] == str(USER_A)


def test_me_returns_scopes_in_ascending_order(session: Session):
    secret = issue_token(
        session,
        USER_A,
        [AgentScope.TASKS_READ, AgentScope.GOALS_READ, AgentScope.PROJECTS_READ],
    )

    response = client.get("/api/agent/v1/me", headers=bearer(secret))

    assert response.json()["scopes"] == ["goals:read", "projects:read", "tasks:read"]


def test_me_rejects_supabase_jwt(session: Session):
    def part(payload: dict[str, str]) -> str:
        raw = json.dumps(payload).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    jwt_like = ".".join(
        [part({"alg": "HS256", "typ": "JWT"}), part({"sub": str(USER_A)}), "sig"]
    )

    response = client.get("/api/agent/v1/me", headers=bearer(jwt_like))

    assert response.status_code == 401


def test_list_projects_returns_only_own(session: Session):
    own = {
        seed_project(session, USER_A).id,
        seed_project(session, USER_A).id,
    }
    seed_project(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get("/api/agent/v1/projects", headers=bearer(secret))

    assert response.status_code == 200
    body = response.json()
    assert {UUID(item["id"]) for item in body["items"]} == own
    assert body["next_cursor"] is None


def test_list_projects_filters_by_status(session: Session):
    seed_project(session, USER_A, status=ProjectStatus.PENDING)
    active = seed_project(session, USER_A, status=ProjectStatus.IN_PROGRESS)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        "/api/agent/v1/projects",
        params={"status": "in_progress"},
        headers=bearer(secret),
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(active.id)]


def test_get_project_returns_own(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        f"/api/agent/v1/projects/{project.id}", headers=bearer(secret)
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(project.id)


def test_get_project_of_other_user_or_missing_is_404(session: Session):
    others = seed_project(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    for project_id in (others.id, uuid4()):
        response = client.get(
            f"/api/agent/v1/projects/{project_id}", headers=bearer(secret)
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"


def test_projects_require_projects_read_scope(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    for path in ("/api/agent/v1/projects", f"/api/agent/v1/projects/{project.id}"):
        response = client.get(path, headers=bearer(secret))
        assert response.status_code == 403
        assert response.json()["detail"] == "Missing required scope: projects:read"


def test_agent_read_is_audited_with_route_template(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        f"/api/agent/v1/projects/{project.id}", headers=bearer(secret)
    )

    assert response.status_code == 200
    session.expire_all()
    rows = list(session.exec(select(AgentAuditLog)).all())
    assert len(rows) == 1
    assert rows[0].route == "/api/agent/v1/projects/{project_id}"
    assert rows[0].required_scope == "projects:read"
    assert rows[0].status_code == 200


def test_list_endpoints_document_incremental_sync():
    description = app.openapi()["paths"]["/api/agent/v1/projects"]["get"]["description"]

    assert "5 minutes" in description
