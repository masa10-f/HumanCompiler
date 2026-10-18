# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentAuditLog,
    AgentScope,
    AgentToken,
    User,
)
from humancompiler_api.services import agent_token_service

client = TestClient(app)

TEST_USER_ID = UUID("12345678-1234-1234-1234-123456789012")
OTHER_USER_ID = UUID("87654321-4321-4321-4321-210987654321")
BASE_URL = "/api/user/agent-tokens"


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    clear_overrides()
    yield
    clear_overrides()


def seed_user(session: Session, user_id: UUID = TEST_USER_ID) -> None:
    session.add(User(id=user_id, email=f"agent-user-{user_id}@example.com"))
    session.commit()


def install_overrides(session: Session, user_id: UUID = TEST_USER_ID) -> None:
    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(user_id), email="agent-user@example.com")

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user


def clear_overrides() -> None:
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def setup_user(session: Session) -> None:
    seed_user(session)
    install_overrides(session)


def create_token_via_api(session: Session, scopes: list[str], name: str = "agent"):
    response = client.post(BASE_URL, json={"name": name, "scopes": scopes})
    assert response.status_code == 201
    return response.json()


def insert_token(session: Session, user_id: UUID, scopes: list[str]) -> AgentToken:
    token, _ = agent_token_service.create_token(
        session, user_id, "seeded", [AgentScope(s) for s in scopes]
    )
    session.commit()
    return token


def insert_audit_rows(
    session: Session,
    token: AgentToken,
    count: int,
    start: datetime | None = None,
) -> list[AgentAuditLog]:
    start = start or datetime(2026, 1, 1, tzinfo=UTC)
    rows = []
    for index in range(count):
        row = AgentAuditLog(
            id=uuid4(),
            token_id=token.id,
            user_id=token.user_id,
            token_prefix=token.token_prefix,
            method="GET",
            route=f"/api/agent/v1/route-{index}",
            required_scope="tasks:read",
            status_code=200,
            duration_ms=index,
            client_ip="203.0.113.7",
            created_at=start + timedelta(seconds=index),
        )
        session.add(row)
        rows.append(row)
    session.commit()
    return rows


def test_create_returns_secret_once_and_list_hides_it(session: Session):
    setup_user(session)

    response = client.post(
        BASE_URL,
        json={
            "name": " laptop ",
            "description": "MacBook",
            "scopes": ["tasks:read", "projects:read"],
        },
    )
    list_response = client.get(BASE_URL)

    assert response.status_code == 201
    data = response.json()
    assert data["token"].startswith("hc_agent_")
    assert data["name"] == "laptop"
    assert data["description"] == "MacBook"
    assert data["scopes"] == ["projects:read", "tasks:read"]
    assert data["token"].startswith(f"{data['token_prefix']}_")
    assert "token_hash" not in data

    assert list_response.status_code == 200
    listed = list_response.json()
    assert len(listed) == 1
    assert listed[0]["id"] == data["id"]
    assert "token" not in listed[0]
    assert "token_hash" not in listed[0]


def test_create_blank_description_is_stored_as_none(session: Session):
    setup_user(session)

    response = client.post(
        BASE_URL,
        json={"name": "agent", "description": "   ", "scopes": ["tasks:read"]},
    )

    assert response.status_code == 201
    assert response.json()["description"] is None


def test_trailing_slash_routes_work(session: Session):
    setup_user(session)

    created = client.post(
        BASE_URL + "/", json={"name": "agent", "scopes": ["tasks:read"]}
    )
    listed = client.get(BASE_URL + "/")

    assert created.status_code == 201
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_create_rejects_unknown_or_empty_scopes(session: Session):
    setup_user(session)

    unknown = client.post(
        BASE_URL, json={"name": "agent", "scopes": ["proposals:write"]}
    )
    empty = client.post(BASE_URL, json={"name": "agent", "scopes": []})

    assert unknown.status_code == 422
    assert empty.status_code == 422
    assert session.exec(select(AgentToken)).all() == []


def test_create_rejects_blank_name_and_long_description(session: Session):
    setup_user(session)

    blank_name = client.post(BASE_URL, json={"name": "  ", "scopes": ["tasks:read"]})
    long_description = client.post(
        BASE_URL,
        json={"name": "agent", "description": "x" * 501, "scopes": ["tasks:read"]},
    )

    assert blank_name.status_code == 422
    assert long_description.status_code == 422
    assert session.exec(select(AgentToken)).all() == []


def test_revoke_makes_token_invalid_immediately(session: Session):
    setup_user(session)
    created = create_token_via_api(session, ["quick_tasks:write"])
    secret = created["token"]

    revoke = client.delete(f"{BASE_URL}/{created['id']}")
    hook_response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {secret}"},
        json={"title": "Should be rejected"},
    )
    list_response = client.get(BASE_URL)

    assert revoke.status_code == 204
    assert hook_response.status_code == 401
    assert list_response.json() == []


def test_revoke_other_users_token_returns_404(session: Session):
    seed_user(session, OTHER_USER_ID)
    other_token = insert_token(session, OTHER_USER_ID, ["tasks:read"])
    setup_user(session)

    response = client.delete(f"{BASE_URL}/{other_token.id}")

    assert response.status_code == 404
    session.refresh(other_token)
    assert other_token.revoked_at is None


def test_revoke_invalid_or_missing_token_id(session: Session):
    setup_user(session)

    missing = client.delete(f"{BASE_URL}/{uuid4()}")
    malformed = client.delete(f"{BASE_URL}/not-a-uuid")

    assert missing.status_code == 404
    assert malformed.status_code in (400, 422)


def test_scopes_lists_every_scope_with_description(session: Session):
    setup_user(session)

    response = client.get(f"{BASE_URL}/scopes")

    assert response.status_code == 200
    body = response.json()
    assert [item["scope"] for item in body] == [scope.value for scope in AgentScope]
    assert all(item["description"] for item in body)
    descriptions = {item["scope"]: item["description"] for item in body}
    assert "広い読み取り権限" in descriptions["context:read"]


def test_audit_logs_returns_newest_rows_for_own_token(session: Session):
    setup_user(session)
    token_a = insert_token(session, TEST_USER_ID, ["tasks:read"])
    token_b = insert_token(session, TEST_USER_ID, ["tasks:read"])
    rows_a = insert_audit_rows(session, token_a, 3)
    insert_audit_rows(session, token_b, 1)

    response = client.get(f"{BASE_URL}/{token_a.id}/audit-logs?limit=2")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [str(rows_a[2].id), str(rows_a[1].id)]
    assert body[0]["route"] == "/api/agent/v1/route-2"
    assert body[0]["client_ip"] == "203.0.113.7"
    assert body[0]["token_id"] == str(token_a.id)
    assert {
        "method",
        "required_scope",
        "status_code",
        "duration_ms",
        "token_prefix",
        "created_at",
    } <= set(body[0])
    assert "user_id" not in body[0]


def test_audit_logs_limit_bounds(session: Session):
    setup_user(session)
    token = insert_token(session, TEST_USER_ID, ["tasks:read"])
    insert_audit_rows(session, token, 55)

    zero = client.get(f"{BASE_URL}/{token.id}/audit-logs?limit=0")
    too_many = client.get(f"{BASE_URL}/{token.id}/audit-logs?limit=201")
    default = client.get(f"{BASE_URL}/{token.id}/audit-logs")

    assert zero.status_code == 422
    assert too_many.status_code == 422
    assert default.status_code == 200
    assert len(default.json()) == 50


def test_audit_logs_for_revoked_own_token_are_listed(session: Session):
    setup_user(session)
    created = create_token_via_api(session, ["tasks:read"])
    token = session.exec(select(AgentToken)).one()
    insert_audit_rows(session, token, 2)
    assert client.delete(f"{BASE_URL}/{created['id']}").status_code == 204

    response = client.get(f"{BASE_URL}/{created['id']}/audit-logs")

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_audit_logs_for_other_users_token_returns_404(session: Session):
    seed_user(session, OTHER_USER_ID)
    other_token = insert_token(session, OTHER_USER_ID, ["tasks:read"])
    insert_audit_rows(session, other_token, 2)
    setup_user(session)

    response = client.get(f"{BASE_URL}/{other_token.id}/audit-logs")
    missing = client.get(f"{BASE_URL}/{uuid4()}/audit-logs")

    assert response.status_code == 404
    assert missing.status_code == 404
