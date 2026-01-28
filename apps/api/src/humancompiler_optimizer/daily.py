from __future__ import annotations

import math
import time as time_module
from dataclasses import dataclass, field
from datetime import datetime, time
from enum import Enum
from collections.abc import Mapping, Sequence
from typing import Any

from ortools.sat.python import cp_model


class WorkKind(Enum):
    """Common enum for task and slot work types.

    This enum represents the type of work, used for both tasks and time slots.
    Matching task kind with slot kind improves scheduling quality.
    """

    LIGHT_WORK = "light_work"
    FOCUSED_WORK = "focused_work"
    STUDY = "study"


# Aliases for backward compatibility and semantic clarity
TaskKind = WorkKind
SlotKind = WorkKind


@dataclass
class SchedulerTask:
    id: str
    title: str
    estimate_hours: float
    priority: int = 1
    due_date: datetime | None = None
    kind: TaskKind = TaskKind.LIGHT_WORK
    goal_id: str | None = None
    is_weekly_recurring: bool = False
    actual_hours: float = 0.0
    project_id: str | None = None

    @property
    def remaining_hours(self) -> float:
        remaining = self.estimate_hours - self.actual_hours
        return max(0.0, remaining)


@dataclass
class TimeSlot:
    start: time
    end: time
    kind: SlotKind
    capacity_hours: float | None = None
    assigned_project_id: str | None = None


@dataclass
class FixedAssignment:
    """User-defined fixed task assignment."""

    task_id: str
    slot_index: int
    duration_hours: float | None = None  # None means use task's remaining hours


@dataclass
class Assignment:
    task_id: str
    slot_index: int
    start_time: time
    duration_hours: float
    is_fixed: bool = False  # Whether this was a user-defined fixed assignment


@dataclass
class ScheduleResult:
    success: bool
    assignments: list[Assignment] = field(default_factory=list)
    unscheduled_tasks: list[str] = field(default_factory=list)
    total_scheduled_hours: float = 0.0
    optimization_status: str = "UNKNOWN"
    solve_time_seconds: float = 0.0
    objective_value: float = 0.0


@dataclass(frozen=True)
class DailySolverConfig:
    max_time_in_seconds: float = 5.0
    log_search_progress: bool = False
    kind_match_score: int = 10
    kind_mismatch_score: int = 1
    priority_score_base: int = 10
    deadline_score_base: int = 10
    min_score: int = 1


def optimize_daily_schedule(
    tasks: Sequence[SchedulerTask],
    time_slots: Sequence[TimeSlot],
    *,
    date: datetime | None = None,
    task_dependencies: Mapping[str, Sequence[str]] | None = None,
    goal_dependencies: Mapping[str, Sequence[str]] | None = None,
    config: DailySolverConfig | None = None,
    fixed_assignments: Sequence[FixedAssignment] | None = None,
) -> ScheduleResult:
    start_time = time_module.time()
    if config is None:
        config = DailySolverConfig()

    if not tasks or not time_slots:
        return ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=[task.id for task in tasks] if tasks else [],
            total_scheduled_hours=0.0,
            optimization_status="NO_TASKS_OR_SLOTS",
            solve_time_seconds=time_module.time() - start_time,
        )

    model = cp_model.CpModel()

    # Calculate slot capacities in minutes for better precision
    slot_capacities: list[float] = []
    for slot in time_slots:
        slot_duration = (
            datetime.combine(datetime.today(), slot.end)
            - datetime.combine(datetime.today(), slot.start)
        ).total_seconds() / 60
        capacity = (
            slot.capacity_hours * 60
            if slot.capacity_hours is not None
            else slot_duration
        )
        slot_capacities.append(min(capacity, slot_duration))

    # Build task ID to index mapping
    task_id_to_index = {task.id: i for i, task in enumerate(tasks)}

    # Process fixed assignments
    fixed_assignments = fixed_assignments or []
    fixed_task_slot_map: dict[int, int] = {}  # task_index -> slot_index
    fixed_durations: dict[int, float] = {}  # task_index -> duration_minutes
    reserved_capacity: dict[int, float] = dict.fromkeys(range(len(time_slots)), 0.0)

    for fa in fixed_assignments:
        task_idx = task_id_to_index.get(fa.task_id)
        if task_idx is None:
            continue  # Skip if task not found
        if fa.slot_index < 0 or fa.slot_index >= len(time_slots):
            continue  # Skip invalid slot index

        task = tasks[task_idx]
        # Determine duration: use specified duration or task's remaining hours
        if fa.duration_hours is not None:
            duration_minutes = fa.duration_hours * 60
        else:
            duration_minutes = task.remaining_hours * 60

        # Clamp duration to slot capacity
        available_capacity = (
            slot_capacities[fa.slot_index] - reserved_capacity[fa.slot_index]
        )
        duration_minutes = min(duration_minutes, available_capacity)

        if duration_minutes > 0:
            fixed_task_slot_map[task_idx] = fa.slot_index
            fixed_durations[task_idx] = duration_minutes
            reserved_capacity[fa.slot_index] += duration_minutes

    # Convert task remaining hours to minutes for optimization
    task_durations = [math.ceil(task.remaining_hours * 60) for task in tasks]

    # Decision variables: x[i][j] = 1 if task i is assigned to slot j
    x: dict[tuple[int, int], Any] = {}
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            x[i, j] = model.NewBoolVar(f"task_{i}_slot_{j}")

    # Variable for actual assigned duration (in minutes)
    assigned_durations: dict[tuple[int, int], Any] = {}
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            max_duration = min(task_durations[i], int(slot_capacities[j]))
            assigned_durations[i, j] = model.NewIntVar(
                0, max_duration, f"duration_{i}_{j}"
            )

            if max_duration >= 1:
                model.Add(assigned_durations[i, j] >= 1).OnlyEnforceIf(x[i, j])
            model.Add(assigned_durations[i, j] == 0).OnlyEnforceIf(x[i, j].Not())

    # Constraint 0: Fixed assignments - these tasks MUST be assigned to their specified slots
    for task_idx, slot_idx in fixed_task_slot_map.items():
        # Force assignment to the specified slot
        model.Add(x[task_idx, slot_idx] == 1)
        # Prevent assignment to other slots
        for other_slot in range(len(time_slots)):
            if other_slot != slot_idx:
                model.Add(x[task_idx, other_slot] == 0)
        # Set the fixed duration
        fixed_duration = int(fixed_durations[task_idx])
        model.Add(assigned_durations[task_idx, slot_idx] == fixed_duration)

    # Constraint 1: Each task is assigned to at most one slot
    for i, _task in enumerate(tasks):
        model.Add(sum(x[i, j] for j in range(len(time_slots))) <= 1)

    # Constraint 2: Slot capacity constraints
    for j, _slot in enumerate(time_slots):
        model.Add(
            sum(assigned_durations[i, j] for i in range(len(tasks)))
            <= int(slot_capacities[j])
        )

    # Constraint 3: Dependency ordering constraints (soft requirement; only if both are scheduled)
    if task_dependencies:
        task_id_to_index = {task.id: i for i, task in enumerate(tasks)}
        for task_id, prerequisite_task_ids in task_dependencies.items():
            task_idx = task_id_to_index.get(task_id)
            if task_idx is None:
                continue
            for prerequisite_id in prerequisite_task_ids:
                prerequisite_idx = task_id_to_index.get(prerequisite_id)
                if prerequisite_idx is None:
                    continue
                for j in range(len(time_slots)):
                    for k in range(j + 1, len(time_slots)):
                        model.Add(x[task_idx, j] + x[prerequisite_idx, k] <= 1)

    if goal_dependencies:
        goal_to_task_indices: dict[str, list[int]] = {}
        for i, task in enumerate(tasks):
            if task.goal_id and not task.is_weekly_recurring:
                goal_to_task_indices.setdefault(task.goal_id, []).append(i)

        for goal_id, prerequisite_goal_ids in goal_dependencies.items():
            dependent_task_indices = goal_to_task_indices.get(goal_id)
            if not dependent_task_indices:
                continue
            for prerequisite_goal_id in prerequisite_goal_ids:
                prerequisite_task_indices = goal_to_task_indices.get(
                    prerequisite_goal_id
                )
                if not prerequisite_task_indices:
                    continue
                for dependent_task_idx in dependent_task_indices:
                    for prerequisite_task_idx in prerequisite_task_indices:
                        for j in range(len(time_slots)):
                            for k in range(j + 1, len(time_slots)):
                                model.Add(
                                    x[dependent_task_idx, j]
                                    + x[prerequisite_task_idx, k]
                                    <= 1
                                )

    # Constraint 4.5: Slot-specific project assignment constraints
    for j, slot in enumerate(time_slots):
        if not slot.assigned_project_id:
            continue
        for i, task in enumerate(tasks):
            if task.is_weekly_recurring:
                continue
            if task.project_id != slot.assigned_project_id:
                model.Add(x[i, j] == 0)

    # Soft constraints / objective components
    kind_match_bonus: dict[tuple[int, int], int] = {}
    for i, task in enumerate(tasks):
        for j, slot in enumerate(time_slots):
            kind_match_bonus[i, j] = (
                config.kind_match_score
                if task.kind.value == slot.kind.value
                else config.kind_mismatch_score
            )

    priority_weights: dict[int, int] = {}
    for i, task in enumerate(tasks):
        priority_weights[i] = max(
            config.min_score, config.priority_score_base - task.priority
        )

    deadline_bonus: dict[tuple[int, int], int] = {}
    if date:
        schedule_date = date
        for i, task in enumerate(tasks):
            for j, _slot in enumerate(time_slots):
                if task.due_date:
                    days_until_due = (task.due_date.date() - schedule_date.date()).days
                    deadline_bonus[i, j] = (
                        max(
                            config.min_score,
                            config.deadline_score_base - days_until_due,
                        )
                        if days_until_due >= 0
                        else config.min_score
                    )
                else:
                    deadline_bonus[i, j] = config.min_score
    else:
        for i, _task in enumerate(tasks):
            for j, _slot in enumerate(time_slots):
                deadline_bonus[i, j] = config.min_score

    objective_terms = []
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            weight = priority_weights[i] * kind_match_bonus[i, j] * deadline_bonus[i, j]
            objective_terms.append(assigned_durations[i, j] * weight)

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(config.max_time_in_seconds)
    solver.parameters.log_search_progress = bool(config.log_search_progress)

    status = solver.Solve(model)
    solve_time = time_module.time() - start_time

    assignments: list[Assignment] = []
    unscheduled_tasks: list[str] = []
    total_scheduled_minutes = 0

    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        for i, task in enumerate(tasks):
            assigned = False
            for j, slot in enumerate(time_slots):
                if solver.Value(x[i, j]) == 1:
                    duration_minutes = solver.Value(assigned_durations[i, j])
                    # Check if this was a fixed assignment
                    is_fixed = i in fixed_task_slot_map and fixed_task_slot_map[i] == j
                    assignments.append(
                        Assignment(
                            task_id=task.id,
                            slot_index=j,
                            start_time=slot.start,
                            duration_hours=duration_minutes / 60.0,
                            is_fixed=is_fixed,
                        )
                    )
                    total_scheduled_minutes += duration_minutes
                    assigned = True
                    break
            if not assigned:
                unscheduled_tasks.append(task.id)

        optimization_status = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
        success = True
        objective_value = float(solver.ObjectiveValue())
    else:
        unscheduled_tasks = [task.id for task in tasks]
        optimization_status = (
            "INFEASIBLE" if status == cp_model.INFEASIBLE else "UNKNOWN"
        )
        success = False
        objective_value = 0.0

    return ScheduleResult(
        success=success,
        assignments=assignments,
        unscheduled_tasks=unscheduled_tasks,
        total_scheduled_hours=total_scheduled_minutes / 60.0,
        optimization_status=optimization_status,
        solve_time_seconds=solve_time,
        objective_value=objective_value,
    )
