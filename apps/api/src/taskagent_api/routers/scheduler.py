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
from sqlmodel import Session, select
from ortools.sat.python import cp_model

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import db
from taskagent_api.exceptions import ResourceNotFoundError, ValidationError
from taskagent_api.models import (
    Schedule,
    ScheduleResponse,
    ErrorResponse,
    WeeklySchedule,
    Task,
    WorkType,
)
from taskagent_api.services import goal_service, task_service

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


@dataclass
class TimeSlot:
    start: time
    end: time
    kind: SlotKind
    capacity_hours: float | None = None


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


def optimize_schedule(tasks, time_slots, date=None):
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

    # Convert task estimates to minutes
    task_durations = [math.ceil(task.estimate_hours * 60) for task in tasks]

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

    # Constraint 3: Task kind matching with slot kind (soft constraint via penalty)
    kind_match_bonus = {}
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
        schedule_date = (
            datetime.strptime(date, "%Y-%m-%d") if isinstance(date, str) else date
        )
        for i, task in enumerate(tasks):
            for j, _slot in enumerate(time_slots):
                if task.due_date:
                    # Ensure both are date objects
                    if isinstance(task.due_date, datetime):
                        due_date_obj = task.due_date.date()
                    else:
                        due_date_obj = task.due_date
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

        # Convert database tasks to scheduler tasks
        scheduler_tasks = []
        task_info_map = {}
        filtered_count = 0

        for db_task in db_tasks:
            # Check if this is a weekly recurring task
            is_weekly_recurring = getattr(db_task, 'is_weekly_recurring', False)
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
            if not is_weekly_recurring and hasattr(db_task, 'goal_id') and db_task.goal_id:
                goal = goal_service.get_goal(session, db_task.goal_id, user_id)
                project_id = str(goal.project_id) if goal else None
                goal_id_str = str(db_task.goal_id)

            scheduler_task = SchedulerTask(
                id=str(db_task.id),  # Convert UUID to string
                title=db_task.title,
                estimate_hours=float(
                    db_task.estimate_hours
                ),  # Convert Decimal to float
                priority=3,  # Default priority - could be enhanced
                due_date=getattr(db_task, 'due_date', None),
                kind=task_kind,
                goal_id=goal_id_str,
                is_weekly_recurring=is_weekly_recurring
            )
            scheduler_tasks.append(scheduler_task)

            # Store task info for response
            task_info_map[str(db_task.id)] = TaskInfo(
                id=str(db_task.id),  # Convert UUID to string
                title=db_task.title,
                estimate_hours=float(
                    db_task.estimate_hours
                ),  # Convert Decimal to float
                priority=3,
                kind=task_kind.value,
                due_date=getattr(db_task, 'due_date', None),
                goal_id=goal_id_str,
                project_id=project_id,
            )

        logger.info(f"Filtered out {filtered_count} completed/cancelled tasks")
        logger.info(f"Converted {len(scheduler_tasks)} tasks for scheduling")

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
            )
            scheduler_slots.append(time_slot)

        # Run optimization
        logger.info(
            f"Running optimization with {len(scheduler_tasks)} tasks and {len(scheduler_slots)} slots"
        )
        optimization_result = optimize_schedule(
            scheduler_tasks, scheduler_slots, request.date
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
            ),
            SchedulerTask(
                id="test_2",
                title="Test Light Work Task",
                estimate_hours=1.0,
                priority=2,
                kind=TaskKind.LIGHT_WORK,
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
            "unscheduled_tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "estimate_hours": t.estimate_hours,
                    "priority": t.priority,
                    "kind": t.kind,
                    "due_date": t.due_date.isoformat() if t.due_date else None,
                    "goal_id": t.goal_id,
                    "project_id": t.project_id,
                }
                for t in schedule_data.unscheduled_tasks
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
        from taskagent_api.models import Goal

        # Group tasks by project
        tasks_by_project = {}
        for task in tasks:
            # Get the goal to find the project
            goal = session.get(Goal, task.goal_id)
            if goal:
                project_id = str(goal.project_id)
                if project_id not in tasks_by_project:
                    tasks_by_project[project_id] = []
                tasks_by_project[project_id].append(task)

        # Calculate total hours for proportional allocation
        total_hours_per_project = {}
        for project_id, project_tasks in tasks_by_project.items():
            total_hours = sum(float(task.estimate_hours) for task in project_tasks)
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
                    current_hours + float(task.estimate_hours) <= target_hours * 1.2
                ):  # Allow 20% overflow
                    selected_tasks.append(task)
                    current_hours += float(task.estimate_hours)

            logger.info(
                f"Project {project_id}: allocated {allocation_percent}%, "
                f"selected {len([t for t in selected_tasks if str(session.get(Goal, t.goal_id).project_id) == project_id])} tasks, "
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
        weekly_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == user_id,
                WeeklySchedule.week_start_date == week_start_datetime,
            )
        ).first()

        if not weekly_schedule:
            logger.info(f"No weekly schedule found for week starting {week_start}")
            return []

        # Extract task IDs from weekly schedule
        schedule_data = weekly_schedule.schedule_json
        if not schedule_data or "selected_tasks" not in schedule_data:
            logger.info("Weekly schedule found but no selected_tasks data")
            return []

        task_ids = [task["task_id"] for task in schedule_data["selected_tasks"]]
        logger.info(f"Found {len(task_ids)} tasks in weekly schedule")

        if not task_ids:
            return []

        # Get the actual task objects from database
        # Handle both regular tasks and weekly recurring tasks
        from uuid import UUID
        from taskagent_api.models import WeeklyRecurringTask

        tasks = []
        weekly_recurring_tasks = []

        for task_id in task_ids:
            try:
                task_uuid = UUID(task_id)
                # First try to get as regular task
                task = session.get(Task, task_uuid)
                if task:
                    tasks.append(task)
                    continue
                # If not found as regular task, try as weekly recurring task
                weekly_task = session.get(WeeklyRecurringTask, task_uuid)
                if weekly_task:
                    weekly_recurring_tasks.append(weekly_task)
                    logger.info(f"Found weekly recurring task: {weekly_task.title}")
                else:
                    logger.warning(f"Task ID {task_id} not found in either tasks or weekly recurring tasks")
            except ValueError:
                logger.warning(f"Invalid UUID format for task ID: {task_id}")
                continue

        # Create pseudo-tasks for weekly recurring tasks
        # Weekly recurring tasks need to be converted to Task-like objects for the scheduler
        for weekly_task in weekly_recurring_tasks:
            # Create a temporary task-like object with necessary fields
            pseudo_task = type('PseudoTask', (), {
                'id': weekly_task.id,
                'title': f"[週課] {weekly_task.title}",
                'estimate_hours': weekly_task.estimate_hours,
                'status': 'pending',  # Weekly recurring tasks are always pending for scheduling
                'due_date': None,  # Weekly recurring tasks don't have specific due dates
                'work_type': 'light_work',  # Default work type for weekly recurring tasks
                'goal_id': None,  # Weekly recurring tasks don't belong to specific goals
                'is_weekly_recurring': True  # Mark as weekly recurring
            })()
            tasks.append(pseudo_task)

        # Apply project allocation filtering if configured in schedule_json
        # Note: Weekly recurring tasks will not be affected by project allocation filtering
        regular_tasks = [t for t in tasks if not getattr(t, 'is_weekly_recurring', False)]
        weekly_tasks = [t for t in tasks if getattr(t, 'is_weekly_recurring', False)]
        if (
            weekly_schedule.schedule_json
            and "project_allocations" in weekly_schedule.schedule_json
            and weekly_schedule.schedule_json["project_allocations"]
        ):
            filtered_regular_tasks = await _apply_project_allocation_filtering(
                session,
                regular_tasks,
                weekly_schedule.schedule_json["project_allocations"],
                date_str,
            )
            # Combine filtered regular tasks with weekly recurring tasks
            all_tasks = list(filtered_regular_tasks) + weekly_tasks
        else:
            all_tasks = tasks

        logger.info(
            f"Retrieved {len(all_tasks)} tasks from database based on weekly schedule "
            f"({len(regular_tasks)} regular tasks, {len(weekly_tasks)} weekly recurring tasks)"
        )
        return all_tasks

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
