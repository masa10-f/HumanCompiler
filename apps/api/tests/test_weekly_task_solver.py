"""
Basic tests for WeeklyTaskSolver functionality.
"""

import pytest
from datetime import date, datetime
from unittest.mock import Mock, AsyncMock

from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    WeeklyConstraints,
    ProjectAllocation,
)
from taskagent_api.ai.models import WeeklyPlanContext, TaskPlan
from taskagent_api.models import Project, Goal, Task


class TestWeeklyTaskSolver:
    """Test cases for WeeklyTaskSolver."""

    def test_weekly_constraints_defaults(self):
        """Test WeeklyConstraints default values."""
        constraints = WeeklyConstraints()

        assert constraints.total_capacity_hours == 40.0
        assert constraints.daily_max_hours == 8.0
        assert constraints.deep_work_blocks == 2
        assert constraints.meeting_buffer_hours == 5.0
        assert constraints.deadline_weight == 0.4
        assert constraints.project_balance_weight == 0.3
        assert constraints.effort_efficiency_weight == 0.3

    def test_task_solver_request_validation(self):
        """Test TaskSolverRequest validation."""
        request = TaskSolverRequest(week_start_date="2025-08-12")

        assert request.week_start_date == "2025-08-12"
        assert isinstance(request.constraints, WeeklyConstraints)
        assert request.project_filter is None
        assert request.preferences == {}

    def test_project_allocation_model(self):
        """Test ProjectAllocation model."""
        allocation = ProjectAllocation(
            project_id="proj-1",
            project_title="Test Project",
            target_hours=20.0,
            max_hours=25.0,
            priority_weight=0.6,
        )

        assert allocation.project_id == "proj-1"
        assert allocation.project_title == "Test Project"
        assert allocation.target_hours == 20.0
        assert allocation.max_hours == 25.0
        assert allocation.priority_weight == 0.6

    def test_weekly_task_solver_initialization(self):
        """Test WeeklyTaskSolver initialization."""
        solver = WeeklyTaskSolver()

        assert solver.openai_client is None
        assert solver.model == "gpt-5"
        assert solver.context_collector is not None

    def test_weekly_task_solver_with_custom_model(self):
        """Test WeeklyTaskSolver with custom model."""
        mock_client = Mock()
        solver = WeeklyTaskSolver(openai_client=mock_client, model="gpt-4o-2024-11-20")

        assert solver.openai_client == mock_client
        assert solver.model == "gpt-4o-2024-11-20"

    def test_heuristic_task_selection_empty_context(self):
        """Test heuristic task selection with empty context."""
        solver = WeeklyTaskSolver()

        # Create empty context
        context = WeeklyPlanContext(
            user_id="test-user",
            week_start_date=date(2025, 8, 12),
            projects=[],
            goals=[],
            tasks=[],
            capacity_hours=40.0,
            preferences={},
        )

        constraints = WeeklyConstraints()
        project_allocations = []

        selected_tasks, insights = solver._heuristic_task_selection(
            context, constraints, project_allocations
        )

        assert selected_tasks == []
        assert "Using heuristic task selection (AI unavailable)" in insights

    def test_heuristic_task_selection_with_tasks(self):
        """Test heuristic task selection with actual tasks."""
        solver = WeeklyTaskSolver()

        # Create mock tasks
        task1 = Mock(spec=Task)
        task1.id = "task-1"
        task1.title = "High Priority Task"
        task1.estimate_hours = 4.0
        task1.due_date = date(2025, 8, 14)  # Due in 2 days

        task2 = Mock(spec=Task)
        task2.id = "task-2"
        task2.title = "Low Priority Task"
        task2.estimate_hours = 8.0
        task2.due_date = date(2025, 8, 20)  # Due in 8 days

        context = WeeklyPlanContext(
            user_id="test-user",
            week_start_date=date(2025, 8, 12),
            projects=[],
            goals=[],
            tasks=[task1, task2],
            capacity_hours=40.0,
            preferences={},
        )

        constraints = WeeklyConstraints()
        project_allocations = []

        selected_tasks, insights = solver._heuristic_task_selection(
            context, constraints, project_allocations
        )

        # Should select both tasks as they fit within capacity
        assert len(selected_tasks) == 2
        # Higher priority task should come first
        assert selected_tasks[0].task_id == "task-1"
        assert selected_tasks[1].task_id == "task-2"
        assert "Using heuristic task selection (AI unavailable)" in insights

    def test_calculate_solver_metrics_basic(self):
        """Test basic solver metrics calculation."""
        solver = WeeklyTaskSolver()

        # Create mock data
        selected_tasks = [
            TaskPlan(
                task_id="task-1",
                task_title="Task 1",
                estimated_hours=4.0,
                priority=8,
                suggested_day="Monday",
                suggested_time_slot="09:00-13:00",
                rationale="High priority",
            ),
            TaskPlan(
                task_id="task-2",
                task_title="Task 2",
                estimated_hours=6.0,
                priority=6,
                suggested_day="Tuesday",
                suggested_time_slot="09:00-15:00",
                rationale="Medium priority",
            ),
        ]

        project_allocations = [
            ProjectAllocation(
                project_id="proj-1",
                project_title="Project 1",
                target_hours=10.0,
                max_hours=15.0,
                priority_weight=1.0,
            )
        ]

        constraints = WeeklyConstraints(total_capacity_hours=40.0)

        # Create minimal context
        goal1 = Mock(spec=Goal)
        goal1.id = "goal-1"
        goal1.project_id = "proj-1"

        task1 = Mock(spec=Task)
        task1.id = "task-1"
        task1.goal_id = "goal-1"

        task2 = Mock(spec=Task)
        task2.id = "task-2"
        task2.goal_id = "goal-1"

        context = WeeklyPlanContext(
            user_id="test-user",
            week_start_date=date(2025, 8, 12),
            projects=[],
            goals=[goal1],
            tasks=[task1, task2],
            capacity_hours=40.0,
            preferences={},
        )

        metrics = solver._calculate_solver_metrics(
            selected_tasks, project_allocations, constraints, context
        )

        assert metrics["capacity_utilization"] == 0.25  # 10 / 40
        assert metrics["task_count"] == 2
        assert metrics["avg_task_hours"] == 5.0  # (4 + 6) / 2
        assert metrics["projects_involved"] == 1
        assert "proj-1" in metrics["project_distribution"]
        assert metrics["project_distribution"]["proj-1"] == 10.0

    @pytest.mark.asyncio
    async def test_solve_weekly_tasks_fallback(self):
        """Test solve_weekly_tasks with fallback (no OpenAI client)."""
        solver = WeeklyTaskSolver()  # No OpenAI client

        # Mock session and context collector
        mock_session = Mock()
        solver.context_collector = Mock()
        solver.context_collector.collect_weekly_plan_context = AsyncMock()

        # Setup mock context
        context = WeeklyPlanContext(
            user_id="test-user",
            week_start_date=date(2025, 8, 12),
            projects=[],
            goals=[],
            tasks=[],
            capacity_hours=40.0,
            preferences={},
        )
        solver.context_collector.collect_weekly_plan_context.return_value = context

        request = TaskSolverRequest(week_start_date="2025-08-12")

        response = await solver.solve_weekly_tasks(
            session=mock_session, user_id="test-user", request=request
        )

        assert response.success is True
        assert response.week_start_date == "2025-08-12"
        assert response.total_allocated_hours == 0.0
        assert len(response.selected_tasks) == 0
        assert (
            "Using heuristic task selection (AI unavailable)"
            in response.optimization_insights
        )

    def test_analyze_constraints_basic(self):
        """Test constraint analysis."""
        solver = WeeklyTaskSolver()

        # Create mock task with estimate
        task1 = Mock(spec=Task)
        task1.estimate_hours = 8.0
        task1.due_date = date(2025, 8, 14)  # Within week

        task2 = Mock(spec=Task)
        task2.estimate_hours = 6.0
        task2.due_date = date(2025, 8, 20)  # Outside week

        context = WeeklyPlanContext(
            user_id="test-user",
            week_start_date=date(2025, 8, 12),
            projects=[Mock()],  # One project
            goals=[],
            tasks=[task1, task2],
            capacity_hours=40.0,
            preferences={},
        )

        constraints = WeeklyConstraints(
            total_capacity_hours=40.0, meeting_buffer_hours=5.0
        )

        analysis = solver._analyze_constraints(context, constraints)

        assert analysis["total_task_hours"] == 14.0  # 8 + 6
        assert analysis["available_hours"] == 35.0  # 40 - 5
        assert analysis["urgent_task_count"] == 1  # Only task1 is urgent
        assert analysis["project_count"] == 1
        assert analysis["overload_risk"] is False  # 14 < 40
