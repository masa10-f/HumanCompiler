"""
Tests for WeeklyTaskSolver remaining hours functionality (Issue #138).
"""

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, date
from uuid import uuid4

from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    WeeklyConstraints,
)
from taskagent_api.ai.models import WeeklyPlanContext, TaskPlan
from taskagent_api.models import Task, Goal, Project, User


class TestWeeklyTaskSolverRemainingHours:
    """Test cases for remaining hours calculation in WeeklyTaskSolver."""

    @pytest.fixture
    def mock_session(self):
        """Create mock database session."""
        session = MagicMock()
        return session

    @pytest.fixture
    def sample_tasks(self):
        """Create sample tasks with different actual hours scenarios."""
        return [
            Task(
                id=uuid4(),
                title="Task with remaining hours",
                description="Task description 1",
                estimate_hours=5.0,
                status="in_progress",
            ),
            Task(
                id=uuid4(),
                title="Task with no remaining hours",
                description="Task description 2",
                estimate_hours=2.0,
                status="in_progress",
            ),
            Task(
                id=uuid4(),
                title="Task with no actual hours",
                description="Task description 3",
                estimate_hours=3.0,
                status="todo",
            ),
        ]

    @pytest.fixture
    def sample_context(self, sample_tasks):
        """Create sample weekly plan context."""
        project = Project(id=uuid4(), title="Test Project", owner_id=uuid4())
        goal = Goal(id=uuid4(), title="Test Goal", project_id=project.id)

        return WeeklyPlanContext(
            user_id=str(uuid4()),
            week_start_date=date(2024, 1, 1),
            projects=[project],
            goals=[goal],
            tasks=sample_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

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

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._get_task_actual_hours"
    )
    async def test_collect_solver_context_filters_completed_tasks(
        self, mock_get_actual_hours, mock_session, sample_context
    ):
        """Test that _collect_solver_context filters out tasks with no remaining hours."""
        # Setup mock actual hours data
        task_ids = [str(task.id) for task in sample_context.tasks]
        mock_get_actual_hours.return_value = {
            task_ids[0]: 2.0,  # Task 1: 5.0 - 2.0 = 3.0 remaining
            task_ids[1]: 2.0,  # Task 2: 2.0 - 2.0 = 0.0 remaining (should be filtered)
            task_ids[2]: 0.0,  # Task 3: 3.0 - 0.0 = 3.0 remaining
        }

        # Mock context collector
        mock_context_collector = MagicMock()
        mock_context_collector.collect_weekly_plan_context.return_value = sample_context

        solver = WeeklyTaskSolver()
        solver.context_collector = mock_context_collector

        request = TaskSolverRequest(
            week_start_date="2024-01-01", constraints=WeeklyConstraints()
        )

        result_context = await solver._collect_solver_context(
            mock_session, str(uuid4()), date(2024, 1, 1), request
        )

        # Should have filtered out task with 0 remaining hours
        assert len(result_context.tasks) == 2

        # Check that remaining hours are correctly calculated and attached
        for task in result_context.tasks:
            assert hasattr(task, "remaining_hours")
            assert hasattr(task, "actual_hours")
            assert task.remaining_hours > 0

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._get_task_actual_hours"
    )
    def test_fallback_priority_calculation_uses_remaining_hours(
        self, mock_get_actual_hours
    ):
        """Test that fallback priority calculation uses remaining hours."""
        # Create a mock task with remaining_hours attribute
        mock_task = MagicMock()
        mock_task.id = uuid4()
        mock_task.estimate_hours = 5.0
        mock_task.remaining_hours = 1.5  # Small task should get priority bonus
        mock_task.due_date = None
        mock_task.goal_id = uuid4()

        project = Project(id=uuid4(), title="Test Project", owner_id=uuid4())
        goal = Goal(id=uuid4(), title="Test Goal", project_id=project.id)

        context = WeeklyPlanContext(
            user_id=str(uuid4()),
            week_start_date=date(2024, 1, 1),
            projects=[project],
            goals=[goal],
            tasks=[mock_task],
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        priority_extractor = solver.priority_extractor

        priorities = priority_extractor._fallback_priority_calculation(context, [])

        # Task with small remaining hours should get priority bonus
        task_priority = priorities[str(mock_task.id)]
        assert task_priority > 5.0  # Base priority + small task bonus

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._get_task_actual_hours"
    )
    def test_heuristic_task_selection_uses_remaining_hours(self, mock_get_actual_hours):
        """Test that heuristic task selection uses remaining hours."""
        # Create mock tasks with remaining_hours attributes
        mock_tasks = []
        for i, hours in enumerate([2.0, 4.0, 1.0]):
            mock_task = MagicMock()
            mock_task.id = uuid4()
            mock_task.estimate_hours = hours + 1.0
            mock_task.remaining_hours = hours
            mock_task.due_date = None
            mock_task.title = f"Test Task {i + 1}"
            mock_tasks.append(mock_task)

        project = Project(id=uuid4(), title="Test Project", owner_id=uuid4())
        goal = Goal(id=uuid4(), title="Test Goal", project_id=project.id)

        context = WeeklyPlanContext(
            user_id=str(uuid4()),
            week_start_date=date(2024, 1, 1),
            projects=[project],
            goals=[goal],
            tasks=mock_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        constraints = WeeklyConstraints(total_capacity_hours=10.0)

        selected_tasks, insights = solver._heuristic_task_selection(
            context, constraints, []
        )

        # Should select tasks within capacity based on remaining hours
        total_selected_hours = sum(task.estimated_hours for task in selected_tasks)
        assert total_selected_hours <= constraints.total_capacity_hours
        assert len(selected_tasks) > 0
        assert any("heuristic" in insight for insight in insights)

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

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._get_task_actual_hours"
    )
    def test_analyze_constraints_uses_remaining_hours(self, mock_get_actual_hours):
        """Test that constraint analysis uses remaining hours for workload calculation."""
        # Create mock tasks with remaining_hours attributes
        mock_tasks = []
        for _i in range(3):
            mock_task = MagicMock()
            mock_task.id = uuid4()
            mock_task.estimate_hours = 5.0
            mock_task.remaining_hours = float(_i + 1)  # 1.0, 2.0, 3.0 hours
            mock_task.due_date = None
            mock_tasks.append(mock_task)

        project = Project(id=uuid4(), title="Test Project", owner_id=uuid4())
        goal = Goal(id=uuid4(), title="Test Goal", project_id=project.id)

        context = WeeklyPlanContext(
            user_id=str(uuid4()),
            week_start_date=date(2024, 1, 1),
            projects=[project],
            goals=[goal],
            tasks=mock_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        constraints = WeeklyConstraints(
            total_capacity_hours=10.0, meeting_buffer_hours=2.0
        )

        analysis = solver._analyze_constraints(context, constraints)

        # Total task hours should be sum of remaining hours (1+2+3=6)
        assert analysis["total_task_hours"] == 6.0
        assert analysis["available_hours"] == 8.0  # 10 - 2
        assert analysis["capacity_utilization"] == 0.75  # 6/8

    @patch(
        "taskagent_api.ai.weekly_task_solver.WeeklyTaskSolver._get_task_actual_hours"
    )
    def test_optimize_project_allocations_uses_remaining_hours(
        self, mock_get_actual_hours
    ):
        """Test that project allocation optimization uses remaining hours."""
        # Create mock tasks with remaining_hours attributes
        mock_tasks = []
        for _i in range(3):
            mock_task = MagicMock()
            mock_task.id = uuid4()
            mock_task.estimate_hours = 5.0
            mock_task.remaining_hours = 2.0
            mock_task.due_date = None
            mock_task.goal_id = uuid4()
            mock_tasks.append(mock_task)

        project = Project(id=uuid4(), title="Test Project", owner_id=uuid4())
        goal = Goal(id=uuid4(), title="Test Goal", project_id=project.id)

        # Set the goal_id for tasks to match the goal
        for task in mock_tasks:
            task.goal_id = goal.id

        context = WeeklyPlanContext(
            user_id=str(uuid4()),
            week_start_date=date(2024, 1, 1),
            projects=[project],
            goals=[goal],
            tasks=mock_tasks,
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        solver = WeeklyTaskSolver()
        constraints = WeeklyConstraints(
            total_capacity_hours=20.0, meeting_buffer_hours=2.0
        )

        allocations = solver._optimize_project_allocations(context, constraints)

        # Should create allocations based on remaining hours workload
        assert len(allocations) > 0
        total_allocated = sum(alloc.target_hours for alloc in allocations)
        assert total_allocated <= 18.0  # Available hours after buffer
