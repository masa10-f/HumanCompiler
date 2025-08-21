"""
Tests for scheduler dependency constraints.
"""

from datetime import datetime, time
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from taskagent_api.auth import get_current_user_id
from taskagent_api.main import app
from taskagent_api.routers.scheduler import (
    SchedulerTask,
    TaskKind,
    TimeSlot,
    SlotKind,
    optimize_schedule,
    _get_task_dependencies,
    _get_goal_dependencies,
    _check_task_dependencies_satisfied,
    _check_goal_dependencies_satisfied,
)
from taskagent_api.models import TaskStatus, GoalStatus

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_auth():
    """Automatically mock authentication for all tests in this module."""
    user_id = str(uuid4())

    def mock_get_user_id():
        return user_id

    app.dependency_overrides[get_current_user_id] = mock_get_user_id
    yield user_id
    app.dependency_overrides.clear()


class TestSchedulerDependencies:
    """Test cases for scheduler dependency constraints."""

    def test_optimize_schedule_with_session_parameter(self):
        """Test that optimize_schedule accepts session parameter and handles no dependencies case."""
        tasks = [
            SchedulerTask(
                id=str(uuid4()),
                title="Test Task 1",
                estimate_hours=2.0,
                priority=1,
                kind=TaskKind.FOCUSED_WORK,
            )
        ]

        time_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(11, 0),
                kind=SlotKind.FOCUSED_WORK,
                capacity_hours=2.0,
            )
        ]

        # Test without session (backward compatibility)
        result = optimize_schedule(tasks, time_slots)
        assert result.success
        assert len(result.assignments) == 1

        # Test with None session
        result = optimize_schedule(tasks, time_slots, session=None)
        assert result.success
        assert len(result.assignments) == 1

    @patch("taskagent_api.routers.scheduler.select")
    def test_get_task_dependencies_empty(self, mock_select):
        """Test getting task dependencies when there are none."""
        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = []

        tasks = [
            SchedulerTask(
                id=str(uuid4()),
                title="Test Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
            )
        ]

        result = _get_task_dependencies(mock_session, tasks)
        assert result == {}

    @patch("taskagent_api.routers.scheduler.select")
    def test_get_task_dependencies_with_dependencies(self, mock_select):
        """Test getting task dependencies when they exist."""
        task1_id = uuid4()
        task2_id = uuid4()
        task3_id = uuid4()

        mock_dependency = MagicMock()
        mock_dependency.task_id = task1_id
        mock_dependency.depends_on_task_id = task2_id

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = [mock_dependency]

        tasks = [
            SchedulerTask(
                id=str(task1_id),
                title="Dependent Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
            ),
            SchedulerTask(
                id=str(task2_id),
                title="Prerequisite Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
            ),
        ]

        result = _get_task_dependencies(mock_session, tasks)
        expected = {str(task1_id): [str(task2_id)]}
        assert result == expected

    @patch("taskagent_api.routers.scheduler.select")
    def test_get_goal_dependencies(self, mock_select):
        """Test getting goal dependencies."""
        goal1_id = uuid4()
        goal2_id = uuid4()

        mock_dependency = MagicMock()
        mock_dependency.goal_id = goal1_id
        mock_dependency.depends_on_goal_id = goal2_id

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = [mock_dependency]

        tasks = [
            SchedulerTask(
                id=str(uuid4()),
                title="Task in dependent goal",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
                goal_id=str(goal1_id),
                is_weekly_recurring=False,
            )
        ]

        result = _get_goal_dependencies(mock_session, tasks)
        expected = {str(goal1_id): [str(goal2_id)]}
        assert result == expected

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_task_dependencies_satisfied_no_dependencies(self, mock_select):
        """Test checking task dependencies when there are none."""
        mock_session = MagicMock()

        task = SchedulerTask(
            id=str(uuid4()),
            title="Independent Task",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
        )

        task_dependencies = {}  # No dependencies

        result = _check_task_dependencies_satisfied(
            mock_session, task, task_dependencies
        )
        assert result is True

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_task_dependencies_satisfied_completed(self, mock_select):
        """Test checking task dependencies when all dependencies are completed."""
        task_id = uuid4()
        dependency_id = uuid4()

        mock_completed_task = MagicMock()
        mock_completed_task.status = TaskStatus.COMPLETED

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = [mock_completed_task]

        task = SchedulerTask(
            id=str(task_id),
            title="Dependent Task",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
        )

        task_dependencies = {str(task_id): [str(dependency_id)]}

        result = _check_task_dependencies_satisfied(
            mock_session, task, task_dependencies
        )
        assert result is True

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_task_dependencies_not_satisfied_incomplete(self, mock_select):
        """Test checking task dependencies when dependencies are not completed."""
        task_id = uuid4()
        dependency_id = uuid4()

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = []  # No completed tasks

        task = SchedulerTask(
            id=str(task_id),
            title="Dependent Task",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
        )

        task_dependencies = {str(task_id): [str(dependency_id)]}

        result = _check_task_dependencies_satisfied(
            mock_session, task, task_dependencies
        )
        assert result is False

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_goal_dependencies_satisfied_no_dependencies(self, mock_select):
        """Test checking goal dependencies when there are none."""
        mock_session = MagicMock()

        task = SchedulerTask(
            id=str(uuid4()),
            title="Task without goal dependencies",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
            goal_id=str(uuid4()),
        )

        goal_dependencies = {}  # No dependencies

        result = _check_goal_dependencies_satisfied(
            mock_session, task, goal_dependencies
        )
        assert result is True

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_goal_dependencies_satisfied_completed(self, mock_select):
        """Test checking goal dependencies when all dependencies are completed."""
        goal_id = uuid4()
        dependency_goal_id = uuid4()

        mock_completed_goal = MagicMock()
        mock_completed_goal.status = GoalStatus.COMPLETED

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = [mock_completed_goal]

        task = SchedulerTask(
            id=str(uuid4()),
            title="Task in dependent goal",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
            goal_id=str(goal_id),
        )

        goal_dependencies = {str(goal_id): [str(dependency_goal_id)]}

        result = _check_goal_dependencies_satisfied(
            mock_session, task, goal_dependencies
        )
        assert result is True

    @patch("taskagent_api.routers.scheduler.select")
    def test_check_goal_dependencies_not_satisfied_incomplete(self, mock_select):
        """Test checking goal dependencies when dependencies are not completed."""
        goal_id = uuid4()
        dependency_goal_id = uuid4()

        mock_session = MagicMock()
        mock_session.exec.return_value.all.return_value = []  # No completed goals

        task = SchedulerTask(
            id=str(uuid4()),
            title="Task in dependent goal",
            estimate_hours=1.0,
            kind=TaskKind.LIGHT_WORK,
            goal_id=str(goal_id),
        )

        goal_dependencies = {str(goal_id): [str(dependency_goal_id)]}

        result = _check_goal_dependencies_satisfied(
            mock_session, task, goal_dependencies
        )
        assert result is False

    def test_weekly_recurring_tasks_always_schedulable(self):
        """Test that weekly recurring tasks are always schedulable regardless of dependencies."""
        mock_session = MagicMock()

        tasks = [
            SchedulerTask(
                id=str(uuid4()),
                title="Weekly Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
                is_weekly_recurring=True,
            )
        ]

        time_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(10, 0),
                kind=SlotKind.LIGHT_WORK,
                capacity_hours=1.0,
            )
        ]

        result = optimize_schedule(tasks, time_slots, session=mock_session)
        assert result.success
        assert len(result.assignments) == 1
        assert len(result.unscheduled_tasks) == 0

    @patch("taskagent_api.routers.scheduler._get_task_dependencies")
    @patch("taskagent_api.routers.scheduler._get_goal_dependencies")
    @patch("taskagent_api.routers.scheduler._check_task_dependencies_satisfied")
    @patch("taskagent_api.routers.scheduler._check_goal_dependencies_satisfied")
    def test_optimize_schedule_filters_dependent_tasks(
        self,
        mock_check_goal_deps,
        mock_check_task_deps,
        mock_get_goal_deps,
        mock_get_task_deps,
    ):
        """Test that optimize_schedule filters out tasks with unsatisfied dependencies."""
        mock_session = MagicMock()

        # Mock dependency data
        mock_get_task_deps.return_value = {}
        mock_get_goal_deps.return_value = {}

        # First task has satisfied dependencies, second doesn't
        mock_check_task_deps.side_effect = [True, False]
        mock_check_goal_deps.side_effect = [True, False]

        tasks = [
            SchedulerTask(
                id="task1",
                title="Schedulable Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
                is_weekly_recurring=False,
            ),
            SchedulerTask(
                id="task2",
                title="Blocked Task",
                estimate_hours=1.0,
                kind=TaskKind.LIGHT_WORK,
                is_weekly_recurring=False,
            ),
        ]

        time_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(11, 0),
                kind=SlotKind.LIGHT_WORK,
                capacity_hours=2.0,
            )
        ]

        result = optimize_schedule(tasks, time_slots, session=mock_session)

        # Only one task should be scheduled
        assert result.success
        assert len(result.assignments) == 1
        assert result.assignments[0].task_id == "task1"
        assert "task2" in result.unscheduled_tasks

    def test_optimize_schedule_no_schedulable_tasks_due_to_dependencies(self):
        """Test optimize_schedule when all tasks are blocked by dependencies."""
        mock_session = MagicMock()

        # Mock all dependency checks to return False
        with (
            patch(
                "taskagent_api.routers.scheduler._get_task_dependencies"
            ) as mock_get_task_deps,
            patch(
                "taskagent_api.routers.scheduler._get_goal_dependencies"
            ) as mock_get_goal_deps,
            patch(
                "taskagent_api.routers.scheduler._check_task_dependencies_satisfied"
            ) as mock_check_task_deps,
            patch(
                "taskagent_api.routers.scheduler._check_goal_dependencies_satisfied"
            ) as mock_check_goal_deps,
        ):
            mock_get_task_deps.return_value = {}
            mock_get_goal_deps.return_value = {}
            mock_check_task_deps.return_value = False  # All tasks blocked
            mock_check_goal_deps.return_value = False  # All tasks blocked

            tasks = [
                SchedulerTask(
                    id="blocked_task",
                    title="Blocked Task",
                    estimate_hours=1.0,
                    kind=TaskKind.LIGHT_WORK,
                    is_weekly_recurring=False,
                )
            ]

            time_slots = [
                TimeSlot(
                    start=time(9, 0),
                    end=time(10, 0),
                    kind=SlotKind.LIGHT_WORK,
                    capacity_hours=1.0,
                )
            ]

            result = optimize_schedule(tasks, time_slots, session=mock_session)

            assert result.success  # Still successful, just no tasks scheduled
            assert len(result.assignments) == 0
            assert "blocked_task" in result.unscheduled_tasks
            assert (
                result.optimization_status == "NO_SCHEDULABLE_TASKS_DUE_TO_DEPENDENCIES"
            )
