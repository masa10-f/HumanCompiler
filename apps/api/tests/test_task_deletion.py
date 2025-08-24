"""
Test cases for task deletion functionality
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from taskagent_api.database import db
from taskagent_api.models import Task, TaskDependency, Log, Project, Goal
from taskagent_api.services import TaskService, ProjectService, GoalService
from conftest import create_test_data


class TestTaskDeletion:
    """Test task deletion with dependencies and logs"""

    @pytest.fixture
    def setup_test_data(self, session: Session, test_user_id: str):
        """Set up test data with tasks, dependencies, and logs"""
        # Create project, goal, and tasks
        project_service = ProjectService()
        goal_service = GoalService()
        task_service = TaskService()

        # Create project
        from taskagent_api.models import (
            ProjectCreate,
            GoalCreate,
            TaskCreate,
            LogCreate,
            UserCreate,
        )
        from taskagent_api.services import UserService

        # Create user first
        user_service = UserService()
        user_data = UserCreate(email="test@example.com")
        user_service.create_user(session, user_data, test_user_id)

        project_data = ProjectCreate(
            title="Test Project", description="Test project for deletion"
        )
        project = project_service.create_project(session, project_data, test_user_id)

        # Create goal
        goal_data = GoalCreate(
            project_id=project.id,
            title="Test Goal",
            description="Test goal for deletion",
            estimate_hours=10.0,
        )
        goal = goal_service.create_goal(session, goal_data, test_user_id)

        # Create tasks
        task1_data = TaskCreate(
            goal_id=goal.id,
            title="Task 1",
            description="First task",
            estimate_hours=5.0,
            status="pending",
            priority=1,
        )
        task1 = task_service.create_task(session, task1_data, test_user_id)

        task2_data = TaskCreate(
            goal_id=goal.id,
            title="Task 2",
            description="Second task",
            estimate_hours=5.0,
            status="pending",
            priority=2,
        )
        task2 = task_service.create_task(session, task2_data, test_user_id)

        # Create dependency: task2 depends on task1
        dependency = task_service.add_task_dependency(
            session, task2.id, task1.id, test_user_id
        )

        # Create logs for task1
        from taskagent_api.services import LogService

        log_service = LogService()
        log_data = LogCreate(
            task_id=task1.id, actual_minutes=60, comment="Test work log"
        )
        log = log_service.create_log(session, log_data, test_user_id)

        return {
            "project": project,
            "goal": goal,
            "task1": task1,
            "task2": task2,
            "dependency": dependency,
            "log": log,
        }

    def test_delete_task_without_dependencies(
        self, session: Session, test_user_id: str
    ):
        """Test deleting a task without dependencies"""
        task_service = TaskService()

        # Create a simple task without dependencies
        test_data = create_test_data(session, test_user_id)
        from taskagent_api.models import TaskCreate

        task_data = TaskCreate(
            goal_id=test_data["goal"].id,
            title="Simple Task",
            description="Task without dependencies",
            estimate_hours=2.0,
            status="pending",
            priority=1,
        )
        task = task_service.create_task(session, task_data, test_user_id)

        # Delete the task
        result = task_service.delete_task(session, task.id, test_user_id)
        assert result is True

        # Verify task is deleted
        deleted_task = session.get(Task, task.id)
        assert deleted_task is None

    def test_delete_task_with_dependencies(
        self, session: Session, test_user_id: str, setup_test_data
    ):
        """Test deleting a task that has dependencies"""
        task_service = TaskService()
        test_data = setup_test_data

        # Delete task1 (which task2 depends on)
        result = task_service.delete_task(session, test_data["task1"].id, test_user_id)
        assert result is True

        # Verify task1 is deleted
        deleted_task = session.get(Task, test_data["task1"].id)
        assert deleted_task is None

        # Verify dependency is deleted
        dependency = session.get(TaskDependency, test_data["dependency"].id)
        assert dependency is None

        # Verify log is deleted
        log = session.get(Log, test_data["log"].id)
        assert log is None

        # Verify task2 still exists
        task2 = session.get(Task, test_data["task2"].id)
        assert task2 is not None

    def test_delete_task_that_depends_on_other(
        self, session: Session, test_user_id: str, setup_test_data
    ):
        """Test deleting a task that depends on another task"""
        task_service = TaskService()
        test_data = setup_test_data

        # Delete task2 (which depends on task1)
        result = task_service.delete_task(session, test_data["task2"].id, test_user_id)
        assert result is True

        # Verify task2 is deleted
        deleted_task = session.get(Task, test_data["task2"].id)
        assert deleted_task is None

        # Verify dependency is deleted
        dependency = session.get(TaskDependency, test_data["dependency"].id)
        assert dependency is None

        # Verify task1 still exists
        task1 = session.get(Task, test_data["task1"].id)
        assert task1 is not None

        # Verify log still exists (belongs to task1)
        log = session.get(Log, test_data["log"].id)
        assert log is not None

    def test_delete_task_with_logs(
        self, session: Session, test_user_id: str, setup_test_data
    ):
        """Test deleting a task with associated logs"""
        task_service = TaskService()
        test_data = setup_test_data

        # Add more logs to task1
        from taskagent_api.services import LogService
        from taskagent_api.models import LogCreate

        log_service = LogService()

        log2_data = LogCreate(
            task_id=test_data["task1"].id, actual_minutes=30, comment="Second work log"
        )
        log2 = log_service.create_log(session, log2_data, test_user_id)

        # Delete task1
        result = task_service.delete_task(session, test_data["task1"].id, test_user_id)
        assert result is True

        # Verify all logs are deleted
        log1 = session.get(Log, test_data["log"].id)
        assert log1 is None

        log2_check = session.get(Log, log2.id)
        assert log2_check is None

    def test_delete_nonexistent_task(self, session: Session, test_user_id: str):
        """Test deleting a non-existent task"""
        task_service = TaskService()

        from uuid import uuid4

        fake_task_id = uuid4()

        with pytest.raises(
            Exception
        ):  # Should raise HTTPException or ResourceNotFoundError
            task_service.delete_task(session, fake_task_id, test_user_id)

    def test_delete_task_unauthorized(self, session: Session, test_user_id: str):
        """Test deleting a task with wrong user ID"""
        task_service = TaskService()

        # Create a task
        test_data = create_test_data(session, test_user_id)
        from taskagent_api.models import TaskCreate

        task_data = TaskCreate(
            goal_id=test_data["goal"].id,
            title="Test Task",
            description="Task for unauthorized test",
            estimate_hours=2.0,
            status="pending",
            priority=1,
        )
        task = task_service.create_task(session, task_data, test_user_id)

        # Try to delete with different user ID
        from uuid import uuid4

        wrong_user_id = str(uuid4())

        with pytest.raises(
            Exception
        ):  # Should raise HTTPException or ResourceNotFoundError
            task_service.delete_task(session, task.id, wrong_user_id)

        # Verify task still exists
        existing_task = session.get(Task, task.id)
        assert existing_task is not None
