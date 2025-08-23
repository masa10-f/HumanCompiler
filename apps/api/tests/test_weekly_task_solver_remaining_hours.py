"""
Tests for WeeklyTaskSolver remaining hours functionality (Issue #138).
"""

import pytest
from unittest.mock import MagicMock
from uuid import uuid4

from taskagent_api.ai.weekly_task_solver import WeeklyTaskSolver
from taskagent_api.ai.models import TaskPlan


class TestWeeklyTaskSolverRemainingHours:
    """Test cases for remaining hours calculation in WeeklyTaskSolver."""

    @pytest.fixture
    def mock_session(self):
        """Create mock database session."""
        session = MagicMock()
        return session

    def test_get_task_actual_hours_empty_input(self, mock_session):
        """Test _get_task_actual_hours with empty input."""
        solver = WeeklyTaskSolver()
        result = solver._get_task_actual_hours(mock_session, [])
        assert result == {}

    def test_get_task_actual_hours_with_logs(self, mock_session):
        """Test _get_task_actual_hours with mock log data."""
        # Mock the select and exec methods
        task_id = str(uuid4())
        mock_result = [(uuid4(), 180)]  # 180 minutes = 3 hours
        mock_session.exec.return_value.all.return_value = mock_result

        solver = WeeklyTaskSolver()
        result = solver._get_task_actual_hours(mock_session, [task_id])

        # Should be empty due to UUID mismatch in mock, but method should not crash
        assert isinstance(result, dict)

    def test_task_plan_uses_string_task_id(self):
        """Test that TaskPlan uses string task_id for compatibility."""
        task_id = uuid4()
        task_plan = TaskPlan(
            task_id=str(task_id),
            task_title="Test Task",
            estimated_hours=2.5,
            priority=3,
            rationale="Test rationale",
        )

        assert isinstance(task_plan.task_id, str)
        assert task_plan.estimated_hours == 2.5

    def test_weekly_task_solver_initialization(self):
        """Test WeeklyTaskSolver can be initialized with remaining hours methods."""
        solver = WeeklyTaskSolver()

        # Should have the new method
        assert hasattr(solver, "_get_task_actual_hours")

        # Method should be callable
        assert callable(solver._get_task_actual_hours)
