"""
Tests for weekly task solver task filtering (0% allocation project exclusion).
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
    WeeklyPlanContext,
)
from humancompiler_api.models import Task, Goal, Project, TaskStatus


class TestWeeklyTaskSolverTaskFiltering:
    """Test cases for task filtering based on project allocations."""

    @pytest.fixture
    def mock_session(self):
        """Mock database session."""
        return MagicMock(spec=Session)

    @pytest.fixture
    def mock_solver(self):
        """Mock weekly task solver."""
        return WeeklyTaskSolver(openai_client=None, model="gpt-4")

    @pytest.fixture
    def sample_project_setup(self):
        """Sample setup with projects having different allocations."""
        # Project 1: 0% allocation
        zero_project_id = uuid4()
        zero_goal_id = uuid4()
        zero_project = Project(
            id=zero_project_id,
            owner_id=uuid4(),
            title="Zero Allocation Project",
            description="Project with 0% allocation",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        zero_goal = Goal(
            id=zero_goal_id,
            project_id=zero_project_id,
            title="Zero Goal",
            description="Goal in zero allocation project",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        zero_task = Task(
            id=uuid4(),
            title="Zero Project Task",
            description="Task that should be filtered out",
            estimate_hours=5.0,
            goal_id=zero_goal_id,
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        # Project 2: Normal allocation
        normal_project_id = uuid4()
        normal_goal_id = uuid4()
        normal_project = Project(
            id=normal_project_id,
            owner_id=uuid4(),
            title="Normal Allocation Project",
            description="Project with normal allocation",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        normal_goal = Goal(
            id=normal_goal_id,
            project_id=normal_project_id,
            title="Normal Goal",
            description="Goal in normal allocation project",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        normal_task = Task(
            id=uuid4(),
            title="Normal Project Task",
            description="Task that should be included",
            estimate_hours=3.0,
            goal_id=normal_goal_id,
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        # Set remaining_hours
        object.__setattr__(zero_task, "remaining_hours", 5.0)
        object.__setattr__(normal_task, "remaining_hours", 3.0)

        # Project allocations
        zero_allocation = ProjectAllocation(
            project_id=str(zero_project_id),
            project_title=zero_project.title,
            target_hours=0.0,
            max_hours=0.0,
            priority_weight=0.0,
        )
        normal_allocation = ProjectAllocation(
            project_id=str(normal_project_id),
            project_title=normal_project.title,
            target_hours=10.0,
            max_hours=12.0,
            priority_weight=0.8,
        )

        return {
            "zero_project": zero_project,
            "zero_goal": zero_goal,
            "zero_task": zero_task,
            "normal_project": normal_project,
            "normal_goal": normal_goal,
            "normal_task": normal_task,
            "zero_allocation": zero_allocation,
            "normal_allocation": normal_allocation,
        }

    async def test_task_filtering_excludes_zero_allocation_tasks(
        self, mock_solver, mock_session, sample_project_setup
    ):
        """Test that tasks from 0% allocation projects are filtered out."""
        setup = sample_project_setup

        # Mock context collector
        mock_context = MagicMock(spec=WeeklyPlanContext)
        mock_context.tasks = [setup["zero_task"], setup["normal_task"]]
        mock_context.goals = [setup["zero_goal"], setup["normal_goal"]]
        mock_context.projects = [setup["zero_project"], setup["normal_project"]]
        mock_context.selected_recurring_task_ids = []
        mock_context.weekly_recurring_tasks = []

        mock_solver.context_collector = MagicMock()
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Mock dependencies
        with (
            patch.object(mock_solver, "_get_task_actual_hours") as mock_get_actual,
            patch.object(
                mock_solver, "_collect_task_dependencies"
            ) as mock_collect_deps,
            patch.object(
                mock_solver, "_check_dependencies_schedulable_in_week"
            ) as mock_check_deps,
        ):
            mock_get_actual.return_value = {}
            mock_collect_deps.return_value = {}
            mock_check_deps.return_value = (
                [setup["zero_task"], setup["normal_task"]],
                [],
            )

            project_allocations = [setup["zero_allocation"], setup["normal_allocation"]]

            request = TaskSolverRequest(
                week_start_date="2024-01-01",
                constraints=WeeklyConstraints(total_capacity_hours=40.0),
            )

            # Call _collect_solver_context directly with project allocations
            result_context = await mock_solver._collect_solver_context(
                mock_session, "user123", date(2024, 1, 1), request, project_allocations
            )

            # Should only include tasks from non-zero allocation projects
            assert len(result_context.tasks) == 1
            assert result_context.tasks[0].id == setup["normal_task"].id
            assert setup["zero_task"] not in result_context.tasks

    def test_zero_allocation_detection_logic(self):
        """Test the logic for detecting 0% allocation."""
        # Test exactly 0.0
        zero_allocation = ProjectAllocation(
            project_id="zero",
            project_title="Zero",
            target_hours=0.0,
            max_hours=0.0,
            priority_weight=0.0,
        )
        assert zero_allocation.target_hours <= 0.001

        # Test very small value (should be treated as zero)
        tiny_allocation = ProjectAllocation(
            project_id="tiny",
            project_title="Tiny",
            target_hours=0.0005,
            max_hours=0.001,
            priority_weight=0.0,
        )
        assert tiny_allocation.target_hours <= 0.001

        # Test normal allocation
        normal_allocation = ProjectAllocation(
            project_id="normal",
            project_title="Normal",
            target_hours=5.0,
            max_hours=6.0,
            priority_weight=0.5,
        )
        assert not (normal_allocation.target_hours <= 0.001)

    async def test_task_filtering_with_mixed_allocations(
        self, mock_solver, mock_session
    ):
        """Test filtering with multiple projects having different allocations."""
        # Create 3 projects: 0%, tiny%, and normal%
        projects = []
        goals = []
        tasks = []
        allocations = []

        allocation_values = [0.0, 0.0008, 5.0]  # 0%, tiny%, normal%
        expected_included = [False, False, True]  # Which should be included

        for i, target_hours in enumerate(allocation_values):
            project_id = uuid4()
            goal_id = uuid4()

            project = Project(
                id=project_id,
                owner_id=uuid4(),
                title=f"Project {i}",
                description=f"Project with {target_hours} hours allocation",
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            goal = Goal(
                id=goal_id,
                project_id=project_id,
                title=f"Goal {i}",
                description=f"Goal in project {i}",
                estimate_hours=10.0,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            task = Task(
                id=uuid4(),
                title=f"Task {i}",
                description=f"Task in project {i}",
                estimate_hours=3.0,
                goal_id=goal_id,
                status=TaskStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            object.__setattr__(task, "remaining_hours", 3.0)

            allocation = ProjectAllocation(
                project_id=str(project_id),
                project_title=project.title,
                target_hours=target_hours,
                max_hours=max(target_hours * 1.2, 1.0),
                priority_weight=0.5 if target_hours > 0 else 0.0,
            )

            projects.append(project)
            goals.append(goal)
            tasks.append(task)
            allocations.append(allocation)

        # Mock context collector
        mock_context = MagicMock(spec=WeeklyPlanContext)
        mock_context.tasks = tasks
        mock_context.goals = goals
        mock_context.projects = projects
        mock_context.selected_recurring_task_ids = []
        mock_context.weekly_recurring_tasks = []

        mock_solver.context_collector = MagicMock()
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Mock dependencies
        with (
            patch.object(mock_solver, "_get_task_actual_hours") as mock_get_actual,
            patch.object(
                mock_solver, "_collect_task_dependencies"
            ) as mock_collect_deps,
            patch.object(
                mock_solver, "_check_dependencies_schedulable_in_week"
            ) as mock_check_deps,
        ):
            mock_get_actual.return_value = {}
            mock_collect_deps.return_value = {}
            mock_check_deps.return_value = (tasks, [])

            request = TaskSolverRequest(
                week_start_date="2024-01-01",
                constraints=WeeklyConstraints(total_capacity_hours=40.0),
            )

            # Call _collect_solver_context with allocations
            result_context = await mock_solver._collect_solver_context(
                mock_session, "user123", date(2024, 1, 1), request, allocations
            )

            # Should only include task from project with normal allocation (index 2)
            assert len(result_context.tasks) == 1
            included_task = result_context.tasks[0]
            assert included_task.title == "Task 2"  # The normal allocation task

    async def test_no_project_allocation_fallback(
        self, mock_solver, mock_session, sample_project_setup
    ):
        """Test behavior when no project allocation is provided."""
        setup = sample_project_setup

        # Mock context collector
        mock_context = MagicMock(spec=WeeklyPlanContext)
        mock_context.tasks = [setup["normal_task"]]  # Only normal task
        mock_context.goals = [setup["normal_goal"]]
        mock_context.projects = [setup["normal_project"]]
        mock_context.selected_recurring_task_ids = []
        mock_context.weekly_recurring_tasks = []

        mock_solver.context_collector = MagicMock()
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        # Mock _optimize_project_allocations to return normal allocation
        with (
            patch.object(mock_solver, "_get_task_actual_hours") as mock_get_actual,
            patch.object(
                mock_solver, "_collect_task_dependencies"
            ) as mock_collect_deps,
            patch.object(
                mock_solver, "_check_dependencies_schedulable_in_week"
            ) as mock_check_deps,
            patch.object(mock_solver, "_optimize_project_allocations") as mock_optimize,
        ):
            mock_get_actual.return_value = {}
            mock_collect_deps.return_value = {}
            mock_check_deps.return_value = ([setup["normal_task"]], [])
            mock_optimize.return_value = [setup["normal_allocation"]]

            request = TaskSolverRequest(
                week_start_date="2024-01-01",
                constraints=WeeklyConstraints(total_capacity_hours=40.0),
            )

            # Call without project allocations (should compute them internally)
            result_context = await mock_solver._collect_solver_context(
                mock_session, "user123", date(2024, 1, 1), request, None
            )

            # Should include the task (since it's from normal allocation project)
            assert len(result_context.tasks) == 1
            assert result_context.tasks[0].id == setup["normal_task"].id
