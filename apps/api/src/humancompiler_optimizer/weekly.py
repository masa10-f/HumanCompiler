from __future__ import annotations

import time as time_module
from dataclasses import dataclass, field
from collections.abc import Sequence


@dataclass(frozen=True)
class WeeklyTaskSpec:
    id: str
    title: str
    hours: float
    priority_score: float
    project_id: str | None = None


@dataclass(frozen=True)
class ProjectAllocationSpec:
    project_id: str
    target_hours: float
    max_hours: float = 0.0
    priority_weight: float = 0.0
    project_title: str | None = None


@dataclass(frozen=True)
class WeeklySolverConfig:
    max_time_in_seconds: float = 30.0
    hours_scale: int = 10
    priority_scale: int = 100
    project_bonus_scale: int = 1000
    zero_allocation_epsilon: float = 0.001
    ideal_min_factor: float = 0.95
    ideal_max_factor: float = 1.05


@dataclass
class WeeklySelectionResult:
    success: bool
    status: str = "UNKNOWN"
    selected_task_ids: list[str] = field(default_factory=list)
    selected_recurring_task_ids: list[str] = field(default_factory=list)
    selected_hours: float = 0.0
    selected_hours_by_project: dict[str, float] = field(default_factory=dict)
    solve_time_seconds: float = 0.0
    objective_value: float = 0.0


def _import_cp_model():
    from ortools.sat.python import cp_model

    return cp_model


def optimize_weekly_selection(
    *,
    tasks: Sequence[WeeklyTaskSpec],
    recurring_tasks: Sequence[WeeklyTaskSpec] = (),
    project_allocations: Sequence[ProjectAllocationSpec] = (),
    total_capacity_hours: float,
    config: WeeklySolverConfig | None = None,
) -> WeeklySelectionResult:
    start_time = time_module.time()
    if config is None:
        config = WeeklySolverConfig()

    cp_model = _import_cp_model()
    model = cp_model.CpModel()
    solver = cp_model.CpSolver()

    hours_scale = int(config.hours_scale)
    priority_scale = int(config.priority_scale)
    project_bonus_scale = int(config.project_bonus_scale)

    # Decision variables
    task_vars = {t.id: model.NewBoolVar(f"task_{t.id}") for t in tasks}
    recurring_vars = {t.id: model.NewBoolVar(f"weekly_{t.id}") for t in recurring_tasks}

    # Constraint 1: Total capacity constraint
    total_hours_expr = []
    for task in tasks:
        total_hours_expr.append(task_vars[task.id] * int(task.hours * hours_scale))
    for task in recurring_tasks:
        total_hours_expr.append(recurring_vars[task.id] * int(task.hours * hours_scale))
    model.Add(sum(total_hours_expr) <= int(total_capacity_hours * hours_scale))

    # Constraint 2: Project allocation constraints
    tasks_by_project: dict[str, list[WeeklyTaskSpec]] = {}
    for task in tasks:
        if task.project_id:
            tasks_by_project.setdefault(task.project_id, []).append(task)

    for allocation in project_allocations:
        project_tasks = tasks_by_project.get(allocation.project_id, [])
        if not project_tasks:
            continue

        project_terms = [
            task_vars[t.id] * int(t.hours * hours_scale) for t in project_tasks
        ]
        available_task_hours = sum(t.hours for t in project_tasks)

        if allocation.target_hours <= config.zero_allocation_epsilon:
            model.Add(sum(project_terms) <= 0)
            continue

        ideal_min_hours = int(
            allocation.target_hours * config.ideal_min_factor * hours_scale
        )
        ideal_max_hours = int(
            allocation.target_hours * config.ideal_max_factor * hours_scale
        )

        if available_task_hours * hours_scale < ideal_min_hours:
            hard_min_hours = int(available_task_hours * hours_scale)
            max_hours = int(available_task_hours * hours_scale)
        else:
            hard_min_hours = ideal_min_hours
            max_hours = min(ideal_max_hours, int(available_task_hours * hours_scale))

        if max_hours > 0:
            model.Add(sum(project_terms) >= hard_min_hours)
            model.Add(sum(project_terms) <= max_hours)

    # Objective: Maximize priority-weighted task selection
    allocation_by_project = {a.project_id: a for a in project_allocations}
    priority_expr = []

    for task in tasks:
        base_priority = int(task.priority_score * priority_scale)
        bonus = 0
        if task.project_id:
            allocation = allocation_by_project.get(task.project_id)
            if allocation:
                bonus = int(allocation.priority_weight * project_bonus_scale)
        priority_expr.append(task_vars[task.id] * (base_priority + bonus))

    for task in recurring_tasks:
        priority_expr.append(
            recurring_vars[task.id] * int(task.priority_score * priority_scale)
        )

    model.Maximize(sum(priority_expr))

    solver.parameters.max_time_in_seconds = float(config.max_time_in_seconds)

    status = solver.Solve(model)
    solve_time = time_module.time() - start_time

    if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        return WeeklySelectionResult(
            success=False,
            status="INFEASIBLE" if status == cp_model.INFEASIBLE else "UNKNOWN",
            selected_task_ids=[],
            selected_recurring_task_ids=[],
            selected_hours=0.0,
            selected_hours_by_project={},
            solve_time_seconds=solve_time,
            objective_value=0.0,
        )

    selected_task_ids = [t.id for t in tasks if solver.Value(task_vars[t.id]) == 1]
    selected_recurring_ids = [
        t.id for t in recurring_tasks if solver.Value(recurring_vars[t.id]) == 1
    ]

    selected_hours = 0.0
    selected_hours_by_project: dict[str, float] = {}
    task_by_id = {t.id: t for t in tasks}

    for task_id in selected_task_ids:
        task = task_by_id[task_id]
        selected_hours += task.hours
        if task.project_id:
            selected_hours_by_project[task.project_id] = (
                selected_hours_by_project.get(task.project_id, 0.0) + task.hours
            )

    for task_id in selected_recurring_ids:
        task = next((t for t in recurring_tasks if t.id == task_id), None)
        if task:
            selected_hours += task.hours

    return WeeklySelectionResult(
        success=True,
        status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        selected_task_ids=selected_task_ids,
        selected_recurring_task_ids=selected_recurring_ids,
        selected_hours=selected_hours,
        selected_hours_by_project=selected_hours_by_project,
        solve_time_seconds=solve_time,
        objective_value=float(solver.ObjectiveValue()),
    )
