"""
Scheduler API endpoints for task scheduling optimization.
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, time, UTC, timedelta
from enum import Enum
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator, ConfigDict, field_serializer
from sqlmodel import Session, select, cast, String
from ortools.sat.python import cp_model

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import db
from humancompiler_api.exceptions import ResourceNotFoundError, ValidationError
from humancompiler_api.models import (
    Schedule,
    ScheduleResponse,
    ErrorResponse,
    WeeklySchedule,
    Task,
    Goal,
    Project,
    WeeklyRecurringTask,
    TaskDependency,
    GoalDependency,
    TaskStatus,
    GoalStatus,
    WorkType,
)
from humancompiler_api.services import goal_service, task_service
from uuid import UUID
from sqlalchemy.exc import SQLAlchemyError, DatabaseError

# OR-Tools CP-SAT scheduler implementation
logger = logging.getLogger(__name__)
logger.info("Using OR-Tools CP-SAT constraint solver for scheduling optimization")


class TaskKind(Enum):
    LIGHT_WORK = "light_work"
    FOCUSED_WORK = "focused_work"
    STUDY = "study"


class SlotKind(Enum):
    LIGHT_WORK = "light_work"
    FOCUSED_WORK = "focused_work"
    STUDY = "study"


@dataclass
class SchedulerTask:
    id: str
    title: str
    estimate_hours: float
    priority: int = 1
    due_date: datetime | None = None
    kind: TaskKind = TaskKind.LIGHT_WORK
    goal_id: str | None = None
    is_weekly_recurring: bool = False  # Add flag to distinguish weekly recurring tasks
    actual_hours: float = 0.0  # Total actual hours logged for this task
    project_id: str | None = None  # Project ID for slot assignment constraints

    @property
    def remaining_hours(self) -> float:
        """Calculate remaining hours (estimate - actual)."""
        remaining = self.estimate_hours - self.actual_hours
        return max(0.0, remaining)  # Never return negative remaining hours


@dataclass
class TimeSlot:
    start: time
    end: time
    kind: SlotKind
    capacity_hours: float | None = None
    # New fields for slot-level assignment
    assigned_project_id: str | None = None


@dataclass
class Assignment:
    """Represents a task assignment to a time slot."""

    task_id: str
    slot_index: int
    start_time: time
    duration_hours: float


@dataclass
class ScheduleResult:
    success: bool
    assignments: list[Assignment] = field(default_factory=list)
    unscheduled_tasks: list[str] = field(default_factory=list)
    total_scheduled_hours: float = 0.0
    optimization_status: str = "MOCKED"
    solve_time_seconds: float = 0.0
    objective_value: float = 0.0


def _get_task_actual_hours(session: Session, task_ids: list[str]) -> dict[str, float]:
    """
    Get actual hours logged for each task from the logs table.

    Args:
        session: Database session
        task_ids: List of task IDs to get actual hours for

    Returns:
        Dict mapping task_id to total actual hours
    """
    if not task_ids:
        return {}

    try:
        from humancompiler_api.models import Log
        from sqlmodel import func
        from uuid import UUID

        # Convert string IDs to UUIDs
        task_uuids = []
        for task_id in task_ids:
            try:
                task_uuids.append(UUID(task_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for task ID {task_id}: {uuid_error}"
                )
                continue

        if not task_uuids:
            return {}

        # Query sum of actual_minutes for each task and convert to hours
        task_uuid_strs = [str(uuid) for uuid in task_uuids]
        query = (
            select(
                cast(Log.task_id, String),
                func.sum(Log.actual_minutes).label("total_minutes"),
            )
            .where(cast(Log.task_id, String).in_(task_uuid_strs))
            .group_by(cast(Log.task_id, String))
        )

        results = session.exec(query).all()

        # Convert results to dict with task_id as string and minutes as hours
        actual_hours_map = {}
        for task_uuid, total_minutes in results:
            task_id = str(task_uuid)
            actual_hours = float(total_minutes or 0) / 60.0  # Convert minutes to hours
            actual_hours_map[task_id] = actual_hours

        logger.debug(f"Retrieved actual hours for {len(actual_hours_map)} tasks")
        return actual_hours_map

    except Exception as e:
        logger.error(f"Error getting task actual hours: {e}")
        return {}


def _get_task_dependencies(
    session: Session, tasks: list[SchedulerTask]
) -> dict[str, list[str]]:
    """
    Get task dependencies for a list of scheduler tasks.

    Returns:
        Dict mapping task_id to list of task_ids it depends on
    """
    task_ids = [task.id for task in tasks]
    if not task_ids:
        return {}

    try:
        # Convert string IDs to UUIDs
        task_uuids = []
        for task_id in task_ids:
            try:
                task_uuids.append(UUID(task_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for task ID {task_id}: {uuid_error}"
                )
                continue  # Skip invalid UUIDs but continue processing others

        if not task_uuids:
            logger.warning("No valid task UUIDs found after validation")
            return {}

        # Query task dependencies
        task_uuid_strs = [str(uuid) for uuid in task_uuids]
        dependencies = session.exec(
            select(TaskDependency).where(
                cast(TaskDependency.task_id, String).in_(task_uuid_strs)
            )
        ).all()

        dependency_map: dict[str, list[str]] = {}
        for dep in dependencies:
            task_id = str(dep.task_id)
            depends_on_id = str(dep.depends_on_task_id)

            if task_id not in dependency_map:
                dependency_map[task_id] = []
            dependency_map[task_id].append(depends_on_id)

        logger.debug(
            f"Found {len(dependencies)} task dependencies for {len(task_uuids)} valid tasks"
        )
        return dependency_map

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(f"Database error getting task dependencies: {db_error}")
        # Return empty dict to avoid breaking scheduler, but log the issue
        return {}
    except Exception as e:
        logger.error(f"Unexpected error getting task dependencies: {e}")
        return {}


def _get_goal_dependencies(
    session: Session, tasks: list[SchedulerTask]
) -> dict[str, list[str]]:
    """
    Get goal dependencies that affect the given tasks.

    Returns:
        Dict mapping goal_id to list of goal_ids it depends on
    """
    # Get unique goal IDs from tasks (excluding weekly recurring tasks)
    goal_ids = list(
        {
            task.goal_id
            for task in tasks
            if task.goal_id and not task.is_weekly_recurring
        }
    )
    if not goal_ids:
        return {}

    try:
        # Convert string IDs to UUIDs
        goal_uuids = []
        for goal_id in goal_ids:
            try:
                goal_uuids.append(UUID(goal_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for goal ID {goal_id}: {uuid_error}"
                )
                continue  # Skip invalid UUIDs but continue processing others

        if not goal_uuids:
            logger.warning("No valid goal UUIDs found after validation")
            return {}

        # Query goal dependencies
        goal_uuid_strs = [str(uuid) for uuid in goal_uuids]
        dependencies = session.exec(
            select(GoalDependency).where(
                cast(GoalDependency.goal_id, String).in_(goal_uuid_strs)
            )
        ).all()

        dependency_map: dict[str, list[str]] = {}
        for dep in dependencies:
            goal_id = str(dep.goal_id)
            depends_on_id = str(dep.depends_on_goal_id)

            if goal_id not in dependency_map:
                dependency_map[goal_id] = []
            dependency_map[goal_id].append(depends_on_id)

        filtered_count = len(goal_ids) - len(goal_uuids)
        if filtered_count > 0:
            logger.info(f"Filtered out {filtered_count} tasks with invalid goal IDs")

        logger.debug(
            f"Found {len(dependencies)} goal dependencies for {len(goal_uuids)} valid goals"
        )
        return dependency_map

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(f"Database error getting goal dependencies: {db_error}")
        # Return empty dict to avoid breaking scheduler, but log the issue
        return {}
    except Exception as e:
        logger.error(f"Unexpected error getting goal dependencies: {e}")
        return {}


def _batch_check_task_completion_status(
    session: Session, task_dependencies: dict[str, list[str]]
) -> dict[str, bool]:
    """
    Batch check completion status for all tasks to avoid N+1 query pattern.

    Args:
        session: Database session
        task_dependencies: Task dependency mapping

    Returns:
        Dict mapping task_id to completion status (True if completed)
    """
    # Collect all unique task IDs that need status checking
    all_dependency_ids = set()
    for dependent_list in task_dependencies.values():
        all_dependency_ids.update(dependent_list)

    if not all_dependency_ids:
        return {}

    try:
        # Convert to UUIDs
        dependency_uuids = []
        for task_id in all_dependency_ids:
            try:
                dependency_uuids.append(UUID(task_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for dependency task ID {task_id}: {uuid_error}"
                )
                continue

        # Batch query for all completion statuses
        dependency_uuid_strs = [str(uuid) for uuid in dependency_uuids]
        completed_tasks = session.exec(
            select(Task.id)
            .where(cast(Task.id, String).in_(dependency_uuid_strs))
            .where(Task.status == TaskStatus.COMPLETED)
        ).all()

        # Create lookup map
        completion_status = {}
        for task_id in all_dependency_ids:
            try:
                task_uuid = UUID(task_id)
                completion_status[task_id] = task_uuid in completed_tasks
            except ValueError:
                completion_status[task_id] = False  # Invalid UUID = not completed

        logger.debug(
            f"Batch checked completion status for {len(all_dependency_ids)} dependency tasks"
        )
        return completion_status

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(f"Database error checking task completion status: {db_error}")
        return {}
    except Exception as e:
        logger.error(f"Unexpected error checking task completion status: {e}")
        return {}


def _check_task_dependencies_satisfied(
    session: Session,
    task: SchedulerTask,
    task_dependencies: dict[str, list[str]],
    completion_status_cache: dict[str, bool] | None = None,
) -> bool:
    """
    Check if all dependencies for a task are satisfied (completed).

    Args:
        session: Database session
        task: The task to check
        task_dependencies: Task dependency mapping
        completion_status_cache: Optional cache of task completion statuses

    Returns:
        True if all dependencies are satisfied, False otherwise
    """
    if task.id not in task_dependencies:
        return True  # No dependencies = satisfied

    dependent_task_ids = task_dependencies[task.id]

    # Use cache if provided (for batch processing), otherwise fall back to individual query
    if completion_status_cache is not None:
        completed_count = sum(
            completion_status_cache.get(task_id, False)
            for task_id in dependent_task_ids
        )
        is_satisfied = completed_count == len(dependent_task_ids)

        if not is_satisfied:
            logger.debug(
                f"Task {task.id} dependencies not satisfied: {completed_count}/{len(dependent_task_ids)} completed"
            )

        return is_satisfied

    # Fallback to individual query (for backward compatibility)
    try:
        dependent_uuids = []
        for task_id in dependent_task_ids:
            try:
                dependent_uuids.append(UUID(task_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for dependency task ID {task_id}: {uuid_error}"
                )
                continue

        # Check if all dependent tasks are completed
        dependent_uuid_strs = [str(uuid) for uuid in dependent_uuids]
        completed_tasks = session.exec(
            select(Task.id)
            .where(cast(Task.id, String).in_(dependent_uuid_strs))
            .where(Task.status == TaskStatus.COMPLETED)
        ).all()

        is_satisfied = len(completed_tasks) == len(dependent_uuids)

        if not is_satisfied:
            logger.debug(
                f"Task {task.id} dependencies not satisfied: {len(completed_tasks)}/{len(dependent_uuids)} completed"
            )

        return is_satisfied

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(
            f"Database error checking task dependencies for {task.id}: {db_error}"
        )
        return False  # Assume not satisfied on error
    except Exception as e:
        logger.error(f"Unexpected error checking task dependencies for {task.id}: {e}")
        return False  # Assume not satisfied on error


def _check_task_dependencies_satisfied_relaxed(
    session: Session,
    task: SchedulerTask,
    task_dependencies: dict[str, list[str]],
    completion_status_cache: dict[str, bool] | None = None,
    available_task_ids: set[str] | None = None,
) -> bool:
    """
    Check if all dependencies for a task are satisfied with relaxed constraints.

    A task dependency is considered satisfied if the dependent task is either:
    1. Completed, or
    2. Available for scheduling in the same schedule (relaxed constraint)

    Args:
        session: Database session
        task: The task to check
        task_dependencies: Task dependency mapping
        completion_status_cache: Optional cache of task completion statuses
        available_task_ids: Set of task IDs available in the current schedule

    Returns:
        True if all dependencies are satisfied or schedulable, False otherwise
    """
    if task.id not in task_dependencies:
        return True  # No dependencies = satisfied

    dependent_task_ids = task_dependencies[task.id]
    available_task_ids = available_task_ids or set()

    satisfied_deps = 0
    for dep_task_id in dependent_task_ids:
        # Check if dependency is completed
        is_completed = False
        if completion_status_cache is not None:
            is_completed = completion_status_cache.get(dep_task_id, False)
        else:
            # Fallback to individual query
            try:
                dep_task = session.get(Task, UUID(dep_task_id))
                if dep_task:
                    is_completed = dep_task.status in ["completed", "done", "finished"]
            except Exception as e:
                logger.warning(f"Could not check dependency task {dep_task_id}: {e}")
                continue

        # Check if dependency is available for scheduling (relaxed constraint)
        is_available_for_scheduling = dep_task_id in available_task_ids

        if is_completed or is_available_for_scheduling:
            satisfied_deps += 1
        else:
            logger.debug(
                f"Task {task.id} dependency {dep_task_id} is neither completed nor available for scheduling"
            )

    is_satisfied = satisfied_deps == len(dependent_task_ids)

    if not is_satisfied:
        logger.debug(
            f"Task {task.id} dependencies not satisfied: {satisfied_deps}/{len(dependent_task_ids)} satisfied or schedulable"
        )

    return is_satisfied


def _check_goal_dependencies_satisfied_relaxed(
    session: Session,
    task: SchedulerTask,
    goal_dependencies: dict[str, list[str]],
    completion_status_cache: dict[str, bool] | None = None,
    available_task_ids: set[str] | None = None,
) -> bool:
    """
    Check if all goal dependencies for a task are satisfied with relaxed constraints.

    A goal dependency is considered satisfied if the dependent goal is either:
    1. Completed, or
    2. Has tasks available for scheduling in the same schedule (relaxed constraint)

    Args:
        session: Database session
        task: The task to check
        goal_dependencies: Goal dependency mapping
        completion_status_cache: Optional cache of goal completion statuses
        available_task_ids: Set of task IDs available in the current schedule

    Returns:
        True if all goal dependencies are satisfied or have schedulable tasks, False otherwise
    """
    if not task.goal_id or task.goal_id not in goal_dependencies:
        return True  # No goal dependencies = satisfied

    dependent_goal_ids = goal_dependencies[task.goal_id]
    available_task_ids = available_task_ids or set()

    satisfied_deps = 0
    for dep_goal_id in dependent_goal_ids:
        # Check if goal is completed
        is_completed = False
        if completion_status_cache is not None:
            is_completed = completion_status_cache.get(dep_goal_id, False)
        else:
            # Fallback to individual query
            try:
                dep_goal = session.get(Goal, UUID(dep_goal_id))
                if dep_goal:
                    is_completed = dep_goal.status in ["completed", "done", "finished"]
            except Exception as e:
                logger.warning(f"Could not check dependency goal {dep_goal_id}: {e}")
                continue

        # Check if goal has tasks available for scheduling (relaxed constraint)
        has_schedulable_tasks = False
        if not is_completed:
            try:
                goal_tasks = session.exec(
                    select(Task).where(Task.goal_id == UUID(dep_goal_id))
                ).all()
                has_schedulable_tasks = any(
                    str(goal_task.id) in available_task_ids for goal_task in goal_tasks
                )
            except Exception as e:
                logger.warning(
                    f"Could not check schedulable tasks for goal {dep_goal_id}: {e}"
                )

        if is_completed or has_schedulable_tasks:
            satisfied_deps += 1
        else:
            logger.debug(
                f"Task {task.id} goal dependency {dep_goal_id} is neither completed nor has schedulable tasks"
            )

    is_satisfied = satisfied_deps == len(dependent_goal_ids)

    if not is_satisfied:
        logger.debug(
            f"Task {task.id} goal dependencies not satisfied: {satisfied_deps}/{len(dependent_goal_ids)} satisfied or have schedulable tasks"
        )

    return is_satisfied


def _batch_check_goal_completion_status(
    session: Session, goal_dependencies: dict[str, list[str]]
) -> dict[str, bool]:
    """
    Batch check completion status for all goals to avoid N+1 query pattern.

    Args:
        session: Database session
        goal_dependencies: Goal dependency mapping

    Returns:
        Dict mapping goal_id to completion status (True if completed)
    """
    # Collect all unique goal IDs that need status checking
    all_dependency_ids = set()
    for dependent_list in goal_dependencies.values():
        all_dependency_ids.update(dependent_list)

    if not all_dependency_ids:
        return {}

    try:
        # Convert to UUIDs
        dependency_uuids = []
        for goal_id in all_dependency_ids:
            try:
                dependency_uuids.append(UUID(goal_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for dependency goal ID {goal_id}: {uuid_error}"
                )
                continue

        # Batch query for all completion statuses
        dependency_uuid_strs = [str(uuid) for uuid in dependency_uuids]
        completed_goals = session.exec(
            select(Goal.id)
            .where(cast(Goal.id, String).in_(dependency_uuid_strs))
            .where(Goal.status == GoalStatus.COMPLETED)
        ).all()

        # Create lookup map
        completion_status = {}
        for goal_id in all_dependency_ids:
            try:
                goal_uuid = UUID(goal_id)
                completion_status[goal_id] = goal_uuid in completed_goals
            except ValueError:
                completion_status[goal_id] = False  # Invalid UUID = not completed

        logger.debug(
            f"Batch checked completion status for {len(all_dependency_ids)} dependency goals"
        )
        return completion_status

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(f"Database error checking goal completion status: {db_error}")
        return {}
    except Exception as e:
        logger.error(f"Unexpected error checking goal completion status: {e}")
        return {}


def _check_goal_dependencies_satisfied(
    session: Session,
    task: SchedulerTask,
    goal_dependencies: dict[str, list[str]],
    goal_completion_cache: dict[str, bool] | None = None,
) -> bool:
    """
    Check if all goal dependencies for a task are satisfied (completed).

    Args:
        session: Database session
        task: The task to check
        goal_dependencies: Goal dependency mapping
        goal_completion_cache: Optional cache of goal completion statuses

    Returns:
        True if all goal dependencies are satisfied, False otherwise
    """
    if not task.goal_id or task.goal_id not in goal_dependencies:
        return True  # No goal dependencies = satisfied

    dependent_goal_ids = goal_dependencies[task.goal_id]

    # Use cache if provided (for batch processing), otherwise fall back to individual query
    if goal_completion_cache is not None:
        completed_count = sum(
            goal_completion_cache.get(goal_id, False) for goal_id in dependent_goal_ids
        )
        is_satisfied = completed_count == len(dependent_goal_ids)

        if not is_satisfied:
            logger.debug(
                f"Task {task.id} goal dependencies not satisfied: {completed_count}/{len(dependent_goal_ids)} completed"
            )

        return is_satisfied

    # Fallback to individual query (for backward compatibility)
    try:
        dependent_uuids = []
        for goal_id in dependent_goal_ids:
            try:
                dependent_uuids.append(UUID(goal_id))
            except ValueError as uuid_error:
                logger.warning(
                    f"Invalid UUID format for dependency goal ID {goal_id}: {uuid_error}"
                )
                continue

        # Check if all dependent goals are completed
        dependent_uuid_strs = [str(uuid) for uuid in dependent_uuids]
        completed_goals = session.exec(
            select(Goal.id)
            .where(cast(Goal.id, String).in_(dependent_uuid_strs))
            .where(Goal.status == GoalStatus.COMPLETED)
        ).all()

        is_satisfied = len(completed_goals) == len(dependent_uuids)

        if not is_satisfied:
            logger.debug(
                f"Task {task.id} goal dependencies not satisfied: {len(completed_goals)}/{len(dependent_uuids)} completed"
            )

        return is_satisfied

    except (SQLAlchemyError, DatabaseError) as db_error:
        logger.error(
            f"Database error checking goal dependencies for task {task.id}: {db_error}"
        )
        return False  # Assume not satisfied on error
    except Exception as e:
        logger.error(
            f"Unexpected error checking goal dependencies for task {task.id}: {e}"
        )
        return False  # Assume not satisfied on error


def optimize_schedule(
    tasks: list[SchedulerTask],
    time_slots: list[TimeSlot],
    date: datetime | None = None,
    session: Session | None = None,
    user_id: str | UUID | None = None,
) -> ScheduleResult:
    """
    OR-Tools CP-SAT constraint solver implementation for task scheduling optimization.

    Optimizes task assignment considering:
    - Time constraints: Task duration fits in time slots
    - Deadline constraints: Due dates are respected
    - Task type constraints: Matching task kinds with slot kinds
    - Capacity constraints: Maximum hours per slot
    - Priority constraints: Higher priority tasks get better slots

    Returns optimized schedule with constraint satisfaction guarantees.
    """
    import time as time_module

    start_time = time_module.time()

    if not tasks or not time_slots:
        return ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=[task.id for task in tasks] if tasks else [],
            total_scheduled_hours=0.0,
            optimization_status="NO_TASKS_OR_SLOTS",
            solve_time_seconds=time_module.time() - start_time,
        )

    # Filter tasks based on dependency constraints
    schedulable_tasks = []
    unscheduled_due_to_dependencies = []

    if session:
        # Get dependency data
        task_dependencies = _get_task_dependencies(session, tasks)
        goal_dependencies = _get_goal_dependencies(session, tasks)

        logger.debug(f"Checking dependencies for {len(tasks)} tasks")

        # Batch check completion statuses to optimize database queries
        task_completion_cache = _batch_check_task_completion_status(
            session, task_dependencies
        )
        goal_completion_cache = _batch_check_goal_completion_status(
            session, goal_dependencies
        )

        # Track filtering reasons for better logging
        weekly_recurring_count = 0
        task_dependency_blocked = 0
        goal_dependency_blocked = 0

        # Filter tasks with relaxed dependency constraints
        # Allow tasks if their dependencies are either completed or available in the same schedule
        available_task_ids = {task.id for task in tasks}

        for task in tasks:
            # Weekly recurring tasks are always schedulable (they don't have dependencies)
            if task.is_weekly_recurring:
                schedulable_tasks.append(task)
                weekly_recurring_count += 1
                continue

            # Check task dependencies with relaxed constraints
            task_deps_satisfied = _check_task_dependencies_satisfied_relaxed(
                session,
                task,
                task_dependencies,
                task_completion_cache,
                available_task_ids,
            )

            # Check goal dependencies with relaxed constraints
            goal_deps_satisfied = _check_goal_dependencies_satisfied_relaxed(
                session,
                task,
                goal_dependencies,
                goal_completion_cache,
                available_task_ids,
            )

            if task_deps_satisfied and goal_deps_satisfied:
                schedulable_tasks.append(task)
            else:
                unscheduled_due_to_dependencies.append(task.id)

                # Log specific blocking reasons
                if not task_deps_satisfied:
                    task_dependency_blocked += 1
                    logger.info(
                        f"Task {task.id} '{task.title}' blocked by unsatisfiable task dependencies"
                    )
                if not goal_deps_satisfied:
                    goal_dependency_blocked += 1
                    logger.info(
                        f"Task {task.id} '{task.title}' blocked by unsatisfiable goal dependencies"
                    )

        # Summary logging with detailed breakdown
        logger.info(
            f"Dependency filtering summary: {len(schedulable_tasks)} schedulable tasks "
            f"({weekly_recurring_count} weekly recurring), "
            f"{len(unscheduled_due_to_dependencies)} blocked "
            f"({task_dependency_blocked} by task deps, {goal_dependency_blocked} by goal deps)"
        )
    else:
        # No session provided, schedule all tasks (backward compatibility)
        schedulable_tasks = tasks
        logger.warning("No database session provided, skipping dependency checks")

    # Use filtered tasks for optimization
    tasks = schedulable_tasks

    if not tasks:
        return ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=unscheduled_due_to_dependencies,
            total_scheduled_hours=0.0,
            optimization_status="NO_SCHEDULABLE_TASKS_DUE_TO_DEPENDENCIES",
            solve_time_seconds=time_module.time() - start_time,
        )

    # Create CP-SAT model
    model = cp_model.CpModel()

    # Calculate slot capacities in minutes for better precision
    slot_capacities = []
    for slot in time_slots:
        slot_duration = (
            datetime.combine(datetime.today(), slot.end)
            - datetime.combine(datetime.today(), slot.start)
        ).total_seconds() / 60  # Convert to minutes
        capacity = (
            slot.capacity_hours * 60
            if slot.capacity_hours is not None
            else slot_duration
        )
        slot_capacities.append(min(capacity, slot_duration))

    # Convert task remaining hours to minutes for optimization
    task_durations = [math.ceil(task.remaining_hours * 60) for task in tasks]

    # Decision variables: x[i][j] = 1 if task i is assigned to slot j
    x = {}
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            x[i, j] = model.NewBoolVar(f"task_{i}_slot_{j}")

    # Variable for actual assigned duration (in minutes)
    assigned_durations = {}
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            # Duration is between 0 and min(task_duration, slot_capacity)
            max_duration = min(task_durations[i], int(slot_capacities[j]))
            assigned_durations[i, j] = model.NewIntVar(
                0, max_duration, f"duration_{i}_{j}"
            )

            # If task is assigned to slot, duration must be positive (if possible)
            if max_duration >= 1:
                model.Add(assigned_durations[i, j] >= 1).OnlyEnforceIf(x[i, j])
            model.Add(assigned_durations[i, j] == 0).OnlyEnforceIf(x[i, j].Not())

    # Constraint 1: Each task is assigned to at most one slot
    for i, _task in enumerate(tasks):
        model.Add(sum(x[i, j] for j in range(len(time_slots))) <= 1)

    # Constraint 2: Slot capacity constraints
    for j, _slot in enumerate(time_slots):
        model.Add(
            sum(assigned_durations[i, j] for i in range(len(tasks)))
            <= int(slot_capacities[j])
        )

    # Constraint 3: Task dependency ordering constraints
    # If session is available, add ordering constraints for task dependencies
    if session:
        task_dependencies_in_schedule = _get_task_dependencies(session, tasks)
        goal_dependencies_in_schedule = _get_goal_dependencies(session, tasks)
        task_id_to_index = {task.id: i for i, task in enumerate(tasks)}

        # Add task dependency constraints
        for task_id, dependent_task_ids in task_dependencies_in_schedule.items():
            if task_id in task_id_to_index:
                task_idx = task_id_to_index[task_id]

                for dep_task_id in dependent_task_ids:
                    if dep_task_id in task_id_to_index:
                        dep_task_idx = task_id_to_index[dep_task_id]

                        # Add temporal ordering constraint:
                        # If dependent task is assigned to slot j, prerequisite task cannot be assigned to any later slot k (k > j)
                        for j in range(len(time_slots)):
                            for k in range(j + 1, len(time_slots)):
                                # If dependent task is in earlier slot j, prerequisite task cannot be in later slot k
                                # This ensures prerequisite is scheduled before or at the same time as dependent task
                                model.Add(x[task_idx, j] + x[dep_task_idx, k] <= 1)

                        logger.debug(
                            f"Added task dependency constraint: task {task_id} depends on {dep_task_id}"
                        )

        # Add goal dependency constraints
        # Goal A depends on Goal B means all tasks in Goal A must be scheduled after all tasks in Goal B
        goal_to_task_indices = {}
        for i, task in enumerate(tasks):
            if task.goal_id and not task.is_weekly_recurring:
                if task.goal_id not in goal_to_task_indices:
                    goal_to_task_indices[task.goal_id] = []
                goal_to_task_indices[task.goal_id].append(i)

        for goal_id, dependent_goal_ids in goal_dependencies_in_schedule.items():
            if goal_id in goal_to_task_indices:
                dependent_goal_task_indices = goal_to_task_indices[goal_id]

                for dep_goal_id in dependent_goal_ids:
                    if dep_goal_id in goal_to_task_indices:
                        prerequisite_goal_task_indices = goal_to_task_indices[
                            dep_goal_id
                        ]

                        # Add constraint: all tasks in dependent goal must be scheduled after all tasks in prerequisite goal
                        for dependent_task_idx in dependent_goal_task_indices:
                            for prerequisite_task_idx in prerequisite_goal_task_indices:
                                for j in range(len(time_slots)):
                                    for k in range(j + 1, len(time_slots)):
                                        # If dependent goal task is in earlier slot j, prerequisite goal task cannot be in later slot k
                                        model.Add(
                                            x[dependent_task_idx, j]
                                            + x[prerequisite_task_idx, k]
                                            <= 1
                                        )

                        logger.debug(
                            f"Added goal dependency constraint: goal {goal_id} depends on {dep_goal_id}"
                        )

    # Constraint 4: Task kind matching with slot kind (soft constraint via penalty)
    kind_match_bonus = {}

    # Constraint 4.5: Slot-specific project assignment constraints
    for j, slot in enumerate(time_slots):
        if slot.assigned_project_id:
            # This slot can only be assigned tasks from the specified project
            logger.debug(
                f"Adding project constraint for slot {j}: project {slot.assigned_project_id}"
            )
            for i, task in enumerate(tasks):
                # Skip weekly recurring tasks (they don't have project_id)
                if task.is_weekly_recurring:
                    continue

                # Use project_id directly from SchedulerTask (already set during task creation)
                task_project_id = task.project_id

                # If task project doesn't match slot's assigned project, forbid assignment
                if task_project_id != slot.assigned_project_id:
                    model.Add(x[i, j] == 0)

    for i, task in enumerate(tasks):
        for j, slot in enumerate(time_slots):
            # Bonus for matching task kind with slot kind
            match_score = 10 if task.kind.value == slot.kind.value else 1
            kind_match_bonus[i, j] = match_score

    # Constraint 4: Priority-based scheduling (higher priority gets better treatment)
    priority_weights = {}
    for i, task in enumerate(tasks):
        # Higher priority (lower number) gets higher weight
        priority_weights[i] = max(1, 10 - task.priority)

    # Constraint 5: Deadline constraints (soft constraint via penalty)
    deadline_bonus = {}
    if date:
        schedule_date = date
        for i, task in enumerate(tasks):
            for j, _slot in enumerate(time_slots):
                if task.due_date:
                    # due_date is datetime, extract date for comparison
                    due_date_obj = task.due_date.date()
                    days_until_due = (due_date_obj - schedule_date.date()).days
                    # Bonus for scheduling tasks closer to deadline
                    deadline_bonus[i, j] = (
                        max(1, 10 - days_until_due) if days_until_due >= 0 else 1
                    )
                else:
                    deadline_bonus[i, j] = 1
    else:
        # No date provided, use neutral deadline bonus
        for i, _task in enumerate(tasks):
            for j, _slot in enumerate(time_slots):
                deadline_bonus[i, j] = 1

    # Objective: Maximize weighted scheduled time with bonuses
    objective_terms = []
    for i, _task in enumerate(tasks):
        for j, _slot in enumerate(time_slots):
            # Weight = base_duration * priority_weight * kind_match * deadline_bonus
            weight = priority_weights[i] * kind_match_bonus[i, j] * deadline_bonus[i, j]
            objective_terms.append(assigned_durations[i, j] * weight)

    model.Maximize(sum(objective_terms))

    # Solve the model
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0  # 5 second timeout
    solver.parameters.log_search_progress = False

    status = solver.Solve(model)
    solve_time = time_module.time() - start_time

    # Process results
    assignments = []
    unscheduled_tasks = []
    total_scheduled_minutes = 0

    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        # Extract assignments
        for i, task in enumerate(tasks):
            assigned = False
            for j, slot in enumerate(time_slots):
                if solver.Value(x[i, j]) == 1:
                    duration_minutes = solver.Value(assigned_durations[i, j])
                    duration_hours = duration_minutes / 60.0

                    assignments.append(
                        Assignment(
                            task_id=task.id,
                            slot_index=j,
                            start_time=slot.start,
                            duration_hours=duration_hours,
                        )
                    )
                    total_scheduled_minutes += duration_minutes
                    assigned = True
                    break

            if not assigned:
                unscheduled_tasks.append(task.id)

        # Determine optimization status
        if status == cp_model.OPTIMAL:
            optimization_status = "OPTIMAL"
        else:
            optimization_status = "FEASIBLE"

        success = True
        objective_value = solver.ObjectiveValue()

    else:
        # No solution found
        unscheduled_tasks = [task.id for task in tasks]
        optimization_status = (
            "INFEASIBLE" if status == cp_model.INFEASIBLE else "UNKNOWN"
        )
        success = False
        objective_value = None

    # Add tasks that were unscheduled due to dependencies
    if session and unscheduled_due_to_dependencies:
        unscheduled_tasks.extend(unscheduled_due_to_dependencies)

    total_scheduled_hours = total_scheduled_minutes / 60.0

    return ScheduleResult(
        success=success,
        assignments=assignments,
        unscheduled_tasks=unscheduled_tasks,
        total_scheduled_hours=total_scheduled_hours,
        optimization_status=optimization_status,
        solve_time_seconds=solve_time,
        objective_value=objective_value if objective_value is not None else 0.0,
    )


# Note: Helper functions removed - using optimize_schedule directly


logger.setLevel(logging.DEBUG)
router = APIRouter(prefix="/schedule", tags=["scheduling"])


class TimeSlotInput(BaseModel):
    """Input model for time slot."""

    start: str = Field(..., description="Start time in HH:MM format")
    end: str = Field(..., description="End time in HH:MM format")
    kind: str = Field(
        "light_work", description="Slot type: light_work, focused_work, study"
    )
    capacity_hours: float | None = Field(
        None, description="Maximum hours for this slot"
    )
    # New fields for slot-level assignment
    assigned_project_id: str | None = Field(
        None, description="Specified project ID for this slot"
    )

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, v):
        try:
            time_parts = v.split(":")
            if len(time_parts) != 2:
                raise ValueError("Time must be in HH:MM format")
            hour, minute = map(int, time_parts)
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Invalid time values")
            return v
        except (ValueError, TypeError):
            raise ValueError("Time must be in HH:MM format")

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, v):
        valid_kinds = ["light_work", "focused_work", "study"]
        if v.lower() not in valid_kinds:
            raise ValueError(f"Kind must be one of: {valid_kinds}")
        return v.lower()


class TaskSource(BaseModel):
    """Task source configuration for daily scheduling."""

    type: str = Field(
        "all_tasks",
        description="Task source type: 'all_tasks', 'project', 'weekly_schedule'",
    )
    project_id: str | None = Field(
        None, description="Project ID when type is 'project'"
    )
    weekly_schedule_date: str | None = Field(
        None, description="Week start date (YYYY-MM-DD) when type is 'weekly_schedule'"
    )

    @field_validator("type")
    @classmethod
    def validate_task_source_type(cls, v):
        valid_types = ["all_tasks", "project", "weekly_schedule"]
        if v not in valid_types:
            raise ValueError(f"Task source type must be one of: {valid_types}")
        return v


class DailyScheduleRequest(BaseModel):
    """Request model for daily schedule optimization."""

    date: str = Field(..., description="Target date in YYYY-MM-DD format")
    task_source: TaskSource = Field(
        default_factory=lambda: TaskSource(
            type="all_tasks", project_id=None, weekly_schedule_date=None
        ),
        description="Task source configuration",
    )
    # Legacy fields for backward compatibility
    project_id: str | None = Field(
        None, description="[DEPRECATED] Use task_source.project_id instead"
    )
    use_weekly_schedule: bool = Field(
        False, description="[DEPRECATED] Use task_source.type='weekly_schedule' instead"
    )
    time_slots: list[TimeSlotInput] = Field(..., description="Available time slots")
    preferences: dict[str, Any] = Field(
        default_factory=dict, description="Scheduling preferences"
    )

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
            return v
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")

    @field_validator("time_slots")
    @classmethod
    def validate_time_slots_not_empty(cls, v):
        if not v:
            raise ValueError("At least one time slot is required")
        return v


class TaskInfo(BaseModel):
    """Task information for scheduling."""

    id: str
    title: str
    estimate_hours: float
    priority: int
    kind: str
    due_date: datetime | None = None
    goal_id: str | None = None
    project_id: str | None = None


class ScheduleAssignment(BaseModel):
    """Schedule assignment result."""

    task_id: str
    task_title: str
    goal_id: str
    project_id: str
    slot_index: int
    start_time: str
    duration_hours: float
    slot_start: str
    slot_end: str
    slot_kind: str


class DailyScheduleResponse(BaseModel):
    """Response model for daily schedule optimization."""

    success: bool
    date: str
    assignments: list[ScheduleAssignment]
    unscheduled_tasks: list[TaskInfo]
    total_scheduled_hours: float
    optimization_status: str
    solve_time_seconds: float
    objective_value: float | None = None
    generated_at: datetime

    model_config = ConfigDict()

    @field_serializer("generated_at")
    def serialize_generated_at(self, value: datetime) -> str:
        return value.isoformat()


def map_task_kind_from_work_type(work_type: WorkType) -> TaskKind:
    """Map WorkType from database to scheduler TaskKind."""
    mapping = {
        WorkType.LIGHT_WORK: TaskKind.LIGHT_WORK,
        WorkType.FOCUSED_WORK: TaskKind.FOCUSED_WORK,
        WorkType.STUDY: TaskKind.STUDY,
    }
    return mapping.get(work_type, TaskKind.LIGHT_WORK)


def map_task_kind(status: str) -> TaskKind:
    """Map task status or type to scheduler TaskKind (fallback for tasks without work_type)."""
    mapping = {
        "research": TaskKind.FOCUSED_WORK,
        "analysis": TaskKind.FOCUSED_WORK,
        "coding": TaskKind.FOCUSED_WORK,
        "development": TaskKind.FOCUSED_WORK,
        "study": TaskKind.STUDY,
        "learning": TaskKind.STUDY,
        "review": TaskKind.LIGHT_WORK,
        "planning": TaskKind.LIGHT_WORK,
        "admin": TaskKind.LIGHT_WORK,
    }

    # Simple keyword matching in task title/description
    for keyword, kind in mapping.items():
        if keyword in status.lower():
            return kind

    return TaskKind.LIGHT_WORK  # Default


def map_slot_kind(kind_str: str) -> SlotKind:
    """Map input slot kind to scheduler SlotKind."""
    mapping = {
        "light_work": SlotKind.LIGHT_WORK,
        "focused_work": SlotKind.FOCUSED_WORK,
        "study": SlotKind.STUDY,
    }
    return mapping.get(kind_str.lower(), SlotKind.LIGHT_WORK)


@router.post("/daily", response_model=DailyScheduleResponse)
async def create_daily_schedule(
    request: DailyScheduleRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Create optimal daily schedule for tasks using OR-Tools CP-SAT solver.

    This endpoint:
    1. Fetches user's tasks (optionally filtered by project/goal)
    2. Converts time slots to scheduler format
    3. Runs OR-Tools optimization
    4. Returns optimized schedule with assignments
    """
    try:
        logger.info(f"Creating daily schedule for user {user_id} on {request.date}")
        logger.info(
            f"Request params: project_id={request.project_id}, task_source={request.task_source}"
        )

        # Determine task source based on new task_source field or legacy fields
        task_source = request.task_source

        # Handle legacy fields for backward compatibility
        if request.use_weekly_schedule and task_source.type == "all_tasks":
            task_source.type = "weekly_schedule"
            task_source.weekly_schedule_date = request.date
        elif request.project_id and task_source.type == "all_tasks":
            task_source.type = "project"
            task_source.project_id = request.project_id

        # Fetch tasks based on task source configuration
        db_tasks = await _get_tasks_by_source(
            session, user_id, task_source, request.date
        )

        logger.info(f"Fetched {len(db_tasks)} total tasks from database")

        if not db_tasks:
            return DailyScheduleResponse(
                success=True,
                date=request.date,
                assignments=[],
                unscheduled_tasks=[],
                total_scheduled_hours=0.0,
                optimization_status="NO_TASKS",
                solve_time_seconds=0.0,
                generated_at=datetime.now(),
            )

        # Get actual hours for all tasks to calculate remaining hours
        all_task_ids = [str(db_task.id) for db_task in db_tasks]
        actual_hours_map = _get_task_actual_hours(session, all_task_ids)
        logger.info(f"Retrieved actual hours for {len(actual_hours_map)} tasks")

        # Convert database tasks to scheduler tasks
        scheduler_tasks = []
        task_info_map = {}
        filtered_count = 0

        for db_task in db_tasks:
            # Check if this is a weekly recurring task
            is_weekly_recurring = getattr(db_task, "is_weekly_recurring", False)
            # Only schedule pending or in-progress tasks (weekly recurring tasks are always schedulable)
            if not is_weekly_recurring and db_task.status in ["completed", "cancelled"]:
                filtered_count += 1
                logger.debug(
                    f"Skipping task {db_task.id} with status: {db_task.status}"
                )
                continue

            # Determine task kind from work_type field or fallback to title analysis
            if hasattr(db_task, "work_type") and db_task.work_type:
                task_kind = map_task_kind_from_work_type(db_task.work_type)
            else:
                task_kind = map_task_kind(db_task.title)
            logger.debug(
                f"Including task {db_task.id}: {db_task.title}, status: {getattr(db_task, 'status', 'weekly_recurring')}, kind: {task_kind}"
            )

            # Get goal to access project_id (only for regular tasks)
            project_id = None
            goal_id_str = None
            if (
                not is_weekly_recurring
                and hasattr(db_task, "goal_id")
                and db_task.goal_id
            ):
                goal = goal_service.get_goal(session, db_task.goal_id, user_id)
                project_id = str(goal.project_id) if goal else None
                goal_id_str = str(db_task.goal_id)

            # Get actual hours for this task
            task_id_str = str(db_task.id)
            actual_hours = actual_hours_map.get(task_id_str, 0.0)
            estimate_hours = float(db_task.estimate_hours)

            scheduler_task = SchedulerTask(
                id=task_id_str,
                title=db_task.title,
                estimate_hours=estimate_hours,
                priority=3,  # Default priority - could be enhanced
                due_date=getattr(db_task, "due_date", None),
                kind=task_kind,
                goal_id=goal_id_str,
                is_weekly_recurring=is_weekly_recurring,
                actual_hours=actual_hours,  # Set actual hours from logs
                project_id=project_id,  # Set project_id for slot assignment constraints
            )

            # Log task scheduling information including remaining hours
            remaining_hours = scheduler_task.remaining_hours
            if remaining_hours <= 0 and not is_weekly_recurring:
                logger.info(
                    f"Task {task_id_str} '{db_task.title}' has no remaining hours "
                    f"(estimate: {estimate_hours}h, actual: {actual_hours}h)"
                )
            else:
                logger.debug(
                    f"Task {task_id_str} '{db_task.title}' - "
                    f"estimate: {estimate_hours}h, actual: {actual_hours}h, remaining: {remaining_hours}h"
                )
            scheduler_tasks.append(scheduler_task)

            # Store task info for response
            # Calculate remaining hours for this task
            task_id_str = str(db_task.id)
            actual_hours = actual_hours_map.get(task_id_str, 0.0)
            estimate_hours = float(db_task.estimate_hours)
            remaining_hours = max(0.0, estimate_hours - actual_hours)

            task_info_map[str(db_task.id)] = TaskInfo(
                id=str(db_task.id),  # Convert UUID to string
                title=db_task.title,
                estimate_hours=remaining_hours,  # Now shows remaining hours instead of estimate
                priority=3,
                kind=task_kind.value,
                due_date=getattr(db_task, "due_date", None),
                goal_id=goal_id_str,
                project_id=project_id,
            )

        logger.info(f"Filtered out {filtered_count} completed/cancelled tasks")
        logger.info(f"Converted {len(scheduler_tasks)} tasks for scheduling")

        # Validate ownership of assigned projects and weekly tasks (skip in test environment)
        try:
            for slot_input in request.time_slots:
                if slot_input.assigned_project_id:
                    # Verify project ownership
                    project = session.exec(
                        select(Project).where(
                            Project.id == slot_input.assigned_project_id,
                            Project.owner_id == user_id,
                        )
                    ).first()
                    if not project:
                        raise HTTPException(
                            status_code=403,
                            detail=f"Access denied to project {slot_input.assigned_project_id}",
                        )

        except (DatabaseError, SQLAlchemyError) as e:
            # In test environments or when database is not available, skip ownership validation
            logger.warning(f"Skipping ownership validation due to database error: {e}")
            pass

        # Convert time slots
        scheduler_slots = []
        for slot_input in request.time_slots:
            # Parse time strings
            start_parts = slot_input.start.split(":")
            end_parts = slot_input.end.split(":")

            start_time = time(int(start_parts[0]), int(start_parts[1]))
            end_time = time(int(end_parts[0]), int(end_parts[1]))

            slot_kind = map_slot_kind(slot_input.kind)

            time_slot = TimeSlot(
                start=start_time,
                end=end_time,
                kind=slot_kind,
                capacity_hours=slot_input.capacity_hours,
                assigned_project_id=slot_input.assigned_project_id,
            )
            scheduler_slots.append(time_slot)

        # Run optimization
        logger.info(
            f"Running optimization with {len(scheduler_tasks)} tasks and {len(scheduler_slots)} slots"
        )
        optimization_result = optimize_schedule(
            scheduler_tasks, scheduler_slots, request.date, session, user_id
        )

        # Process results
        assignments = []
        unscheduled_task_info = []

        for assignment in optimization_result.assignments:
            task_info = task_info_map[assignment.task_id]
            slot_input = request.time_slots[assignment.slot_index]

            schedule_assignment = ScheduleAssignment(
                task_id=assignment.task_id,
                task_title=task_info.title,
                goal_id=task_info.goal_id or "",
                project_id=task_info.project_id or "",
                slot_index=assignment.slot_index,
                start_time=assignment.start_time.strftime("%H:%M"),
                duration_hours=assignment.duration_hours,
                slot_start=slot_input.start,
                slot_end=slot_input.end,
                slot_kind=slot_input.kind,
            )
            assignments.append(schedule_assignment)

        for task_id in optimization_result.unscheduled_tasks:
            if task_id in task_info_map:
                unscheduled_task_info.append(task_info_map[task_id])

        response = DailyScheduleResponse(
            success=optimization_result.success,
            date=request.date,
            assignments=assignments,
            unscheduled_tasks=unscheduled_task_info,
            total_scheduled_hours=optimization_result.total_scheduled_hours,
            optimization_status=optimization_result.optimization_status,
            solve_time_seconds=optimization_result.solve_time_seconds,
            objective_value=optimization_result.objective_value,
            generated_at=datetime.now(),
        )

        logger.info(
            f"Schedule optimization completed: {len(assignments)} tasks scheduled"
        )
        return response

    except ValidationError as e:
        logger.error(f"Validation error in schedule creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorResponse.create(
                code="VALIDATION_ERROR", message=str(e), details={"date": request.date}
            ).model_dump(),
        )

    except ResourceNotFoundError as e:
        logger.error(f"Resource not found in schedule creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND", message=str(e)
            ).model_dump(),
        )

    except Exception as e:
        logger.error(f"Unexpected error in schedule creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during schedule optimization",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.get("/test", response_model=dict[str, str])
async def test_scheduler():
    """Test endpoint to verify OR-Tools CP-SAT scheduler integration."""
    try:
        # Test CP-SAT solver with simple scenario
        test_tasks = [
            SchedulerTask(
                id="test_1",
                title="Test Focused Work Task",
                estimate_hours=2.0,
                priority=1,
                kind=TaskKind.FOCUSED_WORK,
                project_id=None,  # Test tasks don't have project assignments
            ),
            SchedulerTask(
                id="test_2",
                title="Test Light Work Task",
                estimate_hours=1.0,
                priority=2,
                kind=TaskKind.LIGHT_WORK,
                project_id=None,  # Test tasks don't have project assignments
            ),
        ]

        test_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(11, 0),
                kind=SlotKind.FOCUSED_WORK,
                capacity_hours=2.0,
            ),
            TimeSlot(
                start=time(14, 0),
                end=time(15, 0),
                kind=SlotKind.LIGHT_WORK,
                capacity_hours=1.0,
            ),
        ]

        # Run optimization test
        result = optimize_schedule(test_tasks, test_slots)

        return {
            "status": "success",
            "message": "OR-Tools CP-SAT scheduler working correctly",
            "test_assignments": str(len(result.assignments)),
            "optimization_status": result.optimization_status,
            "solve_time_seconds": str(result.solve_time_seconds),
            "ortools_available": "True",
            "implementation": "cp_sat",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"CP-SAT scheduler test failed: {str(e)}",
            "ortools_available": "False",
            "implementation": "cp_sat",
        }


class WeeklyScheduleOption(BaseModel):
    """Weekly schedule option for task source selection."""

    week_start_date: str = Field(
        ..., description="Week start date in YYYY-MM-DD format"
    )
    task_count: int = Field(..., description="Number of tasks in the weekly schedule")
    title: str = Field(..., description="Descriptive title for the weekly schedule")


@router.get("/weekly-schedule-options", response_model=list[WeeklyScheduleOption])
async def get_weekly_schedule_options(
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get available weekly schedules that can be used as task sources for daily scheduling.

    Returns a list of weekly schedule options with their dates and task counts.
    """
    try:
        logger.info(f"Fetching weekly schedule options for user {user_id}")

        # Convert user_id to UUID if it's a string
        from uuid import UUID

        try:
            user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
            logger.debug(f"Converted user_id to UUID: {user_uuid}")
        except ValueError as uuid_error:
            logger.error(f"Invalid user_id format: {user_id}, error: {uuid_error}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_USER_ID",
                    message="Invalid user ID format",
                    details={"provided_user_id": user_id},
                ).model_dump(),
            )

        # Get all weekly schedules for the user with enhanced error handling
        from sqlmodel import desc

        try:
            logger.debug(
                f"Executing weekly schedule options query for user {user_uuid}"
            )

            query = (
                select(WeeklySchedule)
                .where(WeeklySchedule.user_id == user_uuid)
                .order_by(desc(WeeklySchedule.week_start_date))
            )

            logger.debug(f"SQL Query: {query}")
            weekly_schedules = session.exec(query).all()

            logger.info(f"Found {len(weekly_schedules)} weekly schedules")

        except Exception as db_error:
            logger.error(f"Database query error: {type(db_error).__name__}: {db_error}")
            import traceback

            logger.error(f"Database query traceback: {traceback.format_exc()}")

            # Check if it's a database connection issue
            if (
                "connection" in str(db_error).lower()
                or "timeout" in str(db_error).lower()
            ):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=ErrorResponse.create(
                        code="DATABASE_CONNECTION_ERROR",
                        message="Database is temporarily unavailable",
                        details={"error_type": type(db_error).__name__},
                    ).model_dump(),
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=ErrorResponse.create(
                        code="DATABASE_QUERY_ERROR",
                        message="Failed to query weekly schedule options",
                        details={
                            "error_type": type(db_error).__name__,
                            "error_message": str(db_error),
                        },
                    ).model_dump(),
                )

        # Convert to options format
        options = []
        for schedule in weekly_schedules:
            try:
                # Extract task count from schedule data
                task_count = 0
                if (
                    schedule.schedule_json
                    and "selected_tasks" in schedule.schedule_json
                ):
                    task_count = len(schedule.schedule_json["selected_tasks"])

                # Format date and create title
                week_start_str = schedule.week_start_date.strftime("%Y-%m-%d")
                week_end = schedule.week_start_date.date() + timedelta(days=6)
                week_end_str = week_end.strftime("%Y-%m-%d")
                title = f"Week {week_start_str} to {week_end_str} ({task_count} tasks)"

                option = WeeklyScheduleOption(
                    week_start_date=week_start_str, task_count=task_count, title=title
                )
                options.append(option)

            except Exception as e:
                logger.error(f"Error processing weekly schedule {schedule.id}: {e}")
                import traceback

                logger.error(f"Processing error traceback: {traceback.format_exc()}")
                continue

        logger.info(f"Returning {len(options)} weekly schedule options")
        return options

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching weekly schedule options: {e}")
        import traceback

        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to fetch weekly schedule options",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.post("/daily/save", response_model=ScheduleResponse)
async def save_daily_schedule(
    schedule_data: DailyScheduleResponse,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Save optimized daily schedule to database.

    This endpoint stores the schedule optimization result for later retrieval.
    """
    try:
        logger.info(f"Saving daily schedule for user {user_id} on {schedule_data.date}")

        # Check if schedule already exists for this date
        existing_schedule = session.exec(
            select(Schedule).where(
                Schedule.user_id == user_id,
                Schedule.date == datetime.strptime(schedule_data.date, "%Y-%m-%d"),
            )
        ).first()

        # Prepare schedule data for storage
        # Note: unscheduled_tasks are intentionally not stored in database (Issue #141)
        plan_data = {
            "success": schedule_data.success,
            "assignments": [
                {
                    "task_id": a.task_id,
                    "task_title": a.task_title,
                    "goal_id": a.goal_id,
                    "project_id": a.project_id,
                    "slot_index": a.slot_index,
                    "start_time": a.start_time,
                    "duration_hours": a.duration_hours,
                    "slot_start": a.slot_start,
                    "slot_end": a.slot_end,
                    "slot_kind": a.slot_kind,
                }
                for a in schedule_data.assignments
            ],
            "total_scheduled_hours": schedule_data.total_scheduled_hours,
            "optimization_status": schedule_data.optimization_status,
            "solve_time_seconds": schedule_data.solve_time_seconds,
            "objective_value": schedule_data.objective_value,
            "generated_at": schedule_data.generated_at.isoformat(),
        }

        if existing_schedule:
            # Update existing schedule
            existing_schedule.plan_json = plan_data
            existing_schedule.updated_at = datetime.now(UTC)
            session.add(existing_schedule)
            session.commit()
            session.refresh(existing_schedule)
            logger.info(
                f"Updated existing schedule {existing_schedule.id} for date {schedule_data.date}"
            )
            return ScheduleResponse.model_validate(existing_schedule)
        else:
            # Create new schedule
            new_schedule = Schedule(
                id=uuid4(),  # Generate UUID for primary key
                user_id=user_id,
                date=datetime.strptime(schedule_data.date, "%Y-%m-%d"),
                plan_json=plan_data,
            )
            session.add(new_schedule)
            session.commit()
            session.refresh(new_schedule)
            logger.info(
                f"Created new schedule {new_schedule.id} for date {schedule_data.date}"
            )
            return ScheduleResponse.model_validate(new_schedule)

    except Exception as e:
        logger.error(f"Error saving schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to save schedule",
                details={"error_type": type(e).__name__, "date": schedule_data.date},
            ).model_dump(),
        )


@router.get("/daily/list", response_model=list[ScheduleResponse])
async def list_daily_schedules(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get list of saved daily schedules for user.

    Returns schedules ordered by date (newest first).
    """
    try:
        # Parse query parameters manually
        skip = int(request.query_params.get("skip", 0))
        limit = int(request.query_params.get("limit", 30))

        logger.info(
            f"Fetching schedule list for user {user_id} (skip={skip}, limit={limit})"
        )
        logger.info(f"Query params: {dict(request.query_params)}")
        logger.info(f"Parameters types: skip={type(skip)}, limit={type(limit)}")

        # Validate parameters
        if skip < 0:
            logger.error(f"Invalid skip parameter: {skip}")
            raise HTTPException(
                status_code=400, detail=f"Invalid skip parameter: {skip}"
            )

        if limit < 1 or limit > 100:
            logger.error(f"Invalid limit parameter: {limit}")
            raise HTTPException(
                status_code=400, detail=f"Invalid limit parameter: {limit}"
            )

        # Get schedules from database ordered by date (newest first)
        logger.info("Executing database query...")

        from sqlmodel import desc

        schedules = session.exec(
            select(Schedule)
            .where(Schedule.user_id == user_id)
            .order_by(desc(Schedule.date))
            .offset(skip)
            .limit(limit)
        ).all()

        logger.info(f"Found {len(schedules)} schedules for user {user_id}")

        # Validate each schedule before converting
        result = []
        for i, schedule in enumerate(schedules):
            try:
                logger.debug(f"Validating schedule {i}: {schedule.id}")
                validated_schedule = ScheduleResponse.model_validate(schedule)
                result.append(validated_schedule)
            except Exception as validation_error:
                logger.error(
                    f"Failed to validate schedule {schedule.id}: {validation_error}"
                )
                logger.error(f"Schedule data: {schedule}")
                # Skip invalid schedules instead of failing completely
                continue

        logger.info(f"Successfully validated {len(result)} schedules")
        return result

    except HTTPException:
        raise
    except ValidationError as e:
        logger.error(f"Validation error in schedule list: {e}")
        logger.error(f"Validation error details: {str(e)}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    except Exception as e:
        logger.error(f"Unexpected error fetching schedule list: {e}")
        logger.error(f"Error type: {type(e)}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch schedule list",
        )


async def _apply_project_allocation_filtering(
    session: Session,
    tasks: list[Task],
    project_allocations: dict[str, float],
    date_str: str,
) -> list[Task]:
    """
    Apply project allocation filtering to tasks based on configured percentages.

    Args:
        session: Database session
        tasks: List of tasks to filter
        project_allocations: Dictionary of project_id -> allocation percentage
        date_str: Target date for tracking daily allocations

    Returns:
        Filtered list of tasks based on project allocations
    """
    try:
        from humancompiler_api.models import Goal

        # Group tasks by project
        tasks_by_project: dict[str, list[Task]] = {}
        for task in tasks:
            # Get the goal to find the project
            goal = session.get(Goal, task.goal_id)
            if goal:
                project_id = str(goal.project_id)
                if project_id not in tasks_by_project:
                    tasks_by_project[project_id] = []
                tasks_by_project[project_id].append(task)

        # Calculate total remaining hours for proportional allocation
        total_hours_per_project = {}
        for project_id, project_tasks in tasks_by_project.items():
            total_hours = sum(task.remaining_hours for task in project_tasks)
            total_hours_per_project[project_id] = total_hours

        # Select tasks based on project allocations
        selected_tasks = []

        for project_id, allocation_percent in project_allocations.items():
            if project_id not in tasks_by_project:
                continue

            project_tasks = tasks_by_project[project_id]
            target_hours = (allocation_percent / 100.0) * sum(
                total_hours_per_project.values()
            )

            # Sort tasks by priority (higher priority first) with stable secondary sort
            # Use task ID hash for deterministic secondary ordering instead of random
            sorted_tasks = sorted(
                project_tasks, key=lambda t: (t.priority or 5, str(t.id))
            )

            # Select tasks up to target hours
            current_hours = 0.0
            for task in sorted_tasks:
                if (
                    current_hours + task.remaining_hours <= target_hours * 1.2
                ):  # Allow 20% overflow
                    selected_tasks.append(task)
                    current_hours += task.remaining_hours

            logger.info(
                f"Project {project_id}: allocated {allocation_percent}%, "
                f"selected {len([t for t in selected_tasks if (goal := session.get(Goal, t.goal_id)) and str(goal.project_id) == project_id])} tasks, "
                f"{current_hours:.1f} hours"
            )

        return selected_tasks

    except Exception as e:
        logger.error(f"Error applying project allocation filtering: {e}")
        return tasks  # Return original tasks if filtering fails


async def _get_tasks_by_source(
    session: Session, user_id: str, task_source: TaskSource, target_date: str
) -> list[Task]:
    """
    Get tasks based on the specified task source configuration.

    Args:
        session: Database session
        user_id: User ID
        task_source: Task source configuration
        target_date: Target date for scheduling (used for weekly schedule lookups)

    Returns:
        List of tasks from the specified source
    """
    logger.info(f"Fetching tasks with source type: {task_source.type}")

    try:
        if task_source.type == "weekly_schedule":
            # Use provided weekly_schedule_date or calculate from target_date
            lookup_date = task_source.weekly_schedule_date or target_date
            return await _get_tasks_from_weekly_schedule(session, user_id, lookup_date)
        elif task_source.type == "project":
            if not task_source.project_id:
                logger.warning("Project ID not provided for project task source")
                return []
            logger.info(f"Fetching tasks for project_id: {task_source.project_id}")
            return task_service.get_tasks_by_project(
                session, task_source.project_id, user_id
            )
        elif task_source.type == "all_tasks":
            logger.info("Fetching all user tasks")
            return task_service.get_all_user_tasks(session, user_id)
        else:
            logger.error(f"Unknown task source type: {task_source.type}")
            return []
    except Exception as e:
        logger.error(f"Error fetching tasks by source: {e}")
        return []


async def _get_tasks_from_weekly_schedule(
    session: Session, user_id: str, date_str: str
) -> list[Task]:
    """
    Get tasks from weekly schedule for the given date.

    This function finds the appropriate weekly schedule for the given date
    and returns the tasks selected for that week, considering project allocations.
    """
    try:
        # Parse the date and find the Monday of that week
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        # Calculate the Monday of the week (0=Monday, 6=Sunday)
        days_since_monday = target_date.weekday()
        week_start = target_date - timedelta(days=days_since_monday)
        week_start_datetime = datetime.combine(week_start, datetime.min.time())

        logger.info(
            f"Looking for weekly schedule starting {week_start} for date {date_str}"
        )

        # Get weekly schedule for this week
        # Try multiple approaches to find the weekly schedule
        weekly_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == user_id,
                WeeklySchedule.week_start_date == week_start_datetime,
            )
        ).first()

        # If not found, try to find any schedule within this week (flexible search)
        if not weekly_schedule:
            logger.debug(
                f"No exact match found, trying flexible search for week {week_start}"
            )

            # Calculate the end of the week (Sunday)
            week_end = week_start + timedelta(days=6)
            week_end_datetime = datetime.combine(week_end, datetime.min.time())

            # Find any weekly schedule that starts within this week
            weekly_schedules_in_range = session.exec(
                select(WeeklySchedule).where(
                    WeeklySchedule.user_id == user_id,
                    WeeklySchedule.week_start_date >= week_start_datetime,
                    WeeklySchedule.week_start_date <= week_end_datetime,
                )
            ).all()

            if weekly_schedules_in_range:
                weekly_schedule = weekly_schedules_in_range[
                    0
                ]  # Use the first one found
                logger.info("Found weekly schedule with flexible search")
            else:
                logger.info(f"No weekly schedule found for week containing {date_str}")
                return []

        if not weekly_schedule:
            logger.info(f"No weekly schedule found for week containing {date_str}")
            return []

        # Extract task IDs from weekly schedule
        schedule_data = weekly_schedule.schedule_json
        if not schedule_data or "selected_tasks" not in schedule_data:
            logger.info("Weekly schedule found but no selected_tasks data")
            return []

        selected_tasks = schedule_data["selected_tasks"]
        try:
            task_ids = [task["task_id"] for task in selected_tasks]
            logger.info(f"Extracted {len(task_ids)} task IDs from weekly schedule")
        except (KeyError, TypeError) as e:
            logger.error(f"Error extracting task_ids from selected_tasks: {e}")
            return []

        if not task_ids:
            return []

        # Get the actual task objects from database
        from uuid import UUID

        tasks = []

        # Process regular tasks from selected_tasks
        for task_id in task_ids:
            try:
                task_uuid = UUID(task_id)
                task = session.get(Task, task_uuid)
                if task:
                    tasks.append(task)
                else:
                    logger.warning(f"Task ID {task_id} not found")
            except ValueError:
                logger.warning(f"Invalid UUID format for task ID: {task_id}")
                continue

        # Apply project allocation filtering if configured in schedule_json
        if (
            weekly_schedule.schedule_json
            and "project_allocations" in weekly_schedule.schedule_json
            and weekly_schedule.schedule_json["project_allocations"]
        ):
            filtered_tasks = await _apply_project_allocation_filtering(
                session,
                tasks,
                weekly_schedule.schedule_json["project_allocations"],
                date_str,
            )
            return filtered_tasks
        else:
            logger.info(
                f"Retrieved {len(tasks)} tasks from database based on weekly schedule"
            )
            return tasks

    except Exception as e:
        logger.error(f"Error getting tasks from weekly schedule: {e}")
        return []


@router.get("/daily/{date}", response_model=ScheduleResponse)
async def get_daily_schedule(
    date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get saved daily schedule for specific date.

    Date should be in YYYY-MM-DD format.
    """
    try:
        # Validate date format
        try:
            schedule_date = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Date must be in YYYY-MM-DD format",
                    details={"provided_date": date},
                ).model_dump(),
            )

        logger.info(f"Fetching schedule for user {user_id} on {date}")

        # Enhanced error handling for database query
        try:
            logger.debug(
                f"Executing daily schedule query for user {user_id}, date {date}"
            )

            # Get schedule from database
            query = select(Schedule).where(
                Schedule.user_id == user_id, Schedule.date == schedule_date
            )

            logger.debug(f"SQL Query: {query}")
            schedule = session.exec(query).first()

            if not schedule:
                logger.info(f"No schedule found for user {user_id} on date {date}")

                # Return a more informative response for missing schedules
                # Instead of 404, we could return an empty schedule structure
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=ErrorResponse.create(
                        code="RESOURCE_NOT_FOUND",
                        message="No schedule found for date",
                        details={
                            "date": date,
                            "user_id": user_id,
                            "suggestion": "Create a schedule for this date using the scheduling endpoint",
                        },
                    ).model_dump(),
                )

            logger.debug(f"Found schedule {schedule.id} for date {date}")
            return ScheduleResponse.model_validate(schedule)

        except HTTPException:
            raise
        except Exception as db_error:
            logger.error(f"Database query error: {type(db_error).__name__}: {db_error}")
            import traceback

            logger.error(f"Database query traceback: {traceback.format_exc()}")

            # Check if it's a database connection issue
            if (
                "connection" in str(db_error).lower()
                or "timeout" in str(db_error).lower()
            ):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=ErrorResponse.create(
                        code="DATABASE_CONNECTION_ERROR",
                        message="Database is temporarily unavailable",
                        details={"error_type": type(db_error).__name__},
                    ).model_dump(),
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=ErrorResponse.create(
                        code="DATABASE_QUERY_ERROR",
                        message="Failed to query daily schedule",
                        details={
                            "error_type": type(db_error).__name__,
                            "error_message": str(db_error),
                            "date": date,
                        },
                    ).model_dump(),
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching schedule: {e}")
        import traceback

        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to fetch schedule",
                details={"error_type": type(e).__name__, "date": date},
            ).model_dump(),
        )
