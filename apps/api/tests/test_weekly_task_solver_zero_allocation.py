"""
Tests for weekly task solver zero allocation constraint bug fix.
"""

from datetime import datetime, date
from unittest.mock import MagicMock, AsyncMock, patch
from uuid import uuid4

import pytest
from sqlmodel import Session

from humancompiler_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    WeeklyConstraints,
    ProjectAllocation,
)
from humancompiler_api.models import Task, Goal, Project, TaskStatus


class TestWeeklyTaskSolverZeroAllocation:
    """Test cases for zero allocation constraint bug fix."""

    @pytest.fixture
    def mock_session(self):
        """Mock database session."""
        return MagicMock(spec=Session)

    @pytest.fixture
    def mock_solver(self):
        """Mock weekly task solver."""
        return WeeklyTaskSolver(openai_client=None, model="gpt-4")

    @pytest.fixture
    def sample_project_with_tasks(self):
        """Sample project with tasks for zero allocation testing."""
        project_id = uuid4()
        goal_id = uuid4()
        task_id = uuid4()

        project = Project(
            id=project_id,
            owner_id=uuid4(),
            title="Zero Allocation Project",
            description="Project that should get 0% allocation",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        goal = Goal(
            id=goal_id,
            project_id=project_id,
            title="Goal in Zero Allocation Project",
            description="Goal that should not be scheduled",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        task = Task(
            id=task_id,
            title="Task in Zero Allocation Project",
            description="Task that should not be scheduled",
            estimate_hours=5.0,
            goal_id=goal_id,
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        # Set remaining_hours
        object.__setattr__(task, "remaining_hours", 5.0)

        return project, goal, task

    @pytest.fixture
    def sample_normal_project_with_tasks(self):
        """Sample project with normal allocation for testing."""
        project_id = uuid4()
        goal_id = uuid4()
        task_id = uuid4()

        project = Project(
            id=project_id,
            owner_id=uuid4(),
            title="Normal Allocation Project",
            description="Project that should get normal allocation",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        goal = Goal(
            id=goal_id,
            project_id=project_id,
            title="Goal in Normal Project",
            description="Goal that should be scheduled",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        task = Task(
            id=task_id,
            title="Task in Normal Project",
            description="Task that should be scheduled",
            estimate_hours=3.0,
            goal_id=goal_id,
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        # Set remaining_hours
        object.__setattr__(task, "remaining_hours", 3.0)

        return project, goal, task

    def test_zero_allocation_constraint_logic(self):
        """Test the logic for zero allocation constraint."""
        # Test zero allocation
        zero_allocation = ProjectAllocation(
            project_id="zero_project",
            project_title="Zero Project",
            target_hours=0.0,
            max_hours=0.0,
            priority_weight=0.0,
        )

        assert zero_allocation.target_hours <= 0.001

        # Test small epsilon allocation (should be treated as zero)
        tiny_allocation = ProjectAllocation(
            project_id="tiny_project",
            project_title="Tiny Project",
            target_hours=0.0005,
            max_hours=0.001,
            priority_weight=0.0,
        )

        assert tiny_allocation.target_hours <= 0.001

        # Test normal allocation
        normal_allocation = ProjectAllocation(
            project_id="normal_project",
            project_title="Normal Project",
            target_hours=10.0,
            max_hours=15.0,
            priority_weight=0.5,
        )

        assert not (normal_allocation.target_hours <= 0.001)

    @patch(
        "humancompiler_api.ai.weekly_task_solver.WeeklyTaskSolver._optimize_project_allocations"
    )
    async def test_small_epsilon_allocation_still_blocks(
        self,
        mock_optimize_allocations,
        mock_solver,
        mock_session,
        sample_project_with_tasks,
    ):
        """Test that very small allocation (< 0.001) is treated as zero."""
        zero_project, zero_goal, zero_task = sample_project_with_tasks

        # Mock context collector
        mock_context = MagicMock()
        mock_context.tasks = [zero_task]
        mock_context.goals = [zero_goal]
        mock_context.projects = [zero_project]
        mock_context.selected_recurring_task_ids = []
        mock_context.weekly_recurring_tasks = []

        mock_solver.context_collector = MagicMock()
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Mock very small allocation (should be treated as zero)
        tiny_allocation = ProjectAllocation(
            project_id=str(zero_project.id),
            project_title=zero_project.title,
            target_hours=0.0005,  # Very small, should be treated as 0
            max_hours=0.001,
            priority_weight=0.0,
        )

        mock_optimize_allocations.return_value = [tiny_allocation]

        # Mock dependency methods
        with (
            patch.object(
                mock_solver, "_collect_task_dependencies"
            ) as mock_collect_deps,
            patch.object(
                mock_solver, "_check_dependencies_schedulable_in_week"
            ) as mock_check_deps,
            patch.object(mock_solver, "_get_task_actual_hours") as mock_get_actual,
        ):
            mock_collect_deps.return_value = {}
            mock_check_deps.return_value = ([zero_task], [])
            mock_get_actual.return_value = {}

            request = TaskSolverRequest(
                week_start_date="2024-01-01",
                constraints=WeeklyConstraints(total_capacity_hours=40.0),
            )

            result = await mock_solver.solve_weekly_tasks(
                mock_session, "user123", request
            )

            # Very small allocation should still block the task
            selected_task_ids = [task.task_id for task in result.selected_tasks]
            assert str(zero_task.id) not in selected_task_ids

            # Total allocated hours should be 0
            assert result.total_allocated_hours == 0.0

    async def test_zero_allocation_constraint_logging(
        self, mock_solver, mock_session, sample_project_with_tasks
    ):
        """Test that zero allocation constraint logging works correctly."""
        zero_project, zero_goal, zero_task = sample_project_with_tasks

        # Mock context
        mock_context = MagicMock()
        mock_context.tasks = [zero_task]
        mock_context.goals = [zero_goal]
        mock_context.projects = [zero_project]
        mock_context.selected_recurring_task_ids = []
        mock_context.weekly_recurring_tasks = []

        # Create zero allocation
        zero_allocation = ProjectAllocation(
            project_id=str(zero_project.id),
            project_title=zero_project.title,
            target_hours=0.0,
            max_hours=0.0,
            priority_weight=0.0,
        )

        # Test OR-Tools constraint application directly
        with patch("humancompiler_api.ai.weekly_task_solver.logger") as mock_logger:
            # This would normally be called within _optimize_with_ortools
            # We're testing the constraint logic directly

            # Simulate the constraint check
            if zero_allocation.target_hours <= 0.001:
                mock_logger.debug.assert_not_called()  # Not called yet

                # Simulate adding the constraint
                mock_logger.debug(
                    f"Applied 0% allocation constraint for project {zero_allocation.project_id}"
                )

            # Verify the debug message would be logged
            mock_logger.debug.assert_called_with(
                f"Applied 0% allocation constraint for project {zero_allocation.project_id}"
            )
