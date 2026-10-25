import logging
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api import models
from humancompiler_api.models import AgentScope, AgentToken, QuickTask, User
from humancompiler_api.routers import hooks
from humancompiler_api.services import agent_token_service

client = TestClient(app)

TEST_USER_ID = UUID("12345678-1234-1234-1234-123456789012")


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    clear_overrides()
    yield
    clear_overrides()


def seed_user(session: Session, user_id: UUID = TEST_USER_ID) -> User:
    user = User(id=user_id, email=f"hook-user-{user_id}@example.com")
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
    _, token = agent_token_service.create_token(
        session, TEST_USER_ID, name, [AgentScope.QUICK_TASKS_WRITE]
    )
    return token


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

    stored_token = session.exec(select(AgentToken)).one()
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
    token_id = session.exec(select(AgentToken.id)).one()
    revoke_response = client.delete(f"/api/user/agent-tokens/{token_id}")

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


def insert_agent_token(
    session: Session,
    user_id: UUID,
    scopes: list[str],
    token: str | None = None,
    token_prefix: str = "hc_agent_AbCdEfGh",
) -> tuple[AgentToken, str]:
    token = token or f"{token_prefix}_secret-{uuid4().hex}"
    agent_token = AgentToken(
        id=uuid4(),
        user_id=user_id,
        name="Inserted token",
        scopes=scopes,
        token_hash=agent_token_service.hash_token(token),
        token_prefix=token_prefix,
    )
    session.add(agent_token)
    session.commit()
    return agent_token, token


def test_migrated_hook_token_works_with_both_headers(session: Session):
    seed_user(session)
    install_overrides(session)
    # Same shape as the rows migration 035 copies from the old hook token table.
    _, token = insert_agent_token(
        session,
        TEST_USER_ID,
        ["quick_tasks:write"],
        token="hc_hook_AbCdEfGh_migratedsecret",
        token_prefix="hc_hook_AbCdEfGh",
    )

    bearer_response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Via bearer"},
    )
    header_response = client.post(
        "/api/hooks/quick-tasks",
        headers={"X-HumanCompiler-Hook-Token": token},
        json={"title": "Via hook header"},
    )

    assert bearer_response.status_code == 201
    assert header_response.status_code == 201


def test_migrated_hook_token_cannot_read_tasks(session: Session):
    seed_user(session)
    install_overrides(session)
    _, token = insert_agent_token(
        session,
        TEST_USER_ID,
        ["quick_tasks:write"],
        token="hc_hook_AbCdEfGh_migratedsecret",
        token_prefix="hc_hook_AbCdEfGh",
    )

    response = client.get(
        "/api/agent/v1/tasks", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing required scope: tasks:read"


def test_hook_rejects_token_without_quick_tasks_write(session: Session):
    seed_user(session)
    install_overrides(session)
    _, token = insert_agent_token(session, TEST_USER_ID, ["tasks:read"])

    response = client.post(
        "/api/hooks/quick-tasks",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Not allowed"},
    )

    assert response.status_code == 403
    assert session.exec(select(QuickTask)).all() == []


def test_hook_token_management_api_is_removed(session: Session):
    seed_user(session)
    install_overrides(session)
    assert client.get("/api/user/hook-tokens").status_code == 404
    assert client.post("/api/user/hook-tokens", json={"name": "x"}).status_code in (
        404,
        405,
    )
    assert not hasattr(models, "HookToken")
    assert not hasattr(models, "HookTokenResponse")
