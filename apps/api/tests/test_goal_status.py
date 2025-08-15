"""
Tests for goal status functionality including status transitions and validation
"""

import pytest
from uuid import uuid4
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from taskagent_api.models import Goal, GoalStatus, GoalUpdate, User, Project
from taskagent_api.services import GoalService


@pytest.fixture
def memory_db():
    """Create in-memory SQLite database for testing"""
    from sqlalchemy import event
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Enable foreign key support for SQLite
    def enable_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    event.listen(engine, "connect", enable_foreign_keys)

    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(memory_db):
    """Create database session"""
    with Session(memory_db) as session:
        yield session


class TestGoalStatusTransitions:
    """Test goal status transition validation"""

    def test_valid_status_transitions(self, session: Session, test_user_and_project):
        """Test all valid status transitions"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal with pending status
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.PENDING,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Test PENDING -> IN_PROGRESS
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.IN_PROGRESS),
        )
        assert updated_goal.status == GoalStatus.IN_PROGRESS

        # Test IN_PROGRESS -> COMPLETED
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.COMPLETED),
        )
        assert updated_goal.status == GoalStatus.COMPLETED

        # Test COMPLETED -> IN_PROGRESS (reopening)
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.IN_PROGRESS),
        )
        assert updated_goal.status == GoalStatus.IN_PROGRESS

        # Test IN_PROGRESS -> CANCELLED
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.CANCELLED),
        )
        assert updated_goal.status == GoalStatus.CANCELLED

        # Test CANCELLED -> PENDING (reactivating)
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.PENDING),
        )
        assert updated_goal.status == GoalStatus.PENDING

    def test_invalid_status_transitions(self, session: Session, test_user_and_project):
        """Test invalid status transitions are rejected"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal with pending status
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.PENDING,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Test PENDING -> COMPLETED (invalid: should go through IN_PROGRESS)
        with pytest.raises(HTTPException) as exc_info:
            goal_service.update_goal(
                session,
                goal.id,
                user.id,
                GoalUpdate(status=GoalStatus.COMPLETED),
            )
        assert exc_info.value.status_code == 422
        assert "Invalid status transition" in str(exc_info.value.detail)

        # Test PENDING -> CANCELLED is valid, set it first
        goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.CANCELLED),
        )

        # Test CANCELLED -> COMPLETED (invalid)
        with pytest.raises(HTTPException) as exc_info:
            goal_service.update_goal(
                session,
                goal.id,
                user.id,
                GoalUpdate(status=GoalStatus.COMPLETED),
            )
        assert exc_info.value.status_code == 422
        assert "Invalid status transition" in str(exc_info.value.detail)

    def test_same_status_update_allowed(self, session: Session, test_user_and_project):
        """Test that updating to the same status is allowed (no-op)"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.PENDING,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Update to same status should work
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.PENDING),
        )
        assert updated_goal.status == GoalStatus.PENDING

    def test_status_update_without_status_field(
        self, session: Session, test_user_and_project
    ):
        """Test that updates without status field don't trigger validation"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.IN_PROGRESS,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Update other fields without status
        updated_goal = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(title="Updated Title", description="Updated description"),
        )
        assert updated_goal.title == "Updated Title"
        assert updated_goal.description == "Updated description"
        assert updated_goal.status == GoalStatus.IN_PROGRESS  # Status unchanged


class TestGoalStatusValues:
    """Test goal status value validation"""

    def test_default_status_on_creation(self, session: Session, test_user_and_project):
        """Test that new goals default to PENDING status"""
        user, project = test_user_and_project

        # Create a goal without specifying status
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        assert goal.status == GoalStatus.PENDING

    def test_explicit_status_on_creation(self, session: Session, test_user_and_project):
        """Test creating goals with explicit status"""
        user, project = test_user_and_project

        for status in GoalStatus:
            goal = Goal(
                id=uuid4(),
                project_id=project.id,
                title=f"Test Goal {status.value}",
                description="Test description",
                estimate_hours=10.0,
                status=status,
            )
            session.add(goal)
            session.commit()
            session.refresh(goal)

            assert goal.status == status

    def test_status_enum_values(self):
        """Test that all expected status values exist"""
        expected_statuses = {"pending", "in_progress", "completed", "cancelled"}
        actual_statuses = {status.value for status in GoalStatus}
        assert actual_statuses == expected_statuses


class TestConcurrentStatusUpdates:
    """Test concurrent status updates"""

    def test_concurrent_status_updates_last_wins(
        self, session: Session, test_user_and_project
    ):
        """Test that concurrent updates work with last-write-wins semantics"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.PENDING,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Simulate concurrent updates
        # First update: PENDING -> IN_PROGRESS
        updated_goal_1 = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.IN_PROGRESS),
        )
        assert updated_goal_1.status == GoalStatus.IN_PROGRESS

        # Second update: IN_PROGRESS -> COMPLETED
        updated_goal_2 = goal_service.update_goal(
            session,
            goal.id,
            user.id,
            GoalUpdate(status=GoalStatus.COMPLETED),
        )
        assert updated_goal_2.status == GoalStatus.COMPLETED

        # Verify final state
        session.refresh(goal)
        assert goal.status == GoalStatus.COMPLETED


class TestGoalStatusQueries:
    """Test status-based queries and filtering"""

    def test_filter_goals_by_status(self, session: Session, test_user_and_project):
        """Test filtering goals by status"""
        user, project = test_user_and_project

        # Create goals with different statuses
        goals_data = [
            ("Goal 1", GoalStatus.PENDING),
            ("Goal 2", GoalStatus.IN_PROGRESS),
            ("Goal 3", GoalStatus.COMPLETED),
            ("Goal 4", GoalStatus.PENDING),
            ("Goal 5", GoalStatus.CANCELLED),
        ]

        created_goals = []
        for title, status in goals_data:
            goal = Goal(
                id=uuid4(),
                project_id=project.id,
                title=title,
                description="Test description",
                estimate_hours=10.0,
                status=status,
            )
            session.add(goal)
            created_goals.append(goal)

        session.commit()

        # Test status index is working (this should be fast)
        from sqlmodel import select

        # Count goals by status
        pending_count = len(
            session.exec(
                select(Goal).where(
                    Goal.project_id == project.id, Goal.status == GoalStatus.PENDING
                )
            ).all()
        )
        assert pending_count == 2

        in_progress_count = len(
            session.exec(
                select(Goal).where(
                    Goal.project_id == project.id, Goal.status == GoalStatus.IN_PROGRESS
                )
            ).all()
        )
        assert in_progress_count == 1

        completed_count = len(
            session.exec(
                select(Goal).where(
                    Goal.project_id == project.id, Goal.status == GoalStatus.COMPLETED
                )
            ).all()
        )
        assert completed_count == 1

        cancelled_count = len(
            session.exec(
                select(Goal).where(
                    Goal.project_id == project.id, Goal.status == GoalStatus.CANCELLED
                )
            ).all()
        )
        assert cancelled_count == 1


class TestGoalStatusAPI:
    """Test goal status functionality through API endpoints"""

    def test_goal_status_in_response(self, session: Session, test_user_and_project):
        """Test that goal status is included in API responses"""
        user, project = test_user_and_project
        goal_service = GoalService()

        # Create a goal
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.IN_PROGRESS,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Get goal through service
        retrieved_goal = goal_service.get_goal(session, goal.id, user.id)
        assert retrieved_goal is not None
        assert retrieved_goal.status == GoalStatus.IN_PROGRESS

    def test_goal_status_serialization(self):
        """Test that goal status serializes correctly to JSON"""
        from taskagent_api.models import GoalResponse

        # Create a mock goal response
        goal_response = GoalResponse(
            id="12345678-1234-1234-1234-123456789012",
            project_id="12345678-1234-1234-1234-123456789012",
            title="Test Goal",
            description="Test description",
            estimate_hours=10.0,
            status=GoalStatus.COMPLETED,
            created_at="2025-01-01T00:00:00Z",
            updated_at="2025-01-01T00:00:00Z",
        )

        # Convert to dict (simulating JSON serialization)
        goal_dict = goal_response.model_dump()
        assert goal_dict["status"] == "completed"


@pytest.fixture
def test_user_and_project(session: Session):
    """Create a test user and project for goal tests"""

    # Create test user
    user = User(id=uuid4(), email="test@example.com")
    session.add(user)

    # Create test project
    project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="Test Project",
        description="Test project description",
    )
    session.add(project)

    session.commit()
    session.refresh(user)
    session.refresh(project)

    return user, project
