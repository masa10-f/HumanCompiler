# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import hashlib
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI, Request, Response
from fastapi.testclient import TestClient
from sqlmodel import Session

from humancompiler_api.agent_auth import (
    AgentPrincipal,
    extract_token_prefix,
    require_scope,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import AgentScope, AgentToken, User
from humancompiler_api.services import AgentTokenService, agent_token_service

USER_ID = UUID("12345678-1234-1234-1234-123456789012")

TOKEN_HEADERS = [
    "Authorization",
    "X-HumanCompiler-Agent-Token",
    "X-HumanCompiler-Hook-Token",
]


def build_app(session: Session) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def expose_required_scope(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Seen-Required-Scope"] = getattr(
            request.state, "required_scope", ""
        )
        return response

    @app.get("/needs-tasks")
    def needs_tasks(
        request: Request,
        principal: Annotated[
            AgentPrincipal, Depends(require_scope(AgentScope.TASKS_READ))
        ],
    ) -> dict[str, str]:
        assert request.state.agent_principal is principal
        return {
            "required_scope": request.state.required_scope,
            "user_id": str(principal.user_id),
        }

    @app.get("/needs-hook")
    def needs_hook(
        request: Request,
        principal: Annotated[
            AgentPrincipal, Depends(require_scope(AgentScope.QUICK_TASKS_WRITE))
        ],
    ) -> dict[str, str]:
        return {
            "required_scope": request.state.required_scope,
            "user_id": str(principal.user_id),
        }

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    return app


@pytest.fixture
def client(session: Session) -> TestClient:
    session.add(User(id=USER_ID, email="agent-user@example.com"))
    session.commit()
    return TestClient(build_app(session))


def make_token(
    session: Session, scopes: list[AgentScope] | None = None
) -> tuple[AgentToken, str]:
    return agent_token_service.create_token(
        session, USER_ID, "test token", scopes or [AgentScope.TASKS_READ]
    )


def auth_headers(header: str, token: str) -> dict[str, str]:
    return {header: f"Bearer {token}" if header == "Authorization" else token}


def test_extract_token_prefix_handles_underscores_in_public_id():
    assert extract_token_prefix("hc_agent_a_b_c_d__secret") == "hc_agent_a_b_c_d_"
    assert extract_token_prefix("hc_hook_AbCd-123_secret") == "hc_hook_AbCd-123"
    for bad in ["invalid-token", "hc_agent_short", "eyJhbGciOi.eyJzdWIi.sig", ""]:
        assert extract_token_prefix(bad) is None


def test_generated_token_prefix_round_trips():
    for _ in range(100):
        token, prefix = AgentTokenService.generate_token()
        assert extract_token_prefix(token) == prefix


@pytest.mark.parametrize("header", TOKEN_HEADERS)
def test_all_token_headers_are_accepted(
    client: TestClient, session: Session, header: str
):
    _, token = make_token(session)

    response = client.get("/needs-tasks", headers=auth_headers(header, token))

    assert response.status_code == 200
    assert response.json() == {
        "required_scope": "tasks:read",
        "user_id": str(USER_ID),
    }


def test_non_bearer_authorization_falls_through(client: TestClient, session: Session):
    _, token = make_token(session)

    response = client.get(
        "/needs-tasks",
        headers={
            "Authorization": "Basic dXNlcjpwYXNz",
            "X-HumanCompiler-Agent-Token": token,
        },
    )

    assert response.status_code == 200


@pytest.mark.parametrize("authorization", ["Bearer ", "Bearer", "Bearer    "])
def test_empty_bearer_is_401(client: TestClient, authorization: str):
    response = client.get("/needs-tasks", headers={"Authorization": authorization})

    assert response.status_code == 401
    assert response.json()["detail"] == "Agent token required"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_missing_invalid_and_revoked_tokens_are_401(
    client: TestClient, session: Session
):
    missing = client.get("/needs-tasks")
    assert missing.status_code == 401
    assert missing.json()["detail"] == "Agent token required"
    assert missing.headers["WWW-Authenticate"] == "Bearer"

    invalid = client.get(
        "/needs-tasks", headers=auth_headers("Authorization", "invalid-token")
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Invalid agent token"

    agent_token, token = make_token(session)
    assert agent_token.id is not None
    agent_token_service.revoke_token(session, agent_token.id, USER_ID)
    revoked = client.get("/needs-tasks", headers=auth_headers("Authorization", token))
    assert revoked.status_code == 401
    assert revoked.json()["detail"] == "Invalid agent token"


def test_supabase_jwt_is_rejected(client: TestClient):
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl"

    response = client.get("/needs-tasks", headers=auth_headers("Authorization", jwt))

    assert response.status_code == 401


def test_required_scope_is_recorded_even_when_unauthenticated(client: TestClient):
    response = client.get("/needs-tasks")

    assert response.status_code == 401
    assert response.headers["X-Seen-Required-Scope"] == "tasks:read"


def test_missing_scope_is_403_with_scope_name(client: TestClient, session: Session):
    _, token = make_token(session, [AgentScope.QUICK_TASKS_WRITE])

    response = client.get("/needs-tasks", headers=auth_headers("Authorization", token))

    assert response.status_code == 403
    assert "tasks:read" in response.json()["detail"]
    assert response.headers["X-Seen-Required-Scope"] == "tasks:read"


def test_unknown_stored_scope_does_not_break_auth(client: TestClient, session: Session):
    token = "hc_agent_unknown1_" + "s" * 43
    session.add(
        AgentToken(
            id=uuid4(),
            user_id=USER_ID,
            name="future scopes",
            scopes=["quick_tasks:write", "proposals:write"],
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            token_prefix="hc_agent_unknown1",
        )
    )
    session.commit()
    headers = auth_headers("Authorization", token)

    assert client.get("/needs-hook", headers=headers).status_code == 200
    assert client.get("/needs-tasks", headers=headers).status_code == 403


def test_successful_request_sets_last_used_at(client: TestClient, session: Session):
    agent_token, token = make_token(session)
    assert agent_token.last_used_at is None
    before = datetime.now(UTC) - timedelta(seconds=1)

    response = client.get("/needs-tasks", headers=auth_headers("Authorization", token))

    assert response.status_code == 200
    session.refresh(agent_token)
    assert agent_token.last_used_at is not None
    last_used_at = agent_token.last_used_at
    if last_used_at.tzinfo is None:
        last_used_at = last_used_at.replace(tzinfo=UTC)
    assert last_used_at >= before
