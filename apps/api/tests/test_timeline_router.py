"""Tests for timeline router endpoints"""

import pytest
from datetime import datetime, timedelta, UTC
from uuid import uuid4, UUID
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.main import app
from humancompiler_api.models import (
    User,
    Project,
    Goal,
    Task,
    Log,
    TaskStatus,
    GoalStatus,
    WorkType,
)
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session


# Test helper functions
def create_test_user(session: Session, email: str = "test@example.com") -> User:
    """Create a test user"""
    user = User(
        id=uuid4(),
        email=email,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def create_test_project(
    session: Session, owner_id: UUID, title: str = "Test Project"
) -> Project:
    """Create a test project"""
    project = Project(
        id=uuid4(),
        owner_id=owner_id,
        title=title,
        description="Test project description",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def create_test_goal(
    session: Session,
    project_id: UUID,
    title: str = "Test Goal",
    estimate_hours: float = 8.0,
    status: GoalStatus = GoalStatus.PENDING,
) -> Goal:
    """Create a test goal"""
    goal = Goal(
        id=uuid4(),
        project_id=project_id,
        title=title,
        description="Test goal description",
        estimate_hours=estimate_hours,
        status=status,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(goal)
    session.commit()
    session.refresh(goal)
    return goal


def create_test_task(
    session: Session,
    goal_id: UUID,
    title: str = "Test Task",
    estimate_hours: float = 4.0,
    status: TaskStatus = TaskStatus.PENDING,
    due_date: datetime = None,
) -> Task:
    """Create a test task"""
    task = Task(
        id=uuid4(),
        goal_id=goal_id,
        title=title,
        description="Test task description",
        estimate_hours=estimate_hours,
        due_date=due_date,
        status=status,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def create_test_log(
    session: Session,
    task_id: UUID,
    actual_minutes: int = 60,
    comment: str = "Test log entry",
) -> Log:
    """Create a test log"""
    log = Log(
        id=uuid4(),
        task_id=task_id,
        actual_minutes=actual_minutes,
        comment=comment,
        work_type=WorkType.FOCUSED_WORK,
        created_at=datetime.now(UTC),
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@pytest.fixture
def test_session():
    """Create a test database session"""
    from sqlmodel import SQLModel, create_engine
    from sqlalchemy.pool import StaticPool

    # Create in-memory SQLite database for testing
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    session = Session(engine)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    """Create a test client"""
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    """Reset dependency overrides after each test"""
    yield
    app.dependency_overrides.clear()


class TestTimelineRouter:
    """Test timeline router endpoints"""

    def test_get_project_timeline_success(
        self, client: TestClient, test_session: Session
    ):
        """Test successful project timeline retrieval"""
        # Create test data
        user = create_test_user(test_session)
        project = create_test_project(test_session, user.id)
        goal = create_test_goal(test_session, project.id)
        task = create_test_task(test_session, goal.id)
        log = create_test_log(test_session, task.id)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test endpoint
        response = client.get(f"/api/timeline/projects/{project.id}")

        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "project" in data
        assert "timeline" in data
        assert "goals" in data

        # Verify project data
        assert data["project"]["id"] == str(project.id)
        assert data["project"]["title"] == project.title

        # Verify goals data
        assert len(data["goals"]) == 1
        assert data["goals"][0]["id"] == str(goal.id)
        assert data["goals"][0]["title"] == goal.title

        # Verify tasks data
        assert len(data["goals"][0]["tasks"]) == 1
        task_data = data["goals"][0]["tasks"][0]
        assert task_data["id"] == str(task.id)
        assert task_data["title"] == task.title
        assert task_data["logs_count"] == 1

    def test_get_project_timeline_not_found(
        self, client: TestClient, test_session: Session
    ):
        """Test project timeline with non-existent project"""
        user = create_test_user(test_session)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test with random UUID
        random_id = str(uuid4())
        response = client.get(f"/api/timeline/projects/{random_id}")

        assert response.status_code == 404
        assert "Project not found" in response.json()["detail"]

    def test_get_project_timeline_access_denied(
        self, client: TestClient, test_session: Session
    ):
        """Test project timeline access with different user"""
        # Create test data with user1
        user1 = create_test_user(test_session)
        project = create_test_project(test_session, user1.id)

        # Create different user
        user2 = create_test_user(test_session, email="other@example.com")

        # Mock dependencies with user2
        def mock_get_current_user():
            return AuthUser(user_id=str(user2.id), email=user2.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test endpoint - should fail due to ownership check
        response = client.get(f"/api/timeline/projects/{project.id}")

        assert response.status_code == 404
        assert "Project not found" in response.json()["detail"]

    def test_get_timeline_overview_success(
        self, client: TestClient, test_session: Session
    ):
        """Test successful timeline overview retrieval"""
        # Create test data
        user = create_test_user(test_session)
        project1 = create_test_project(test_session, user.id, title="Project 1")
        project2 = create_test_project(test_session, user.id, title="Project 2")

        # Add goals and tasks to projects
        goal1 = create_test_goal(test_session, project1.id)
        goal2 = create_test_goal(test_session, project2.id, status=GoalStatus.COMPLETED)

        task1 = create_test_task(test_session, goal1.id)
        task2 = create_test_task(test_session, goal2.id, status=TaskStatus.COMPLETED)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test endpoint
        response = client.get("/api/timeline/overview")

        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "timeline" in data
        assert "projects" in data

        # Verify projects data
        assert len(data["projects"]) == 2

        project_titles = [p["title"] for p in data["projects"]]
        assert "Project 1" in project_titles
        assert "Project 2" in project_titles

        # Verify statistics
        for project_data in data["projects"]:
            assert "statistics" in project_data
            stats = project_data["statistics"]
            assert "total_goals" in stats
            assert "completed_goals" in stats
            assert "total_tasks" in stats
            assert "completed_tasks" in stats
            assert "goals_completion_rate" in stats
            assert "tasks_completion_rate" in stats

    def test_get_timeline_overview_empty(
        self, client: TestClient, test_session: Session
    ):
        """Test timeline overview with no projects"""
        user = create_test_user(test_session)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test endpoint
        response = client.get("/api/timeline/overview")

        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "timeline" in data
        assert "projects" in data
        assert len(data["projects"]) == 0

    def test_project_timeline_date_filters(
        self, client: TestClient, test_session: Session
    ):
        """Test project timeline with date range filters"""
        user = create_test_user(test_session)
        project = create_test_project(test_session, user.id)
        goal = create_test_goal(test_session, project.id)
        task = create_test_task(test_session, goal.id)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        # Test with date filters
        start_date = datetime.now(UTC) - timedelta(days=30)
        end_date = datetime.now(UTC) + timedelta(days=30)

        response = client.get(
            f"/api/timeline/projects/{project.id}",
            params={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "time_unit": "week",
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Verify timeline dates are set correctly
        assert data["timeline"]["start_date"] == start_date.isoformat()
        assert data["timeline"]["end_date"] == end_date.isoformat()
        assert data["timeline"]["time_unit"] == "week"

    def test_timeline_progress_calculation(
        self, client: TestClient, test_session: Session
    ):
        """Test timeline progress percentage calculation"""
        user = create_test_user(test_session)
        project = create_test_project(test_session, user.id)
        goal = create_test_goal(test_session, project.id, estimate_hours=10.0)
        task = create_test_task(test_session, goal.id, estimate_hours=5.0)

        # Create logs with total 150 minutes (2.5 hours)
        create_test_log(test_session, task.id, actual_minutes=90)
        create_test_log(test_session, task.id, actual_minutes=60)

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        response = client.get(f"/api/timeline/projects/{project.id}")

        assert response.status_code == 200
        data = response.json()

        task_data = data["goals"][0]["tasks"][0]

        # Expected: 150 minutes / (5 hours * 60) = 150/300 = 50%
        assert task_data["progress_percentage"] == 50.0
        assert task_data["actual_hours"] == 2.5
        assert task_data["logs_count"] == 2

    def test_timeline_status_colors(self, client: TestClient, test_session: Session):
        """Test timeline status color assignment"""
        user = create_test_user(test_session)
        project = create_test_project(test_session, user.id)
        goal = create_test_goal(test_session, project.id)

        # Create tasks with different statuses
        task_pending = create_test_task(
            test_session, goal.id, title="Pending Task", status=TaskStatus.PENDING
        )
        task_in_progress = create_test_task(
            test_session,
            goal.id,
            title="In Progress Task",
            status=TaskStatus.IN_PROGRESS,
        )
        task_completed = create_test_task(
            test_session, goal.id, title="Completed Task", status=TaskStatus.COMPLETED
        )

        # Mock dependencies
        def mock_get_current_user():
            return AuthUser(user_id=str(user.id), email=user.email)

        def mock_get_session():
            return test_session

        app.dependency_overrides[get_current_user] = mock_get_current_user
        app.dependency_overrides[get_session] = mock_get_session

        response = client.get(f"/api/timeline/projects/{project.id}")

        assert response.status_code == 200
        data = response.json()

        tasks = data["goals"][0]["tasks"]

        # Find tasks by title and verify colors
        for task in tasks:
            if task["title"] == "Pending Task":
                assert task["status_color"] == "#6b7280"  # Gray
            elif task["title"] == "In Progress Task":
                assert task["status_color"] == "#3b82f6"  # Blue
            elif task["title"] == "Completed Task":
                assert task["status_color"] == "#22c55e"  # Green
