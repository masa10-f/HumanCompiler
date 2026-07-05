"""Weekly task selection service backed by the external scheduler package."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from humancompiler_api.ai.context_collector import ContextCollector
from humancompiler_api.ai.models import TaskPlan, WeeklyPlanContext
from humancompiler_api.ai.types import ConstraintAnalysis, SolverMetrics
from humancompiler_api.models import Log, Task, TaskDependency, TaskStatus

logger = logging.getLogger(__name__)


class ProjectAllocation(BaseModel):
    """Project time allocation configuration."""

    project_id: str
    project_title: str
    target_hours: float
    max_hours: float
    priority_weight: float


class WeeklyConstraints(BaseModel):
    """Weekly constraints configuration for task selection."""

    total_capacity_hours: float = Field(40.0, description="Total weekly capacity")
    daily_max_hours: float = Field(8.0, description="Maximum daily work hours")
    deep_work_blocks: int = Field(2, description="Number of deep work blocks per day")
    meeting_buffer_hours: float = Field(
        5.0, description="Buffer for meetings and admin"
    )
    project_allocations: list[ProjectAllocation] = Field(default_factory=list)
    project_balance_weight: float = Field(
        0.7, description="Project allocation balance weight"
    )
    deadline_weight: float = Field(0.2, description="Deadline urgency weight")
    effort_efficiency_weight: float = Field(0.1, description="Effort efficiency weight")


class TaskSolverRequest(BaseModel):
    """Request for weekly task selection.

    ``user_prompt`` and ``use_ai_priority`` are accepted for backward
    compatibility with older clients, but deterministic DB priority scoring is
    always used.
    """

    week_start_date: str = Field(..., description="Week start date (YYYY-MM-DD)")
    constraints: WeeklyConstraints = Field(default_factory=WeeklyConstraints)
    project_filter: list[str] | None = Field(None, description="Filter by project IDs")
    selected_recurring_task_ids: list[str] = Field(default_factory=list)
    preferences: dict[str, Any] = Field(default_factory=dict)
    user_prompt: str | None = Field(None, description="Deprecated; ignored")
    use_ai_priority: bool = Field(default=False, description="Deprecated; ignored")


class TaskSolverResponse(BaseModel):
    """Response from weekly task selection."""

    success: bool
    week_start_date: str
    total_allocated_hours: float
    project_allocations: list[ProjectAllocation]
    selected_tasks: list[TaskPlan]
    optimization_insights: list[str]
    constraint_analysis: ConstraintAnalysis | dict[str, Any]
    solver_metrics: SolverMetrics | dict[str, Any]
    generated_at: datetime


class TaskPriorityExtractor:
    """Deterministic weekly task priority scoring."""

    def __init__(self, openai_client: Any | None = None, model: str | None = None):
        self.openai_client = None
        self.model = model

    async def extract_priorities(
        self,
        context: WeeklyPlanContext,
        user_prompt: str | None,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, float]:
        """Return deterministic priorities; ``user_prompt`` is ignored."""
        return self._fallback_priority_calculation(context, project_allocations)

    def _fallback_priority_calculation(
        self,
        context: WeeklyPlanContext,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, float]:
        priorities: dict[str, float] = {}
        remaining_hours_map = getattr(context, "remaining_hours_map", {})

        for task in context.tasks:
            user_priority = _coerce_task_priority(getattr(task, "priority", 3))
            base_priority = 10.0 - (user_priority - 1) * 2.0

            if task.due_date:
                try:
                    task_due_dt = datetime.combine(task.due_date, datetime.min.time())
                    week_start_dt = datetime.combine(
                        context.week_start_date,
                        datetime.min.time(),
                    )
                    days_until_due = (task_due_dt - week_start_dt).days
                    if days_until_due <= 3:
                        base_priority += 3.0
                    elif days_until_due <= 7:
                        base_priority += 2.0
                    elif days_until_due <= 14:
                        base_priority += 1.0
                except (TypeError, ValueError):
                    pass

            goal = next((g for g in context.goals if g.id == task.goal_id), None)
            if goal:
                allocation = next(
                    (
                        allocation
                        for allocation in project_allocations
                        if str(allocation.project_id) == str(goal.project_id)
                    ),
                    None,
                )
                if allocation:
                    base_priority += allocation.priority_weight * 10.0

            task_id = str(task.id)
            remaining_hours = remaining_hours_map.get(
                task_id,
                float(task.estimate_hours or 0),
            )
            if remaining_hours > 0:
                if remaining_hours <= 2.0:
                    base_priority += 1.0
                elif remaining_hours >= 8.0:
                    base_priority -= 0.5

            priorities[task_id] = min(10.0, max(0.0, base_priority))

        return priorities


class WeeklyTaskSolver:
    """Weekly task selection adapter for HumanCompiler data."""

    def __init__(self, openai_client: Any | None = None, model: str | None = None):
        self.openai_client = None
        self.model = model or "deterministic"
        self.context_collector = ContextCollector()
        self.priority_extractor = TaskPriorityExtractor()

    @classmethod
    async def create_for_user(cls, user_id: UUID, session: Session) -> WeeklyTaskSolver:
        """Create a deterministic solver. User API keys are no longer required."""
        return cls()

    async def solve_weekly_tasks(
        self,
        session: Session,
        user_id: str,
        request: TaskSolverRequest,
    ) -> TaskSolverResponse:
        """Solve weekly task allocation using deterministic priority + CP-SAT."""
        try:
            logger.info("Starting weekly task solving for user %s", user_id)
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

            initial_context = await self.context_collector.collect_weekly_plan_context(
                session=session,
                user_id=user_id,
                week_start_date=week_start,
                project_filter=request.project_filter,
                selected_recurring_task_ids=request.selected_recurring_task_ids,
                capacity_hours=request.constraints.total_capacity_hours,
                preferences=request.preferences,
            )

            project_allocations = self._optimize_project_allocations(
                initial_context,
                request.constraints,
            )
            context = await self._collect_solver_context(
                session,
                user_id,
                week_start,
                request,
                project_allocations,
            )
            constraint_analysis = self._analyze_constraints(
                context, request.constraints
            )
            task_priorities = self.priority_extractor._fallback_priority_calculation(
                context,
                project_allocations,
            )

            selected_tasks, optimization_insights = await self._optimize_with_ortools(
                context,
                request.constraints,
                project_allocations,
                task_priorities,
                None,
                remaining_hours_map=getattr(context, "remaining_hours_map", {}),
            )

            solver_metrics = self._calculate_solver_metrics(
                selected_tasks,
                project_allocations,
                request.constraints,
                context,
            )
            total_allocated = sum(task.estimated_hours for task in selected_tasks)

            return TaskSolverResponse(
                success=True,
                week_start_date=request.week_start_date,
                total_allocated_hours=total_allocated,
                project_allocations=project_allocations,
                selected_tasks=selected_tasks,
                optimization_insights=optimization_insights,
                constraint_analysis=constraint_analysis,
                solver_metrics=solver_metrics,
                generated_at=datetime.now(),
            )
        except Exception as exc:
            logger.error("Error in weekly task solving: %s", exc)
            return TaskSolverResponse(
                success=False,
                week_start_date=request.week_start_date,
                total_allocated_hours=0.0,
                project_allocations=[],
                selected_tasks=[],
                optimization_insights=[f"Solver error: {exc}"],
                constraint_analysis={},
                solver_metrics={},
                generated_at=datetime.now(),
            )

    def _get_task_actual_hours(
        self,
        session: Session,
        task_ids: list[str],
    ) -> dict[str, float]:
        if not task_ids:
            return {}

        try:
            task_uuids = []
            for task_id in task_ids:
                try:
                    task_uuids.append(UUID(task_id))
                except ValueError as uuid_error:
                    logger.warning(
                        "Invalid UUID format for task ID %s: %s", task_id, uuid_error
                    )

            if not task_uuids:
                return {}

            results = session.exec(
                select(Log.task_id, func.sum(Log.actual_minutes).label("total_minutes"))
                .where(Log.task_id.in_(task_uuids))
                .group_by(Log.task_id)
            ).all()

            return {
                str(task_id): float(total_minutes or 0) / 60.0
                for task_id, total_minutes in results
            }
        except Exception as exc:
            logger.error("Error getting actual hours for tasks: %s", exc)
            return {}

    def _calculate_remaining_hours_map(
        self,
        tasks: list[Task],
        actual_hours_map: dict[str, float],
    ) -> dict[str, float]:
        return {
            str(task.id): max(
                0.0,
                float(task.estimate_hours or 0)
                - actual_hours_map.get(str(task.id), 0.0),
            )
            for task in tasks
        }

    async def _collect_solver_context(
        self,
        session: Session,
        user_id: str,
        week_start,
        request: TaskSolverRequest,
        project_allocations: list[ProjectAllocation] | None = None,
    ) -> WeeklyPlanContext:
        context = await self.context_collector.collect_weekly_plan_context(
            session=session,
            user_id=user_id,
            week_start_date=week_start,
            project_filter=request.project_filter,
            selected_recurring_task_ids=request.selected_recurring_task_ids,
            capacity_hours=request.constraints.total_capacity_hours,
            preferences=request.preferences,
        )

        task_ids = [str(task.id) for task in context.tasks]
        actual_hours_map = self._get_task_actual_hours(session, task_ids)
        remaining_hours_map = self._calculate_remaining_hours_map(
            context.tasks,
            actual_hours_map,
        )
        context.remaining_hours_map = remaining_hours_map

        filtered_tasks = [
            task
            for task in context.tasks
            if remaining_hours_map.get(str(task.id), 0.0) > 0
        ]

        task_dependencies = self._collect_task_dependencies(session, filtered_tasks)
        schedulable_tasks, blocked_tasks = self._check_dependencies_schedulable_in_week(
            task_dependencies,
            filtered_tasks,
            session,
        )

        if project_allocations is None:
            project_allocations = self._optimize_project_allocations(
                context,
                request.constraints,
            )

        final_tasks = []
        zero_allocation_projects = set()
        for task in schedulable_tasks:
            goal = next((g for g in context.goals if g.id == task.goal_id), None)
            if not goal:
                final_tasks.append(task)
                continue

            allocation = next(
                (
                    allocation
                    for allocation in project_allocations
                    if str(allocation.project_id) == str(goal.project_id)
                ),
                None,
            )
            if allocation and allocation.target_hours <= 0.001:
                zero_allocation_projects.add(goal.project_id)
                continue
            final_tasks.append(task)

        context.tasks = final_tasks
        logger.info(
            "Context filtering: %s final tasks, %s blocked by dependencies, %s zero-allocation projects",
            len(final_tasks),
            len(blocked_tasks),
            len(zero_allocation_projects),
        )
        return context

    def _collect_task_dependencies(
        self,
        session: Session,
        tasks: list[Task],
    ) -> dict[str, list[str]]:
        task_ids = [task.id for task in tasks]
        if not task_ids:
            return {}

        try:
            dependencies = session.exec(
                select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))
            ).all()
        except Exception as exc:
            logger.error("Error collecting task dependencies: %s", exc)
            return {}

        dependency_map: dict[str, list[str]] = {}
        for dep in dependencies:
            dependency_map.setdefault(str(dep.task_id), []).append(
                str(dep.depends_on_task_id),
            )
        return dependency_map

    def _check_dependencies_schedulable_in_week(
        self,
        task_dependencies: dict[str, list[str]],
        available_tasks: list[Task],
        session: Session,
    ) -> tuple[list[Task], list[Task]]:
        available_task_ids = {str(task.id) for task in available_tasks}
        schedulable_tasks = []
        blocked_tasks = []

        for task in available_tasks:
            task_id = str(task.id)
            dependencies = task_dependencies.get(task_id, [])
            if not dependencies:
                schedulable_tasks.append(task)
                continue

            all_deps_satisfiable = True
            for dep_task_id in dependencies:
                if dep_task_id in available_task_ids:
                    continue

                try:
                    dep_task = session.get(Task, UUID(dep_task_id))
                    if dep_task and dep_task.status in {
                        TaskStatus.COMPLETED,
                        "completed",
                        "done",
                        "finished",
                    }:
                        continue
                except Exception as exc:
                    logger.warning(
                        "Could not check dependency task %s: %s", dep_task_id, exc
                    )

                all_deps_satisfiable = False
                break

            if all_deps_satisfiable:
                schedulable_tasks.append(task)
            else:
                blocked_tasks.append(task)

        return schedulable_tasks, blocked_tasks

    def _analyze_constraints(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
    ) -> ConstraintAnalysis:
        remaining_hours_map = getattr(context, "remaining_hours_map", {})
        total_task_hours = sum(
            remaining_hours_map.get(str(task.id), float(task.estimate_hours or 0))
            for task in context.tasks
        )
        available_hours = (
            constraints.total_capacity_hours - constraints.meeting_buffer_hours
        )

        week_start_dt = datetime.combine(context.week_start_date, datetime.min.time())
        week_end_dt = week_start_dt + timedelta(days=7)
        urgent_count = 0
        for task in context.tasks:
            if task.due_date:
                due_dt = (
                    task.due_date
                    if hasattr(task.due_date, "hour")
                    else datetime.combine(task.due_date, datetime.min.time())
                )
                if due_dt <= week_end_dt:
                    urgent_count += 1

        return {
            "total_task_hours": total_task_hours,
            "available_hours": available_hours,
            "capacity_utilization": min(total_task_hours / available_hours, 1.0)
            if available_hours > 0
            else 0,
            "urgent_task_count": urgent_count,
            "project_count": len(context.projects),
            "overload_risk": total_task_hours > constraints.total_capacity_hours,
        }

    def _optimize_project_allocations(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
    ) -> list[ProjectAllocation]:
        if constraints.project_allocations:
            return constraints.project_allocations

        available_hours = (
            constraints.total_capacity_hours - constraints.meeting_buffer_hours
        )
        project_count = len(context.projects)
        if project_count == 0:
            return []

        remaining_hours_map = getattr(context, "remaining_hours_map", {})
        project_priorities = {}
        for project in context.projects:
            project_tasks = [
                task
                for task in context.tasks
                if any(
                    goal.project_id == project.id
                    for goal in context.goals
                    if goal.id == task.goal_id
                )
            ]

            week_start_dt = datetime.combine(
                context.week_start_date, datetime.min.time()
            )
            week_end_dt = week_start_dt + timedelta(days=7)
            urgent_count = 0
            for task in project_tasks:
                if task.due_date:
                    due_dt = (
                        task.due_date
                        if hasattr(task.due_date, "hour")
                        else datetime.combine(task.due_date, datetime.min.time())
                    )
                    if due_dt <= week_end_dt:
                        urgent_count += 1

            total_hours = sum(
                remaining_hours_map.get(str(task.id), float(task.estimate_hours or 0))
                for task in project_tasks
            )
            project_priorities[project.id] = urgent_count * 2.0 + total_hours * 0.1

        total_priority = sum(project_priorities.values())
        if total_priority == 0:
            base_hours = float(available_hours) / project_count
            return [
                ProjectAllocation(
                    project_id=str(project.id),
                    project_title=project.title,
                    target_hours=base_hours,
                    max_hours=base_hours * 1.5,
                    priority_weight=1.0,
                )
                for project in context.projects
            ]

        allocations = []
        for project in context.projects:
            priority_ratio = project_priorities[project.id] / total_priority
            target_hours = float(available_hours) * priority_ratio
            allocations.append(
                ProjectAllocation(
                    project_id=str(project.id),
                    project_title=project.title,
                    target_hours=target_hours,
                    max_hours=target_hours * 1.5,
                    priority_weight=priority_ratio,
                )
            )
        return allocations

    def _heuristic_task_selection(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
        remaining_hours_map: dict[str, float] | None = None,
    ) -> tuple[list[TaskPlan], list[str]]:
        remaining_hours_map = remaining_hours_map or getattr(
            context, "remaining_hours_map", {}
        )
        priorities = self.priority_extractor._fallback_priority_calculation(
            context,
            project_allocations,
        )

        scored_items: list[tuple[Any, float, str]] = []
        for task in context.tasks:
            scored_items.append(
                (task, priorities.get(str(task.id), 5.0), "regular_task")
            )

        selected_recurring_ids = set(context.selected_recurring_task_ids or [])
        for weekly_task in context.weekly_recurring_tasks:
            if str(weekly_task.id) in selected_recurring_ids:
                scored_items.append((weekly_task, 8.0, "weekly_recurring"))

        scored_items.sort(key=lambda item: item[1], reverse=True)

        selected_tasks = []
        total_hours = 0.0
        for item, score, item_type in scored_items:
            item_id = str(item.id)
            item_hours = (
                remaining_hours_map.get(item_id, float(item.estimate_hours or 0))
                if item_type == "regular_task"
                else float(item.estimate_hours or 0)
            )
            if total_hours + item_hours > constraints.total_capacity_hours:
                continue

            selected_tasks.append(
                TaskPlan(
                    task_id=item_id,
                    task_title=item.title
                    if item_type == "regular_task"
                    else f"[週課] {item.title}",
                    estimated_hours=item_hours,
                    priority=int(score),
                    rationale=f"Selected based on deterministic score: {score:.1f}",
                )
            )
            total_hours += item_hours

        return selected_tasks, ["Using deterministic heuristic task selection"]

    def _calculate_solver_metrics(
        self,
        selected_tasks: list[TaskPlan],
        project_allocations: list[ProjectAllocation],
        constraints: WeeklyConstraints,
        context: WeeklyPlanContext,
    ) -> SolverMetrics:
        total_allocated = sum(task.estimated_hours for task in selected_tasks)
        capacity_utilization = (
            total_allocated / constraints.total_capacity_hours
            if constraints.total_capacity_hours
            else 0.0
        )

        task_to_project = {}
        for task in context.tasks:
            for goal in context.goals:
                if goal.id == task.goal_id:
                    task_to_project[str(task.id)] = goal.project_id
                    break

        project_hours = {}
        for task in selected_tasks:
            project_id = task_to_project.get(task.task_id, "unassigned")
            project_hours[project_id] = (
                project_hours.get(project_id, 0.0) + task.estimated_hours
            )

        if len(project_hours) <= 1:
            balance_score = 1.0 if project_hours else 0.0
        else:
            total_project_hours = sum(project_hours.values())
            expected_hours = total_project_hours / len(project_hours)
            variance = sum(
                (hours - expected_hours) ** 2 for hours in project_hours.values()
            ) / len(project_hours)
            balance_score = max(0.0, 1.0 - (variance / (expected_hours**2)))

        return {
            "capacity_utilization": capacity_utilization,
            "project_balance_score": balance_score,
            "task_count": len(selected_tasks),
            "avg_task_hours": total_allocated / len(selected_tasks)
            if selected_tasks
            else 0,
            "projects_involved": len(project_hours),
            "project_distribution": project_hours,
        }

    async def _optimize_with_ortools(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
        task_priorities: dict[str, float],
        user_prompt: str | None,
        remaining_hours_map: dict[str, float] | None = None,
    ) -> tuple[list[TaskPlan], list[str]]:
        try:
            (
                ProjectAllocationSpec,
                WeeklySolverConfig,
                WeeklyTaskSpec,
                optimize_weekly_selection,
                backend_name,
            ) = _load_weekly_scheduler_backend()

            remaining_hours_map = remaining_hours_map or getattr(
                context,
                "remaining_hours_map",
                {},
            )
            goal_to_project_id = {
                str(goal.id): str(goal.project_id) for goal in context.goals
            }

            solver_tasks = []
            task_hours: dict[str, float] = {}
            task_priority_scores: dict[str, float] = {}
            for task in context.tasks:
                task_id = str(task.id)
                hours = remaining_hours_map.get(
                    task_id,
                    float(task.estimate_hours or 0),
                )
                priority_score = task_priorities.get(task_id, 5.0)
                project_id = (
                    goal_to_project_id.get(str(task.goal_id))
                    if getattr(task, "goal_id", None)
                    else None
                )
                solver_tasks.append(
                    WeeklyTaskSpec(
                        id=task_id,
                        title=task.title,
                        hours=hours,
                        priority_score=priority_score,
                        project_id=project_id,
                    )
                )
                task_hours[task_id] = hours
                task_priority_scores[task_id] = priority_score

            recurring_solver_tasks = []
            recurring_hours: dict[str, float] = {}
            selected_recurring_ids = set(context.selected_recurring_task_ids or [])
            for weekly_task in context.weekly_recurring_tasks:
                weekly_id = str(weekly_task.id)
                if weekly_id not in selected_recurring_ids:
                    continue
                hours = float(weekly_task.estimate_hours or 0)
                recurring_solver_tasks.append(
                    WeeklyTaskSpec(
                        id=weekly_id,
                        title=weekly_task.title,
                        hours=hours,
                        priority_score=8.0,
                        project_id=None,
                    )
                )
                recurring_hours[weekly_id] = hours

            allocation_specs = [
                ProjectAllocationSpec(
                    project_id=str(allocation.project_id),
                    project_title=allocation.project_title,
                    target_hours=float(allocation.target_hours),
                    max_hours=float(allocation.max_hours),
                    priority_weight=float(allocation.priority_weight),
                )
                for allocation in project_allocations
            ]

            solve_result = optimize_weekly_selection(
                tasks=solver_tasks,
                recurring_tasks=recurring_solver_tasks,
                project_allocations=allocation_specs,
                total_capacity_hours=float(constraints.total_capacity_hours),
                config=WeeklySolverConfig(max_time_in_seconds=30.0),
            )

            if not solve_result.success:
                selected_tasks, fallback_insights = self._heuristic_task_selection(
                    context,
                    constraints,
                    project_allocations,
                    remaining_hours_map=remaining_hours_map,
                )
                return selected_tasks, [
                    "OR-Tools optimization could not satisfy constraints",
                    *fallback_insights,
                ]

            task_by_id = {str(task.id): task for task in context.tasks}
            weekly_by_id = {
                str(task.id): task for task in context.weekly_recurring_tasks
            }

            selected_tasks = []
            for task_id in solve_result.selected_task_ids:
                db_task = task_by_id.get(task_id)
                if not db_task:
                    continue
                selected_tasks.append(
                    TaskPlan(
                        task_id=task_id,
                        task_title=db_task.title,
                        estimated_hours=task_hours[task_id],
                        priority=int(task_priority_scores[task_id]),
                        rationale=(
                            "External weekly scheduler selected this task "
                            f"(priority: {task_priority_scores[task_id]:.1f})"
                        ),
                    )
                )

            for weekly_id in solve_result.selected_recurring_task_ids:
                weekly_task = weekly_by_id.get(weekly_id)
                if not weekly_task:
                    continue
                selected_tasks.append(
                    TaskPlan(
                        task_id=weekly_id,
                        task_title=f"[週課] {weekly_task.title}",
                        estimated_hours=recurring_hours.get(
                            weekly_id,
                            float(weekly_task.estimate_hours or 0),
                        ),
                        priority=8,
                        rationale="External weekly scheduler selected this recurring task",
                    )
                )

            total_selected_hours = sum(task.estimated_hours for task in selected_tasks)
            capacity_utilization = (
                total_selected_hours / constraints.total_capacity_hours
                if constraints.total_capacity_hours
                else 0.0
            )
            status_label = "optimal" if solve_result.status == "OPTIMAL" else "feasible"

            insights = [
                f"{backend_name} OR-Tools weekly selection completed",
                f"Selected tasks: {len(selected_tasks)}",
                f"Total hours: {total_selected_hours:.1f}h (capacity utilization: {capacity_utilization:.1%})",
                f"Optimization status: {status_label}",
            ]
            return selected_tasks, insights

        except Exception as exc:
            logger.error("Weekly optimization failed: %s", exc)
            selected_tasks, fallback_insights = self._heuristic_task_selection(
                context,
                constraints,
                project_allocations,
                remaining_hours_map=getattr(context, "remaining_hours_map", {}),
            )
            return selected_tasks, [
                f"Weekly optimization failed: {exc}",
                *fallback_insights,
            ]


def _load_weekly_scheduler_backend():
    try:
        from humancompiler_scheduler.human import (
            ProjectAllocationSpec,
            WeeklySolverConfig,
            WeeklyTaskSpec,
            optimize_weekly_selection,
        )

        return (
            ProjectAllocationSpec,
            WeeklySolverConfig,
            WeeklyTaskSpec,
            optimize_weekly_selection,
            "External humancompiler-scheduler",
        )
    except ImportError:
        from humancompiler_optimizer.weekly import (
            ProjectAllocationSpec,
            WeeklySolverConfig,
            WeeklyTaskSpec,
            optimize_weekly_selection,
        )

        return (
            ProjectAllocationSpec,
            WeeklySolverConfig,
            WeeklyTaskSpec,
            optimize_weekly_selection,
            "Internal compatibility weekly scheduler",
        )


def _coerce_task_priority(value: Any) -> int:
    try:
        priority = int(value)
    except (TypeError, ValueError):
        priority = 3
    return min(5, max(1, priority))
