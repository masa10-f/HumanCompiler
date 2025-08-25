"""Tests for weekly recurring tasks functionality."""

import pytest
from decimal import Decimal
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from humancompiler_api.models import (
    TaskCategory,
    WeeklyRecurringTask,
    WeeklyRecurringTaskCreate,
    WeeklyRecurringTaskUpdate,
    User,
)
from humancompiler_api.services import weekly_recurring_task_service


@pytest.fixture
def test_session():
    """Create test database session"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


@pytest.fixture
def test_user(test_session):
    """Create test user"""
    user = User(id=uuid4(), email="test@example.com")
    test_session.add(user)
    test_session.commit()
    test_session.refresh(user)
    return user


@pytest.fixture
def sample_weekly_recurring_task_data():
    """Sample weekly recurring task data for testing."""
    return {
        "title": "週次振り返り会議",
        "description": "チームの週次振り返り会議",
        "estimate_hours": 2.0,
        "category": TaskCategory.MEETING,
        "is_active": True,
    }


def test_create_weekly_recurring_task(
    test_session: Session, test_user, sample_weekly_recurring_task_data
):
    """Test creating a weekly recurring task."""
    task_data = WeeklyRecurringTaskCreate(**sample_weekly_recurring_task_data)

    task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data, test_user.id
    )

    assert task.title == "週次振り返り会議"
    assert task.description == "チームの週次振り返り会議"
    assert task.estimate_hours == Decimal("2.0")
    assert task.category == TaskCategory.MEETING
    assert task.is_active is True
    assert task.user_id == test_user.id
    assert task.id is not None


def test_get_weekly_recurring_tasks(
    test_session: Session, test_user, sample_weekly_recurring_task_data
):
    """Test getting weekly recurring tasks."""
    # Create multiple tasks
    task_data_1 = WeeklyRecurringTaskCreate(**sample_weekly_recurring_task_data)
    task_data_2 = WeeklyRecurringTaskCreate(
        title="運動",
        description="週3回の運動",
        estimate_hours=3.0,
        category=TaskCategory.EXERCISE,
        is_active=True,
    )

    task1 = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data_1, test_user.id
    )
    task2 = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data_2, test_user.id
    )

    # Get all tasks
    tasks = weekly_recurring_task_service.get_weekly_recurring_tasks(
        test_session, test_user.id
    )

    assert len(tasks) >= 2
    task_ids = [task.id for task in tasks]
    assert task1.id in task_ids
    assert task2.id in task_ids


def test_get_weekly_recurring_tasks_with_filters(test_session: Session, test_user):
    """Test getting weekly recurring tasks with filters."""
    # Create tasks with different categories and statuses
    active_meeting_task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session,
        WeeklyRecurringTaskCreate(
            title="週次会議",
            estimate_hours=1.5,
            category=TaskCategory.MEETING,
            is_active=True,
        ),
        test_user.id,
    )

    inactive_study_task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session,
        WeeklyRecurringTaskCreate(
            title="勉強",
            estimate_hours=2.0,
            category=TaskCategory.STUDY,
            is_active=False,
        ),
        test_user.id,
    )

    # Filter by category
    meeting_tasks = weekly_recurring_task_service.get_weekly_recurring_tasks(
        test_session, test_user.id, category=TaskCategory.MEETING
    )
    assert len(meeting_tasks) >= 1
    assert all(task.category == TaskCategory.MEETING for task in meeting_tasks)

    # Filter by active status
    active_tasks = weekly_recurring_task_service.get_weekly_recurring_tasks(
        test_session, test_user.id, is_active=True
    )
    assert len(active_tasks) >= 1
    assert all(task.is_active is True for task in active_tasks)

    # Filter by inactive status
    inactive_tasks = weekly_recurring_task_service.get_weekly_recurring_tasks(
        test_session, test_user.id, is_active=False
    )
    assert len(inactive_tasks) >= 1
    assert all(task.is_active is False for task in inactive_tasks)


def test_get_weekly_recurring_task(
    test_session: Session, test_user, sample_weekly_recurring_task_data
):
    """Test getting a specific weekly recurring task."""
    task_data = WeeklyRecurringTaskCreate(**sample_weekly_recurring_task_data)

    created_task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data, test_user.id
    )

    retrieved_task = weekly_recurring_task_service.get_weekly_recurring_task(
        test_session, created_task.id, test_user.id
    )

    assert retrieved_task is not None
    assert retrieved_task.id == created_task.id
    assert retrieved_task.title == created_task.title


def test_update_weekly_recurring_task(
    test_session: Session, test_user, sample_weekly_recurring_task_data
):
    """Test updating a weekly recurring task."""
    task_data = WeeklyRecurringTaskCreate(**sample_weekly_recurring_task_data)

    created_task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data, test_user.id
    )

    update_data = WeeklyRecurringTaskUpdate(
        title="更新された会議",
        estimate_hours=Decimal("1.5"),
        is_active=False,
    )

    updated_task = weekly_recurring_task_service.update_weekly_recurring_task(
        test_session, created_task.id, test_user.id, update_data
    )

    assert updated_task.title == "更新された会議"
    assert updated_task.estimate_hours == Decimal("1.5")
    assert updated_task.is_active is False
    assert (
        updated_task.description == sample_weekly_recurring_task_data["description"]
    )  # Unchanged


def test_delete_weekly_recurring_task(
    test_session: Session, test_user, sample_weekly_recurring_task_data
):
    """Test deleting a weekly recurring task."""
    task_data = WeeklyRecurringTaskCreate(**sample_weekly_recurring_task_data)

    created_task = weekly_recurring_task_service.create_weekly_recurring_task(
        test_session, task_data, test_user.id
    )

    # Delete the task
    result = weekly_recurring_task_service.delete_weekly_recurring_task(
        test_session, created_task.id, test_user.id
    )

    assert result is True

    # Refresh session to ensure we see the latest data
    test_session.expire_all()

    # First, verify the task was actually soft deleted by checking directly
    from sqlmodel import select

    raw_task = test_session.exec(
        select(WeeklyRecurringTask).where(WeeklyRecurringTask.id == created_task.id)
    ).first()
    assert raw_task.deleted_at is not None  # Verify soft delete worked

    # Verify the task is soft deleted (not returned by get_weekly_recurring_task)
    deleted_task = weekly_recurring_task_service.get_weekly_recurring_task(
        test_session, created_task.id, test_user.id
    )

    assert deleted_task is None  # Should return None because it's soft deleted


def test_weekly_recurring_task_api_endpoints(client: TestClient, auth_headers: dict):
    """Test weekly recurring task API endpoints."""

    # Test creating a weekly recurring task
    task_data = {
        "title": "API テスト会議",
        "description": "API経由で作成された会議",
        "estimate_hours": 1.0,
        "category": TaskCategory.MEETING,
        "is_active": True,
    }

    response = client.post(
        "/api/weekly-recurring-tasks/", json=task_data, headers=auth_headers
    )

    assert response.status_code == 201
    created_task = response.json()
    assert created_task["title"] == task_data["title"]
    task_id = created_task["id"]

    # Test getting all weekly recurring tasks
    response = client.get("/api/weekly-recurring-tasks/", headers=auth_headers)

    assert response.status_code == 200
    tasks = response.json()
    assert len(tasks) >= 1

    # Test getting a specific task
    response = client.get(
        f"/api/weekly-recurring-tasks/{task_id}", headers=auth_headers
    )

    assert response.status_code == 200
    task = response.json()
    assert task["id"] == task_id

    # Test updating a task
    update_data = {
        "title": "更新されたAPI会議",
        "estimate_hours": 1.5,
    }

    response = client.put(
        f"/api/weekly-recurring-tasks/{task_id}", json=update_data, headers=auth_headers
    )

    assert response.status_code == 200
    updated_task = response.json()
    assert updated_task["title"] == update_data["title"]
    assert updated_task["estimate_hours"] == update_data["estimate_hours"]

    # Test deleting a task
    response = client.delete(
        f"/api/weekly-recurring-tasks/{task_id}", headers=auth_headers
    )

    assert response.status_code == 204

    # Verify task is deleted
    response = client.get(
        f"/api/weekly-recurring-tasks/{task_id}", headers=auth_headers
    )

    assert response.status_code == 404


def test_weekly_recurring_task_filter_by_category(
    client: TestClient, auth_headers: dict
):
    """Test filtering weekly recurring tasks by category."""

    # Create tasks with different categories
    meeting_task = {
        "title": "会議",
        "estimate_hours": 1.0,
        "category": TaskCategory.MEETING,
        "is_active": True,
    }

    study_task = {
        "title": "勉強",
        "estimate_hours": 2.0,
        "category": TaskCategory.STUDY,
        "is_active": True,
    }

    # Create both tasks
    response = client.post(
        "/api/weekly-recurring-tasks/", json=meeting_task, headers=auth_headers
    )
    assert response.status_code == 201

    response = client.post(
        "/api/weekly-recurring-tasks/", json=study_task, headers=auth_headers
    )
    assert response.status_code == 201

    # Filter by meeting category
    response = client.get(
        "/api/weekly-recurring-tasks/?category=meeting", headers=auth_headers
    )

    assert response.status_code == 200
    tasks = response.json()
    assert len(tasks) >= 1
    assert all(task["category"] == TaskCategory.MEETING for task in tasks)

    # Filter by study category
    response = client.get(
        "/api/weekly-recurring-tasks/?category=study", headers=auth_headers
    )

    assert response.status_code == 200
    tasks = response.json()
    assert len(tasks) >= 1
    assert all(task["category"] == TaskCategory.STUDY for task in tasks)


def test_weekly_recurring_task_filter_by_active_status(
    client: TestClient, auth_headers: dict
):
    """Test filtering weekly recurring tasks by active status."""

    # Create an inactive task
    inactive_task = {
        "title": "無効なタスク",
        "estimate_hours": 1.0,
        "category": "other",
        "is_active": False,
    }

    response = client.post(
        "/api/weekly-recurring-tasks/", json=inactive_task, headers=auth_headers
    )
    assert response.status_code == 201

    # Filter by active status
    response = client.get(
        "/api/weekly-recurring-tasks/?is_active=true", headers=auth_headers
    )

    assert response.status_code == 200
    active_tasks = response.json()
    assert all(task["is_active"] is True for task in active_tasks)

    # Filter by inactive status
    response = client.get(
        "/api/weekly-recurring-tasks/?is_active=false", headers=auth_headers
    )

    assert response.status_code == 200
    inactive_tasks = response.json()
    assert len(inactive_tasks) >= 1
    assert all(task["is_active"] is False for task in inactive_tasks)
