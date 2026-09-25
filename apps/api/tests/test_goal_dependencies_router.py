# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_db
from humancompiler_api.main import app
from humancompiler_api.models import Goal, GoalDependency, Project, Task, User

client = TestClient(app)

OWNER_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_ID = UUID("22222222-2222-2222-2222-222222222222")


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    clear_overrides()
    yield
    clear_overrides()


def install_overrides(session: Session, user_id: UUID | None = OWNER_ID) -> None:
    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    if user_id is not None:
        app.dependency_overrides[get_current_user] = lambda: AuthUser(
            user_id=str(user_id), email=f"{user_id}@example.com"
        )


def clear_overrides() -> None:
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def seed_goals(session: Session, owner_id: UUID, count: int = 2) -> list[Goal]:
    if session.get(User, owner_id) is None:
        session.add(User(id=owner_id, email=f"{owner_id}@example.com"))
    project = Project(id=uuid4(), owner_id=owner_id, title="Project")
    session.add(project)
    goals = [
        Goal(id=uuid4(), project_id=project.id, title=f"Goal {i}", estimate_hours=1)
        for i in range(count)
    ]
    session.add_all(goals)
    session.commit()
    return goals


def seed_dependency(session: Session, goal: Goal, depends_on: Goal) -> GoalDependency:
    dependency = GoalDependency(
        id=uuid4(), goal_id=goal.id, depends_on_goal_id=depends_on.id
    )
    session.add(dependency)
    session.commit()
    return dependency


def test_endpoints_require_authentication(session: Session):
    goal_a, goal_b = seed_goals(session, OWNER_ID)
    dependency = seed_dependency(session, goal_a, goal_b)
    install_overrides(session, user_id=None)

    responses = [
        client.get(f"/api/goal-dependencies/goal/{goal_a.id}"),
        client.post(
            "/api/goal-dependencies/",
            json={"goal_id": str(goal_b.id), "depends_on_goal_id": str(goal_a.id)},
        ),
        client.delete(f"/api/goal-dependencies/{dependency.id}"),
    ]

    # HTTPBearer returns 403 on older FastAPI (uv.lock) and 401 on newer releases
    assert all(r.status_code in (401, 403) for r in responses)
    assert session.get(GoalDependency, dependency.id) is not None


def test_owner_can_create_list_and_delete(session: Session):
    goal_a, goal_b = seed_goals(session, OWNER_ID)
    install_overrides(session)

    create_response = client.post(
        "/api/goal-dependencies/",
        json={"goal_id": str(goal_a.id), "depends_on_goal_id": str(goal_b.id)},
    )
    assert create_response.status_code == 201
    dependency_id = create_response.json()["id"]

    list_response = client.get(f"/api/goal-dependencies/goal/{goal_a.id}")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert [d["id"] for d in listed] == [dependency_id]
    assert listed[0]["depends_on_goal"]["title"] == "Goal 1"

    delete_response = client.delete(f"/api/goal-dependencies/{dependency_id}")
    assert delete_response.status_code == 204
    assert session.exec(select(GoalDependency)).all() == []


def test_frontend_trailing_slash_paths_are_served_without_redirect(session: Session):
    goal_a, goal_b = seed_goals(session, OWNER_ID)
    dependency = seed_dependency(session, goal_a, goal_b)
    install_overrides(session)

    list_response = client.get(
        f"/api/goal-dependencies/goal/{goal_a.id}/", follow_redirects=False
    )
    delete_response = client.delete(
        f"/api/goal-dependencies/{dependency.id}/", follow_redirects=False
    )

    assert list_response.status_code == 200
    assert delete_response.status_code == 204


def test_cannot_read_other_users_goal_dependencies(session: Session):
    victim_a, victim_b = seed_goals(session, OTHER_ID)
    seed_dependency(session, victim_a, victim_b)
    seed_goals(session, OWNER_ID)
    install_overrides(session)

    response = client.get(f"/api/goal-dependencies/goal/{victim_a.id}")

    assert response.status_code == 404
    assert "Goal 1" not in response.text


def test_cannot_link_to_other_users_goal(session: Session):
    (own_goal,) = seed_goals(session, OWNER_ID, count=1)
    (victim_goal,) = seed_goals(session, OTHER_ID, count=1)
    install_overrides(session)

    responses = [
        client.post(
            "/api/goal-dependencies/",
            json={
                "goal_id": str(own_goal.id),
                "depends_on_goal_id": str(victim_goal.id),
            },
        ),
        client.post(
            "/api/goal-dependencies/",
            json={
                "goal_id": str(victim_goal.id),
                "depends_on_goal_id": str(own_goal.id),
            },
        ),
    ]

    assert [r.status_code for r in responses] == [404, 404]
    assert session.exec(select(GoalDependency)).all() == []


def test_cannot_delete_other_users_dependency(session: Session):
    victim_a, victim_b = seed_goals(session, OTHER_ID)
    dependency = seed_dependency(session, victim_a, victim_b)
    seed_goals(session, OWNER_ID)
    install_overrides(session)

    other_users_response = client.delete(f"/api/goal-dependencies/{dependency.id}")
    missing_response = client.delete(f"/api/goal-dependencies/{uuid4()}")

    assert other_users_response.status_code == 404
    # Not-owned and missing look the same, so dependency IDs can't be probed
    assert other_users_response.json() == missing_response.json()
    assert session.get(GoalDependency, dependency.id) is not None


def test_legacy_task_dependencies_routes_are_removed(session: Session):
    (goal,) = seed_goals(session, OTHER_ID, count=1)
    task = Task(id=uuid4(), goal_id=goal.id, title="Private task", estimate_hours=1)
    session.add(task)
    session.commit()
    install_overrides(session, user_id=None)

    response = client.get(f"/api/task-dependencies/task/{task.id}")

    assert response.status_code == 404
    assert "Private task" not in response.text
