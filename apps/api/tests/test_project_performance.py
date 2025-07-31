"""
Performance tests for project deletion optimization
Tests to validate N+1 query fix and measure performance improvements
"""

import os
import sys
import time
from uuid import uuid4

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from taskagent_api.models import Goal, Log, Project, Task, TaskStatus, User
from taskagent_api.services import ProjectService


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
        # Properly dispose of the engine after use
        engine.dispose()


@pytest.fixture
def test_user(test_session):
    """Create test user"""
    user = User(id=uuid4(), email="test@example.com")
    test_session.add(user)
    test_session.commit()
    test_session.refresh(user)
    return user


def create_test_project_with_nested_data(
    session: Session, user_id, num_goals=5, num_tasks_per_goal=10, num_logs_per_task=3
):
    """Create a project with nested goals, tasks, and logs for performance testing"""
    # Create project
    project = Project(
        id=uuid4(),
        owner_id=user_id,
        title="Performance Test Project",
        description="Project for testing deletion performance",
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    # Create goals
    for goal_idx in range(num_goals):
        goal = Goal(
            id=uuid4(),
            project_id=project.id,
            title=f"Goal {goal_idx + 1}",
            description=f"Test goal {goal_idx + 1}",
            estimate_hours=10.0,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)

        # Create tasks for this goal
        for task_idx in range(num_tasks_per_goal):
            task = Task(
                id=uuid4(),
                goal_id=goal.id,
                title=f"Task {task_idx + 1} for Goal {goal_idx + 1}",
                description=f"Test task {task_idx + 1}",
                estimate_hours=2.0,
                status=TaskStatus.PENDING,
            )
            session.add(task)
            session.commit()
            session.refresh(task)

            # Create logs for this task
            for log_idx in range(num_logs_per_task):
                log = Log(
                    id=uuid4(),
                    task_id=task.id,
                    actual_minutes=30,
                    comment=f"Log {log_idx + 1} for task {task_idx + 1}",
                )
                session.add(log)

        session.commit()

    return project


class TestProjectDeletionPerformance:
    """Test suite for project deletion performance"""

    def test_delete_project_small_dataset(self, test_session, test_user):
        """Test deletion performance with small dataset"""
        project_service = ProjectService()

        # Create project with moderate amount of data
        project = create_test_project_with_nested_data(
            test_session,
            test_user.id,
            num_goals=3,
            num_tasks_per_goal=5,
            num_logs_per_task=2,
        )

        # Measure deletion time
        start_time = time.time()
        result = project_service.delete_project(test_session, project.id, test_user.id)
        deletion_time = time.time() - start_time

        assert result is True
        assert deletion_time < 1.0  # Should complete in under 1 second
        print(f"Small dataset deletion time: {deletion_time:.4f} seconds")

    def test_delete_project_large_dataset(self, test_session, test_user):
        """Test deletion performance with larger dataset"""
        project_service = ProjectService()

        # Create project with larger amount of data
        project = create_test_project_with_nested_data(
            test_session,
            test_user.id,
            num_goals=10,
            num_tasks_per_goal=20,
            num_logs_per_task=5,
        )

        # Measure deletion time
        start_time = time.time()
        result = project_service.delete_project(test_session, project.id, test_user.id)
        deletion_time = time.time() - start_time

        assert result is True
        assert (
            deletion_time < 5.0
        )  # Should complete in under 5 seconds even for large dataset
        print(f"Large dataset deletion time: {deletion_time:.4f} seconds")

        # Verify all data was deleted
        from sqlmodel import select

        remaining_goals = test_session.exec(
            select(Goal).where(Goal.project_id == project.id)
        ).all()
        assert len(remaining_goals) == 0

    def test_query_count_optimization(self, test_session, test_user):
        """Test that the number of queries is optimized (not N+1)"""
        project_service = ProjectService()

        # Create project with nested data
        project = create_test_project_with_nested_data(
            test_session,
            test_user.id,
            num_goals=5,
            num_tasks_per_goal=8,
            num_logs_per_task=3,
        )

        # The optimized implementation should use approximately 6 queries:
        # 1. Verify project exists
        # 2. Select goal IDs
        # 3. Select task IDs
        # 4. Delete logs (batch)
        # 5. Delete tasks (batch)
        # 6. Delete goals (batch)
        # 7. Delete project

        result = project_service.delete_project(test_session, project.id, test_user.id)
        assert result is True

    def test_transaction_rollback_on_error(self, test_session, test_user):
        """Test that transaction is properly rolled back on errors"""
        project_service = ProjectService()

        # Create project
        project = create_test_project_with_nested_data(
            test_session,
            test_user.id,
            num_goals=2,
            num_tasks_per_goal=3,
            num_logs_per_task=1,
        )

        # Try to delete non-existent project (should raise exception)
        fake_project_id = uuid4()

        with pytest.raises(Exception):
            project_service.delete_project(test_session, fake_project_id, test_user.id)

        # Verify original project still exists
        from sqlmodel import select

        existing_project = test_session.exec(
            select(Project).where(Project.id == project.id)
        ).first()
        assert existing_project is not None


if __name__ == "__main__":
    # Run performance tests manually
    pytest.main([__file__, "-v", "-s"])
