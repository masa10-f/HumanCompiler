"""
Tests for weekly task solver dependency relaxation functionality.
"""

from datetime import datetime, date
from unittest.mock import MagicMock, AsyncMock, patch
from uuid import uuid4, UUID

import pytest
from sqlmodel import Session

from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    WeeklyConstraints,
)
from taskagent_api.models import Task, TaskStatus


class TestWeeklyTaskSolverDependencies:
    """Test cases for weekly task solver dependency relaxation."""

    @pytest.fixture
    def mock_session(self):
        """Mock database session."""
        return MagicMock(spec=Session)

    @pytest.fixture
    def mock_solver(self):
        """Mock weekly task solver."""
        return WeeklyTaskSolver(openai_client=None, model="gpt-4")

    @pytest.fixture
    def sample_tasks(self):
        """Sample tasks for testing."""
        task1_id = uuid4()
        task2_id = uuid4()
        task3_id = uuid4()

        return [
            Task(
                id=task1_id,
                title="Dependent Task",
                description="Task that depends on another",
                estimate_hours=2.0,
                goal_id=uuid4(),
                status=TaskStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            ),
            Task(
                id=task2_id,
                title="Dependency Task",
                description="Task that others depend on",
                estimate_hours=1.5,
                goal_id=uuid4(),
                status=TaskStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            ),
            Task(
                id=task3_id,
                title="Independent Task",
                description="Task with no dependencies",
                estimate_hours=1.0,
                goal_id=uuid4(),
                status=TaskStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            ),
        ]

    def test_collect_task_dependencies_no_tasks(self, mock_solver, mock_session):
        """Test collecting dependencies when no tasks provided."""
        result = mock_solver._collect_task_dependencies(mock_session, [])
        assert result == {}

    def test_collect_task_dependencies_no_dependencies(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test collecting dependencies when tasks have no dependencies."""
        # Mock no dependencies in database
        mock_session.exec.return_value.all.return_value = []

        result = mock_solver._collect_task_dependencies(mock_session, sample_tasks)
        assert result == {}

    def test_collect_task_dependencies_with_dependencies(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test collecting dependencies when tasks have dependencies."""
        task1, task2, task3 = sample_tasks

        # Mock dependency: task1 depends on task2
        mock_dependency = MagicMock()
        mock_dependency.task_id = task1.id
        mock_dependency.depends_on_task_id = task2.id

        mock_session.exec.return_value.all.return_value = [mock_dependency]

        result = mock_solver._collect_task_dependencies(mock_session, sample_tasks)

        expected = {str(task1.id): [str(task2.id)]}
        assert result == expected

    def test_check_dependencies_schedulable_no_dependencies(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test dependency check when tasks have no dependencies."""
        task_dependencies = {}

        schedulable, blocked = mock_solver._check_dependencies_schedulable_in_week(
            task_dependencies, sample_tasks, mock_session
        )

        assert len(schedulable) == 3  # All tasks schedulable
        assert len(blocked) == 0

    def test_check_dependencies_schedulable_dependency_completed(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test dependency check when dependency task is completed."""
        task1, task2, task3 = sample_tasks

        # Mock dependency: task1 depends on task2
        task_dependencies = {str(task1.id): [str(task2.id)]}

        # Mock task2 as completed
        task2.status = TaskStatus.COMPLETED
        mock_session.get.return_value = task2

        schedulable, blocked = mock_solver._check_dependencies_schedulable_in_week(
            task_dependencies, sample_tasks, mock_session
        )

        # All tasks should be schedulable (task1 because its dependency is completed)
        assert len(schedulable) == 3
        assert len(blocked) == 0

    def test_check_dependencies_schedulable_dependency_available_for_scheduling(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test dependency check when dependency is available for scheduling in same week."""
        task1, task2, task3 = sample_tasks

        # Mock dependency: task1 depends on task2
        task_dependencies = {str(task1.id): [str(task2.id)]}

        # Mock task2 as pending (not completed) but available for scheduling
        task2.status = TaskStatus.PENDING
        mock_session.get.return_value = task2

        schedulable, blocked = mock_solver._check_dependencies_schedulable_in_week(
            task_dependencies, sample_tasks, mock_session
        )

        # All tasks should be schedulable (task1 because its dependency task2 is available)
        assert len(schedulable) == 3
        assert len(blocked) == 0

    def test_check_dependencies_schedulable_dependency_not_satisfiable(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test dependency check when dependency is neither completed nor available."""
        task1, task2, task3 = sample_tasks

        # Mock dependency: task1 depends on external task not in available tasks
        external_task_id = str(uuid4())
        task_dependencies = {str(task1.id): [external_task_id]}

        # Mock external task as pending (not completed) and not available for scheduling
        mock_external_task = MagicMock()
        mock_external_task.status = TaskStatus.PENDING
        mock_session.get.return_value = mock_external_task

        schedulable, blocked = mock_solver._check_dependencies_schedulable_in_week(
            task_dependencies, sample_tasks, mock_session
        )

        # Task1 should be blocked, others should be schedulable
        assert len(schedulable) == 2  # task2 and task3
        assert len(blocked) == 1  # task1
        assert task1 in blocked

    def test_check_dependencies_schedulable_multiple_dependencies(
        self, mock_solver, mock_session, sample_tasks
    ):
        """Test dependency check with multiple dependencies."""
        task1, task2, task3 = sample_tasks

        # Mock dependency: task1 depends on both task2 and task3
        task_dependencies = {str(task1.id): [str(task2.id), str(task3.id)]}

        # Mock both task2 and task3 as available for scheduling
        def mock_get_side_effect(task_class, task_id):
            if task_id == task2.id:
                task2.status = TaskStatus.PENDING
                return task2
            elif task_id == task3.id:
                task3.status = TaskStatus.COMPLETED  # One completed, one pending
                return task3
            return None

        mock_session.get.side_effect = mock_get_side_effect

        schedulable, blocked = mock_solver._check_dependencies_schedulable_in_week(
            task_dependencies, sample_tasks, mock_session
        )

        # All tasks should be schedulable
        # task1: both dependencies satisfied (task2 available, task3 completed)
        # task2 and task3: no dependencies
        assert len(schedulable) == 3
        assert len(blocked) == 0

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._collect_task_dependencies"
    )
    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._check_dependencies_schedulable_in_week"
    )
    async def test_collect_solver_context_applies_dependency_filtering(
        self,
        mock_check_deps,
        mock_collect_deps,
        mock_solver,
        mock_session,
        sample_tasks,
    ):
        """Test that _collect_solver_context applies dependency filtering."""
        task1, task2, task3 = sample_tasks

        # Mock context collector with proper context structure
        mock_context = MagicMock()
        mock_context.tasks = sample_tasks
        mock_context.goals = []  # No goals needed for this test
        mock_context.projects = []  # No projects needed for this test
        mock_solver.context_collector = MagicMock()
        # Make the async method return a coroutine
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Mock dependencies collection
        mock_collect_deps.return_value = {str(task1.id): [str(task2.id)]}

        # Mock dependency filtering - task1 blocked, others schedulable
        mock_check_deps.return_value = ([task2, task3], [task1])

        # Mock actual hours retrieval and project allocations
        with (
            patch.object(mock_solver, "_get_task_actual_hours") as mock_get_actual,
            patch.object(mock_solver, "_optimize_project_allocations") as mock_optimize,
        ):
            mock_get_actual.return_value = {}
            mock_optimize.return_value = []  # No project allocations

            # Mock tasks to have remaining_hours attribute
            for task in sample_tasks:
                # Set remaining_hours using object.__setattr__ to bypass SQLModel validation
                object.__setattr__(
                    task, "remaining_hours", float(task.estimate_hours or 0)
                )

            request = TaskSolverRequest(
                week_start_date="2024-01-01",
                constraints=WeeklyConstraints(),
            )

            result = await mock_solver._collect_solver_context(
                mock_session, "user123", date(2024, 1, 1), request, None
            )

            # Should have applied dependency filtering
            mock_collect_deps.assert_called_once()
            mock_check_deps.assert_called_once()

            # Context should contain only schedulable tasks
            assert len(result.tasks) == 2
            assert task1 not in result.tasks
            assert task2 in result.tasks
            assert task3 in result.tasks

    def test_weekly_task_solver_integration_with_dependencies(
        self, mock_solver, mock_session
    ):
        """Integration test for weekly task solver with dependencies."""
        # This would be an integration test that tests the full flow
        # For now, we'll keep it as a placeholder since it requires more complex setup
        pass
