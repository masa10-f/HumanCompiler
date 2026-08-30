"""Tests for dashboard shortcut endpoints."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import Goal, Project, Task, User


@pytest.fixture
def test_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    yield
    app.dependency_overrides.clear()


def test_recent_items_are_mixed_sorted_limited_and_owner_scoped(
    test_session: Session,
):
    now = datetime.now(UTC)
    owner = User(id=uuid4(), email="owner@example.com")
    other_owner = User(id=uuid4(), email="other@example.com")
    project = Project(id=uuid4(), owner_id=owner.id, title="Main project")
    other_project = Project(id=uuid4(), owner_id=other_owner.id, title="Other project")
    test_session.add_all([owner, other_owner, project, other_project])
    test_session.commit()

    goals = [
        Goal(
            id=uuid4(),
            project_id=project.id,
            title=f"Goal {index}",
            estimate_hours=1,
            updated_at=now - timedelta(minutes=index * 2),
        )
        for index in range(4)
    ]
    other_goal = Goal(
        id=uuid4(),
        project_id=other_project.id,
        title="Other owner's newest goal",
        estimate_hours=1,
        updated_at=now + timedelta(minutes=1),
    )
    test_session.add_all([*goals, other_goal])
    test_session.commit()

    tasks = [
        Task(
            id=uuid4(),
            goal_id=goals[0].id,
            title=f"Task {index}",
            estimate_hours=1,
            updated_at=now - timedelta(minutes=index * 2 + 1),
        )
        for index in range(4)
    ]
    other_task = Task(
        id=uuid4(),
        goal_id=other_goal.id,
        title="Other owner's newest task",
        estimate_hours=1,
        updated_at=now + timedelta(minutes=2),
    )
    test_session.add_all([*tasks, other_task])
    test_session.commit()

    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        user_id=str(owner.id), email=owner.email
    )
    app.dependency_overrides[get_session] = lambda: test_session

    response = TestClient(app).get("/api/dashboard/recent-items?limit=5")

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 5
    assert [item["title"] for item in items] == [
        "Goal 0",
        "Task 0",
        "Goal 1",
        "Task 1",
        "Goal 2",
    ]
    assert [item["kind"] for item in items] == [
        "goal",
        "task",
        "goal",
        "task",
        "goal",
    ]
    assert all(item["project_id"] == str(project.id) for item in items)
    assert items[1]["goal_id"] == str(goals[0].id)
    assert items[1]["goal_title"] == goals[0].title
    assert not any("Other owner" in item["title"] for item in items)


def test_recent_items_returns_empty_list_for_user_without_items(
    test_session: Session,
):
    owner = User(id=uuid4(), email="empty@example.com")
    test_session.add(owner)
    test_session.commit()

    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        user_id=str(owner.id), email=owner.email
    )
    app.dependency_overrides[get_session] = lambda: test_session

    response = TestClient(app).get("/api/dashboard/recent-items")

    assert response.status_code == 200
    assert response.json() == []
