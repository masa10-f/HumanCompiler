"""Unit tests for humancompiler_optimizer package.

These tests verify the solver logic in isolation without DB dependencies.
"""

from datetime import datetime, time

import pytest

from humancompiler_optimizer import (
    Assignment,
    DailySolverConfig,
    ScheduleResult,
    SchedulerTask,
    SlotKind,
    TaskKind,
    TimeSlot,
    optimize_daily_schedule,
)
from humancompiler_optimizer.weekly import (
    ProjectAllocationSpec,
    WeeklySelectionResult,
    WeeklySolverConfig,
    WeeklyTaskSpec,
    optimize_weekly_selection,
)


class TestDailySolverBasic:
    """Basic tests for daily schedule optimization."""

    def test_empty_tasks_returns_success(self):
        """Empty task list should return success with no assignments."""
        result = optimize_daily_schedule(tasks=[], time_slots=[])
        assert result.success is True
        assert result.assignments == []
        assert result.optimization_status == "NO_TASKS_OR_SLOTS"

    def test_empty_slots_returns_success(self):
        """Empty slot list should return success with all tasks unscheduled."""
        tasks = [
            SchedulerTask(id="task1", title="Task 1", estimate_hours=1.0),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=[])
        assert result.success is True
        assert result.unscheduled_tasks == ["task1"]
        assert result.optimization_status == "NO_TASKS_OR_SLOTS"

    def test_single_task_single_slot(self):
        """Single task should be assigned to single slot."""
        tasks = [
            SchedulerTask(id="task1", title="Task 1", estimate_hours=1.0),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        assert len(result.assignments) == 1
        assert result.assignments[0].task_id == "task1"
        assert result.optimization_status in ["OPTIMAL", "FEASIBLE"]

    def test_task_respects_slot_capacity(self):
        """Task duration should not exceed slot capacity."""
        tasks = [
            SchedulerTask(id="task1", title="Task 1", estimate_hours=5.0),
        ]
        slots = [
            TimeSlot(
                start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK, capacity_hours=2.0
            ),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        assert len(result.assignments) == 1
        assert result.assignments[0].duration_hours <= 2.0

    def test_multiple_tasks_single_slot(self):
        """Multiple tasks should fit within slot capacity."""
        tasks = [
            SchedulerTask(id="task1", title="Task 1", estimate_hours=1.0),
            SchedulerTask(id="task2", title="Task 2", estimate_hours=1.0),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        # At least one task should be scheduled
        assert len(result.assignments) >= 1


class TestDailySolverKindMatching:
    """Tests for task/slot kind matching optimization."""

    def test_prefers_matching_kind(self):
        """Solver should prefer assigning tasks to matching slot kinds."""
        tasks = [
            SchedulerTask(
                id="focused_task", title="Focused", estimate_hours=1.0, kind=TaskKind.FOCUSED_WORK
            ),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.FOCUSED_WORK),
            TimeSlot(start=time(13, 0), end=time(17, 0), kind=SlotKind.LIGHT_WORK),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        assert len(result.assignments) == 1
        # Should be assigned to focused_work slot (index 0)
        assert result.assignments[0].slot_index == 0


class TestDailySolverPriority:
    """Tests for priority-based scheduling."""

    def test_higher_priority_preferred(self):
        """Higher priority tasks (lower number) should be scheduled first."""
        tasks = [
            SchedulerTask(id="low_priority", title="Low", estimate_hours=2.0, priority=9),
            SchedulerTask(id="high_priority", title="High", estimate_hours=2.0, priority=1),
        ]
        slots = [
            TimeSlot(
                start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK, capacity_hours=2.0
            ),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        # High priority task should be scheduled
        scheduled_ids = [a.task_id for a in result.assignments]
        assert "high_priority" in scheduled_ids


class TestDailySolverDeadline:
    """Tests for deadline-based scheduling."""

    def test_urgent_deadline_preferred(self):
        """Tasks with closer deadlines should be prioritized."""
        schedule_date = datetime(2024, 1, 15)
        tasks = [
            SchedulerTask(
                id="far_deadline",
                title="Far",
                estimate_hours=2.0,
                due_date=datetime(2024, 1, 30),
            ),
            SchedulerTask(
                id="near_deadline",
                title="Near",
                estimate_hours=2.0,
                due_date=datetime(2024, 1, 16),
            ),
        ]
        slots = [
            TimeSlot(
                start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK, capacity_hours=2.0
            ),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots, date=schedule_date)
        assert result.success is True
        scheduled_ids = [a.task_id for a in result.assignments]
        assert "near_deadline" in scheduled_ids


class TestDailySolverDependencies:
    """Tests for task dependency constraints."""

    def test_task_dependency_ordering(self):
        """Dependent tasks should be scheduled after prerequisites."""
        tasks = [
            SchedulerTask(id="prereq", title="Prerequisite", estimate_hours=1.0),
            SchedulerTask(id="dependent", title="Dependent", estimate_hours=1.0),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(10, 0), kind=SlotKind.LIGHT_WORK),
            TimeSlot(start=time(10, 0), end=time(11, 0), kind=SlotKind.LIGHT_WORK),
        ]
        task_dependencies = {"dependent": ["prereq"]}
        result = optimize_daily_schedule(
            tasks=tasks, time_slots=slots, task_dependencies=task_dependencies
        )
        assert result.success is True
        # Find slot indices for each task
        prereq_slot = next(
            (a.slot_index for a in result.assignments if a.task_id == "prereq"), None
        )
        dependent_slot = next(
            (a.slot_index for a in result.assignments if a.task_id == "dependent"), None
        )
        if prereq_slot is not None and dependent_slot is not None:
            assert prereq_slot <= dependent_slot


class TestDailySolverProjectConstraints:
    """Tests for project-based slot assignment constraints."""

    def test_slot_project_assignment(self):
        """Tasks should only be assigned to slots matching their project."""
        tasks = [
            SchedulerTask(
                id="project_a_task",
                title="Project A Task",
                estimate_hours=1.0,
                project_id="project_a",
            ),
            SchedulerTask(
                id="project_b_task",
                title="Project B Task",
                estimate_hours=1.0,
                project_id="project_b",
            ),
        ]
        slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(12, 0),
                kind=SlotKind.LIGHT_WORK,
                assigned_project_id="project_a",
            ),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        # Only project_a_task should be scheduled
        scheduled_ids = [a.task_id for a in result.assignments]
        assert "project_a_task" in scheduled_ids
        assert "project_b_task" not in scheduled_ids


class TestDailySolverConfig:
    """Tests for solver configuration."""

    def test_custom_config(self):
        """Solver should accept custom configuration."""
        config = DailySolverConfig(
            max_time_in_seconds=1.0,
            kind_match_score=20,
            priority_score_base=20,
        )
        tasks = [
            SchedulerTask(id="task1", title="Task 1", estimate_hours=1.0),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots, config=config)
        assert result.success is True


class TestDailySolverRemainingHours:
    """Tests for remaining hours calculation."""

    def test_uses_remaining_hours(self):
        """Solver should use remaining hours (estimate - actual)."""
        tasks = [
            SchedulerTask(
                id="partial_task",
                title="Partial",
                estimate_hours=5.0,
                actual_hours=3.0,  # 2 hours remaining
            ),
        ]
        slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT_WORK),
        ]
        result = optimize_daily_schedule(tasks=tasks, time_slots=slots)
        assert result.success is True
        assert len(result.assignments) == 1
        # Should schedule remaining 2 hours, not full 5 hours
        assert result.assignments[0].duration_hours <= 2.0


class TestWeeklySolverBasic:
    """Basic tests for weekly task selection optimization."""

    def test_empty_tasks_returns_success(self):
        """Empty task list should return success."""
        result = optimize_weekly_selection(tasks=[], total_capacity_hours=40.0)
        assert result.success is True
        assert result.selected_task_ids == []

    def test_single_task_within_capacity(self):
        """Single task within capacity should be selected."""
        tasks = [
            WeeklyTaskSpec(id="task1", title="Task 1", hours=5.0, priority_score=5.0),
        ]
        result = optimize_weekly_selection(tasks=tasks, total_capacity_hours=40.0)
        assert result.success is True
        assert "task1" in result.selected_task_ids

    def test_respects_total_capacity(self):
        """Total selected hours should not exceed capacity."""
        tasks = [
            WeeklyTaskSpec(id="task1", title="Task 1", hours=30.0, priority_score=5.0),
            WeeklyTaskSpec(id="task2", title="Task 2", hours=30.0, priority_score=5.0),
        ]
        result = optimize_weekly_selection(tasks=tasks, total_capacity_hours=40.0)
        assert result.success is True
        assert result.selected_hours <= 40.0


class TestWeeklySolverPriority:
    """Tests for priority-based task selection."""

    def test_higher_priority_preferred(self):
        """Higher priority tasks should be selected over lower priority."""
        tasks = [
            WeeklyTaskSpec(id="low", title="Low", hours=20.0, priority_score=1.0),
            WeeklyTaskSpec(id="high", title="High", hours=20.0, priority_score=10.0),
        ]
        result = optimize_weekly_selection(tasks=tasks, total_capacity_hours=25.0)
        assert result.success is True
        assert "high" in result.selected_task_ids


class TestWeeklySolverProjectAllocation:
    """Tests for project allocation constraints."""

    def test_respects_project_allocation(self):
        """Solver should respect project allocation targets."""
        tasks = [
            WeeklyTaskSpec(
                id="proj_a_task1", title="A1", hours=5.0, priority_score=5.0, project_id="proj_a"
            ),
            WeeklyTaskSpec(
                id="proj_a_task2", title="A2", hours=5.0, priority_score=5.0, project_id="proj_a"
            ),
            WeeklyTaskSpec(
                id="proj_b_task1", title="B1", hours=5.0, priority_score=5.0, project_id="proj_b"
            ),
        ]
        allocations = [
            ProjectAllocationSpec(project_id="proj_a", target_hours=10.0),
        ]
        result = optimize_weekly_selection(
            tasks=tasks, project_allocations=allocations, total_capacity_hours=40.0
        )
        assert result.success is True
        # Project A should have approximately target hours
        proj_a_hours = result.selected_hours_by_project.get("proj_a", 0)
        assert proj_a_hours >= 9.0  # Allow for 95% tolerance

    def test_zero_allocation_excludes_project(self):
        """Zero allocation should exclude project tasks."""
        tasks = [
            WeeklyTaskSpec(
                id="proj_a_task", title="A", hours=5.0, priority_score=5.0, project_id="proj_a"
            ),
            WeeklyTaskSpec(
                id="proj_b_task", title="B", hours=5.0, priority_score=5.0, project_id="proj_b"
            ),
        ]
        allocations = [
            ProjectAllocationSpec(project_id="proj_a", target_hours=0.0),
        ]
        result = optimize_weekly_selection(
            tasks=tasks, project_allocations=allocations, total_capacity_hours=40.0
        )
        assert result.success is True
        # Project A task should not be selected
        assert "proj_a_task" not in result.selected_task_ids


class TestWeeklySolverRecurringTasks:
    """Tests for weekly recurring task handling."""

    def test_includes_recurring_tasks(self):
        """Recurring tasks should be included in selection."""
        tasks = [
            WeeklyTaskSpec(id="regular", title="Regular", hours=5.0, priority_score=5.0),
        ]
        recurring = [
            WeeklyTaskSpec(id="weekly1", title="Weekly", hours=2.0, priority_score=8.0),
        ]
        result = optimize_weekly_selection(
            tasks=tasks, recurring_tasks=recurring, total_capacity_hours=40.0
        )
        assert result.success is True
        assert "weekly1" in result.selected_recurring_task_ids

    def test_recurring_tasks_count_toward_capacity(self):
        """Recurring tasks should count toward total capacity."""
        tasks = [
            WeeklyTaskSpec(id="regular", title="Regular", hours=35.0, priority_score=5.0),
        ]
        recurring = [
            WeeklyTaskSpec(id="weekly1", title="Weekly", hours=10.0, priority_score=8.0),
        ]
        result = optimize_weekly_selection(
            tasks=tasks, recurring_tasks=recurring, total_capacity_hours=40.0
        )
        assert result.success is True
        assert result.selected_hours <= 40.0


class TestWeeklySolverConfig:
    """Tests for weekly solver configuration."""

    def test_custom_config(self):
        """Solver should accept custom configuration."""
        config = WeeklySolverConfig(
            max_time_in_seconds=5.0,
            hours_scale=100,
        )
        tasks = [
            WeeklyTaskSpec(id="task1", title="Task 1", hours=5.0, priority_score=5.0),
        ]
        result = optimize_weekly_selection(
            tasks=tasks, total_capacity_hours=40.0, config=config
        )
        assert result.success is True


class TestWeeklySolverEdgeCases:
    """Edge case tests for weekly solver."""

    def test_insufficient_capacity(self):
        """When all tasks exceed capacity, should still return success."""
        tasks = [
            WeeklyTaskSpec(id="task1", title="Task 1", hours=50.0, priority_score=5.0),
        ]
        result = optimize_weekly_selection(tasks=tasks, total_capacity_hours=40.0)
        # Should succeed but select nothing or partial
        assert result.success is True
        assert result.selected_hours <= 40.0

    def test_exact_capacity_match(self):
        """Tasks exactly matching capacity should all be selected."""
        tasks = [
            WeeklyTaskSpec(id="task1", title="Task 1", hours=20.0, priority_score=5.0),
            WeeklyTaskSpec(id="task2", title="Task 2", hours=20.0, priority_score=5.0),
        ]
        result = optimize_weekly_selection(tasks=tasks, total_capacity_hours=40.0)
        assert result.success is True
        assert len(result.selected_task_ids) == 2
        assert result.selected_hours == 40.0
