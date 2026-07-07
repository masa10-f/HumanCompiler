import hashlib
import logging
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import HookToken, QuickTask, User
from humancompiler_api.routers import hooks

client = TestClient(app)

TEST_USER_ID = UUID("12345678-1234-1234-1234-123456789012")


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    clear_overrides()
    yield
    clear_overrides()


def seed_user(session: Session, user_id: UUID = TEST_USER_ID) -> User:
    user = User(id=user_id, email="hook-user@example.com")
    session.add(user)
    session.commit()
    return user


def install_overrides(session: Session, user_id: UUID = TEST_USER_ID) -> None:
    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(user_id), email="hook-user@example.com")

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user


def clear_overrides() -> None:
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def create_hook_token(session: Session, name: str = "PR reviews") -> str:
    seed_user(session)
    install_overrides(session)
    response = client.post("/api/user/hook-tokens", json={"name": name})

    assert response.status_code == 201
    return response.json()["token"]


def test_create_hook_token_returns_secret_once_and_stores_hash(session: Session):
    seed_user(session)
    install_overrides(session)

    response = client.post(
        "/api/user/hook-tokens",
        json={"name": "  PR review hook  "},
    )
    list_response = client.get("/api/user/hook-tokens")

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "PR review hook"
    assert data["token"].startswith("hc_hook_")
    assert data["token_prefix"] == data["token"][:16]
    assert "token_hash" not in data

    stored_token = session.exec(select(HookToken)).one()
    assert (
        stored_token.token_hash
        == hashlib.sha256(data["token"].encode("utf-8")).hexdigest()
    )
    assert stored_token.token_hash != data["token"]

    assert list_response.status_code == 200
    listed_token = list_response.json()[0]
    assert listed_token["name"] == "PR review hook"
    assert listed_token["token_prefix"] == data["token_prefix"]
    assert "token" not in listed_token
    assert "token_hash" not in listed_token


def test_hook_token_creates_quick_task_and_updates_last_used(session: Session):
    token = create_hook_token(session)

    response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": "Review PR 299",
            "description": "Read comments",
            "estimate_hours": 0.5,
            "priority": 2,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Review PR 299"
    assert data["owner_id"] == str(TEST_USER_ID)

    quick_task = session.exec(select(QuickTask)).one()
    assert quick_task.title == "Review PR 299"
    assert quick_task.owner_id == TEST_USER_ID

    stored_token = session.exec(select(HookToken)).one()
    assert stored_token.last_used_at is not None


def test_hook_token_header_creates_quick_task(session: Session):
    token = create_hook_token(session)

    response = client.post(
        "/api/hooks/quick-tasks",
        headers={"X-HumanCompiler-Hook-Token": token},
        json={"title": "Read paper"},
    )

    assert response.status_code == 201
    assert response.json()["title"] == "Read paper"


def test_missing_invalid_and_revoked_hook_tokens_are_rejected(session: Session):
    token = create_hook_token(session)
    token_id = session.exec(select(HookToken.id)).one()
    revoke_response = client.delete(f"/api/user/hook-tokens/{token_id}")

    assert revoke_response.status_code == 204

    missing_response = client.post(
        "/api/hooks/quick-tasks",
        json={"title": "Missing token task"},
    )
    invalid_response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": "Bearer invalid-token"},
        json={"title": "Invalid token task"},
    )
    revoked_response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Revoked token task"},
    )

    assert missing_response.status_code == 401
    assert invalid_response.status_code == 401
    assert revoked_response.status_code == 401
    assert session.exec(select(QuickTask)).all() == []


def test_hook_quick_task_validation_uses_existing_quick_task_schema(session: Session):
    token = create_hook_token(session)

    response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Invalid priority", "priority": 9},
    )

    assert response.status_code == 422
    assert session.exec(select(QuickTask)).all() == []


def test_hook_quick_task_logs_do_not_include_user_content(session: Session, caplog):
    token = create_hook_token(session)

    with caplog.at_level(logging.INFO, logger=hooks.logger.name):
        response = client.post(
            "/api/hooks/quick-tasks",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "title": "Sensitive hook title",
                "description": "Sensitive hook description",
            },
        )

    assert response.status_code == 201
    assert str(TEST_USER_ID) in caplog.text
    assert "Sensitive hook title" not in caplog.text
    assert "Sensitive hook description" not in caplog.text
