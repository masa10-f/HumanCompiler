"""
Tests for weekly task solver remaining hours functionality (Issue #138).
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal

from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    WeeklyConstraints,
    TaskSolverRequest,
)
from taskagent_api.ai.models import WeeklyPlanContext, TaskPlan
from taskagent_api.models import Task, Goal, Project, User


class TestWeeklyTaskSolverRemainingHours:
    """Test cases for remaining hours calculation in weekly task solver."""

    @pytest.fixture
    def mock_session(self):
        """Mock database session."""
        session = MagicMock()
        return session

    @pytest.fixture
    def sample_user_id(self):
        """Sample user ID."""
        return "test-user-123"

    @pytest.fixture
    def sample_tasks(self):
        """Sample tasks with different actual hours scenarios."""
        return [
            Task(
                id=UUID("12345678-0000-0000-0000-000000000001"),
                title="Task with remaining hours",
                description="Test task 1",
                estimate_hours=Decimal("5.0"),
                goal_id=UUID("87654321-0000-0000-0000-000000000001"),
                status="pending",
            ),
            Task(
                id=UUID("12345678-0000-0000-0000-000000000002"),
                title="Task with no remaining hours",
                description="Test task 2",
                estimate_hours=Decimal("3.0"),
                goal_id=UUID("87654321-0000-0000-0000-000000000001"),
                status="pending",
            ),
            Task(
                id=UUID("12345678-0000-0000-0000-000000000003"),
                title="Task with partial progress",
                description="Test task 3",
                estimate_hours=Decimal("4.0"),
                goal_id=UUID("87654321-0000-0000-0000-000000000001"),
                status="pending",
            ),
        ]

    @pytest.fixture
    def sample_context(self, sample_tasks):
        """Sample weekly plan context."""
        return WeeklyPlanContext(
            user_id="test-user-123",
            week_start_date=date(2024, 8, 19),
            projects=[],
            goals=[],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

    @pytest.fixture
    def constraints(self):
        """Sample constraints for testing."""
        return WeeklyConstraints(
            total_capacity_hours=40.0,
            daily_max_hours=8.0,
            deep_work_blocks=2,
            meeting_buffer_hours=5.0,
        )

    @pytest.fixture
    def task_solver_request(self, constraints):
        """Sample task solver request."""
        return TaskSolverRequest(week_start_date="2024-08-19", constraints=constraints)

    @patch("taskagent_api.routers.scheduler._get_task_actual_hours")
    async def test_collect_solver_context_calculates_remaining_hours(
        self,
        mock_get_actual_hours,
        mock_session,
        sample_user_id,
        sample_tasks,
        task_solver_request,
    ):
        """Test that _collect_solver_context correctly calculates remaining hours."""
        # Mock actual hours data
        mock_get_actual_hours.return_value = {
            "12345678-0000-0000-0000-000000000001": 2.0,  # 5.0 - 2.0 = 3.0 remaining
            "12345678-0000-0000-0000-000000000002": 3.0,  # 3.0 - 3.0 = 0.0 remaining (excluded)
            "12345678-0000-0000-0000-000000000003": 1.5,  # 4.0 - 1.5 = 2.5 remaining
        }

        # Mock context collector
        mock_context = WeeklyPlanContext(
            user_id="test-user-123",
            week_start_date=date(2024, 8, 19),
            projects=[],
            goals=[],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        solver.context_collector = MagicMock()
        solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Call the method
        result_context = await solver._collect_solver_context(
            mock_session, sample_user_id, date(2024, 8, 19), task_solver_request
        )

        # Verify actual hours retrieval was called
        mock_get_actual_hours.assert_called_once()
        called_task_ids = mock_get_actual_hours.call_args[0][1]
        expected_task_ids = [str(task.id) for task in sample_tasks]
        assert set(called_task_ids) == set(expected_task_ids)

        # Verify remaining hours calculation
        filtered_tasks = result_context.tasks

        # Should have 2 tasks (task2 excluded because remaining hours = 0)
        assert len(filtered_tasks) == 2

        # Check remaining hours for included tasks
        task1 = next(
            t
            for t in filtered_tasks
            if str(t.id) == "12345678-0000-0000-0000-000000000001"
        )
        assert hasattr(task1, "remaining_hours")
        assert task1.remaining_hours == 3.0
        assert task1.actual_hours == 2.0

        task3 = next(
            t
            for t in filtered_tasks
            if str(t.id) == "12345678-0000-0000-0000-000000000003"
        )
        assert hasattr(task3, "remaining_hours")
        assert task3.remaining_hours == 2.5
        assert task3.actual_hours == 1.5

        # Verify task2 was filtered out
        task2_found = any(
            str(t.id) == "12345678-0000-0000-0000-000000000002" for t in filtered_tasks
        )
        assert not task2_found

    def test_analyze_constraints_uses_remaining_hours(
        self, sample_context, constraints
    ):
        """Test that _analyze_constraints uses remaining hours for total calculation."""
        # Add remaining hours to tasks
        sample_context.tasks[0].__dict__["remaining_hours"] = 3.0  # task1
        sample_context.tasks[1].__dict__["remaining_hours"] = (
            2.5  # task3 (task2 filtered out)
        )

        solver = WeeklyTaskSolver()

        # Call analyze constraints
        analysis = solver._analyze_constraints(sample_context, constraints)

        # Should sum remaining hours: 3.0 + 2.5 + 4.0 (third task without remaining_hours set) = 9.5
        assert analysis["total_task_hours"] == 9.5

        # Available hours = 40.0 - 5.0 = 35.0
        assert analysis["available_hours"] == 35.0

        # Capacity utilization = 5.5 / 35.0
        expected_utilization = 5.5 / 35.0
        assert abs(analysis["capacity_utilization"] - expected_utilization) < 0.001

    @patch("taskagent_api.routers.scheduler._get_task_actual_hours")
    async def test_tasks_with_zero_remaining_hours_are_excluded(
        self,
        mock_get_actual_hours,
        mock_session,
        sample_user_id,
        sample_tasks,
        task_solver_request,
    ):
        """Test that tasks with zero remaining hours are excluded from planning."""
        # Mock actual hours where some tasks are completed
        mock_get_actual_hours.return_value = {
            "12345678-0000-0000-0000-000000000001": 5.0,  # 5.0 - 5.0 = 0.0 remaining (excluded)
            "12345678-0000-0000-0000-000000000002": 4.0,  # 3.0 - 4.0 = 0.0 remaining (over-logged, excluded)
            "12345678-0000-0000-0000-000000000003": 1.0,  # 4.0 - 1.0 = 3.0 remaining (included)
        }

        # Mock context collector
        mock_context = WeeklyPlanContext(
            user_id="test-user-123",
            week_start_date=date(2024, 8, 19),
            projects=[],
            goals=[],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        solver.context_collector = MagicMock()
        solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Call the method
        result_context = await solver._collect_solver_context(
            mock_session, sample_user_id, date(2024, 8, 19), task_solver_request
        )

        # Should only have task3 remaining
        assert len(result_context.tasks) == 1
        remaining_task = result_context.tasks[0]
        assert str(remaining_task.id) == "12345678-0000-0000-0000-000000000003"
        assert remaining_task.remaining_hours == 3.0

    @patch("taskagent_api.routers.scheduler._get_task_actual_hours")
    async def test_tasks_without_actual_hours_use_full_estimate(
        self,
        mock_get_actual_hours,
        mock_session,
        sample_user_id,
        sample_tasks,
        task_solver_request,
    ):
        """Test that tasks without logged hours use full estimate as remaining."""
        # Mock no actual hours logged
        mock_get_actual_hours.return_value = {}

        # Mock context collector
        mock_context = WeeklyPlanContext(
            user_id="test-user-123",
            week_start_date=date(2024, 8, 19),
            projects=[],
            goals=[],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        solver.context_collector = MagicMock()
        solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Call the method
        result_context = await solver._collect_solver_context(
            mock_session, sample_user_id, date(2024, 8, 19), task_solver_request
        )

        # All tasks should remain (no filtering) with full estimates as remaining
        assert len(result_context.tasks) == 3

        for task in result_context.tasks:
            assert hasattr(task, "remaining_hours")
            assert hasattr(task, "actual_hours")
            assert task.actual_hours == 0.0
            assert task.remaining_hours == float(task.estimate_hours)

    def test_heuristic_task_selection_uses_remaining_hours(
        self, sample_context, constraints
    ):
        """Test that heuristic task selection uses remaining hours for capacity checking."""
        # Setup tasks with remaining hours
        task1 = sample_context.tasks[0]
        task1.__dict__["remaining_hours"] = 2.0
        task1.__dict__["actual_hours"] = 3.0

        task2 = sample_context.tasks[1]
        task2.__dict__["remaining_hours"] = 1.5
        task2.__dict__["actual_hours"] = 1.5

        # Create solver and call heuristic selection
        solver = WeeklyTaskSolver()

        # Mock project allocations
        project_allocations = []

        selected_tasks, insights = solver._heuristic_task_selection(
            sample_context, constraints, project_allocations
        )

        # Verify tasks are selected based on remaining hours
        total_selected_hours = sum(task.estimated_hours for task in selected_tasks)

        # Should not exceed capacity and should reflect remaining hours
        assert total_selected_hours <= constraints.total_capacity_hours

        # Each selected task should use remaining hours as estimated_hours
        for task_plan in selected_tasks:
            # Find corresponding original task
            original_task = next(
                t for t in sample_context.tasks if str(t.id) == str(task_plan.task_id)
            )
            assert task_plan.estimated_hours == getattr(
                original_task,
                "remaining_hours",
                float(original_task.estimate_hours or 0),
            )


class TestWeeklyTaskSolverIntegration:
    """Integration tests for weekly task solver with remaining hours."""

    @patch("taskagent_api.routers.scheduler._get_task_actual_hours")
    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._optimize_with_ortools"
    )
    async def test_full_solve_workflow_with_remaining_hours(
        self, mock_optimize_ortools, mock_get_actual_hours
    ):
        """Test the complete solve workflow respects remaining hours."""
        # Setup mocks
        mock_get_actual_hours.return_value = {
            "12345678-0000-0000-0000-000000000001": 1.0,  # 5.0 - 1.0 = 4.0 remaining
        }

        # Mock OR-Tools response
        mock_task_plans = [
            TaskPlan(
                task_id="12345678-0000-0000-0000-000000000001",
                task_title="Test Task",
                estimated_hours=4.0,  # Should use remaining hours
                priority=5,
                rationale="Test task selection",
            )
        ]
        mock_optimize_ortools.return_value = (mock_task_plans, ["Test insight"])

        # Create solver with mocked components
        solver = WeeklyTaskSolver()
        solver.context_collector = MagicMock()
        solver.priority_extractor = MagicMock()

        # Mock context
        sample_tasks = [
            Task(
                id=UUID("12345678-0000-0000-0000-000000000001"),
                title="Test Task",
                description="Test description",
                estimate_hours=Decimal("5.0"),
                goal_id=UUID("87654321-0000-0000-0000-000000000001"),
                status="pending",
            )
        ]

        mock_context = WeeklyPlanContext(
            user_id="test-user-123",
            week_start_date=date(2024, 8, 19),
            projects=[],
            goals=[],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )
        solver.priority_extractor.extract_priorities = AsyncMock(return_value={})

        # Create request
        constraints = WeeklyConstraints(total_capacity_hours=40.0)
        request = TaskSolverRequest(
            week_start_date="2024-08-19", constraints=constraints
        )

        # Mock session
        mock_session = MagicMock()

        # Execute solve
        result = await solver.solve_weekly_tasks(mock_session, "test-user", request)

        # Verify result
        assert result.success
        assert len(result.selected_tasks) == 1
        assert (
            result.selected_tasks[0].estimated_hours == 4.0
        )  # Should be remaining hours
        assert result.total_allocated_hours == 4.0  # Should sum remaining hours
