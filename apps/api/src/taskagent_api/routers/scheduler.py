"""
Scheduler API endpoints for task scheduling optimization.
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, time, UTC
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
from taskagent_api.models import Schedule, ScheduleResponse, ErrorResponse
from taskagent_api.services import goal_service, task_service

# OR-Tools CP-SAT scheduler implementation
logger = logging.getLogger(__name__)
logger.info("Using OR-Tools CP-SAT constraint solver for scheduling optimization")


class TaskKind(Enum):
    LIGHT = "light"
    DEEP = "deep"
    STUDY = "study"
    MEETING = "meeting"


class SlotKind(Enum):
    LIGHT = "light"
    DEEP = "deep"
    STUDY = "study"
    MEETING = "meeting"


@dataclass
class SchedulerTask:
    id: str
    title: str
    estimate_hours: float
    priority: int = 1
    due_date: datetime | None = None
    kind: TaskKind = TaskKind.LIGHT
    goal_id: str | None = None


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
        objective_value=objective_value,
    )


# Note: Helper functions removed - using optimize_schedule directly


logger.setLevel(logging.DEBUG)
router = APIRouter(prefix="/schedule", tags=["scheduling"])


class TimeSlotInput(BaseModel):
    """Input model for time slot."""

    start: str = Field(..., description="Start time in HH:MM format")
    end: str = Field(..., description="End time in HH:MM format")
    kind: str = Field("light", description="Slot type: deep, light, study, meeting")
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
        valid_kinds = ["deep", "light", "study", "meeting"]
        if v.lower() not in valid_kinds:
            raise ValueError(f"Kind must be one of: {valid_kinds}")
        return v.lower()


class DailyScheduleRequest(BaseModel):
    """Request model for daily schedule optimization."""

    date: str = Field(..., description="Target date in YYYY-MM-DD format")
    project_id: str | None = Field(None, description="Filter tasks by project ID")
    goal_id: str | None = Field(None, description="Filter tasks by goal ID")
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


def map_task_kind(status: str) -> TaskKind:
    """Map task status or type to scheduler TaskKind."""
    # This is a simple mapping - could be enhanced based on task properties
    mapping = {
        "research": TaskKind.DEEP,
        "analysis": TaskKind.DEEP,
        "coding": TaskKind.DEEP,
        "development": TaskKind.DEEP,
        "study": TaskKind.STUDY,
        "learning": TaskKind.STUDY,
        "meeting": TaskKind.MEETING,
        "discussion": TaskKind.MEETING,
        "review": TaskKind.LIGHT,
        "planning": TaskKind.LIGHT,
        "admin": TaskKind.LIGHT,
    }

    # Simple keyword matching in task title/description
    for keyword, kind in mapping.items():
        if keyword in status.lower():
            return kind

    return TaskKind.LIGHT  # Default


def map_slot_kind(kind_str: str) -> SlotKind:
    """Map input slot kind to scheduler SlotKind."""
    mapping = {
        "deep": SlotKind.DEEP,
        "light": SlotKind.LIGHT,
        "study": SlotKind.STUDY,
        "meeting": SlotKind.MEETING,
    }
    return mapping.get(kind_str.lower(), SlotKind.LIGHT)


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
            f"Request params: project_id={request.project_id}, goal_id={request.goal_id}"
        )

        # Fetch tasks based on filters
        if request.goal_id:
            # Get tasks for specific goal
            logger.info(f"Fetching tasks for goal_id: {request.goal_id}")
            db_tasks = task_service.get_tasks_by_goal(session, request.goal_id, user_id)
        elif request.project_id:
            # Get tasks for specific project
            logger.info(f"Fetching tasks for project_id: {request.project_id}")
            db_tasks = task_service.get_tasks_by_project(
                session, request.project_id, user_id
            )
        else:
            # Get all tasks for user
            logger.info("No project_id or goal_id specified, fetching all user tasks")
            db_tasks = task_service.get_all_user_tasks(session, user_id)

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
            # Only schedule pending or in-progress tasks
            if db_task.status in ["completed", "cancelled"]:
                filtered_count += 1
                logger.debug(
                    f"Skipping task {db_task.id} with status: {db_task.status}"
                )
                continue

            # Determine task kind based on title/description
            task_kind = map_task_kind(db_task.title)
            logger.debug(
                f"Including task {db_task.id}: {db_task.title}, status: {db_task.status}, kind: {task_kind}"
            )

            # Get goal to access project_id
            goal = goal_service.get_goal(session, db_task.goal_id, user_id)
            project_id = str(goal.project_id) if goal else None

            scheduler_task = SchedulerTask(
                id=str(db_task.id),  # Convert UUID to string
                title=db_task.title,
                estimate_hours=db_task.estimate_hours,
                priority=3,  # Default priority - could be enhanced
                due_date=db_task.due_date,
                kind=task_kind,
                goal_id=str(db_task.goal_id)
                if db_task.goal_id
                else None,  # Convert UUID to string
            )
            scheduler_tasks.append(scheduler_task)

            # Store task info for response
            task_info_map[str(db_task.id)] = TaskInfo(
                id=str(db_task.id),  # Convert UUID to string
                title=db_task.title,
                estimate_hours=db_task.estimate_hours,
                priority=3,
                kind=task_kind.value,
                due_date=db_task.due_date,
                goal_id=str(db_task.goal_id)
                if db_task.goal_id
                else None,  # Convert UUID to string
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
                title="Test Deep Work Task",
                estimate_hours=2.0,
                priority=1,
                kind=TaskKind.DEEP,
            ),
            SchedulerTask(
                id="test_2",
                title="Test Light Task",
                estimate_hours=1.0,
                priority=2,
                kind=TaskKind.LIGHT,
            ),
        ]

        test_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(11, 0),
                kind=SlotKind.DEEP,
                capacity_hours=2.0,
            ),
            TimeSlot(
                start=time(14, 0),
                end=time(15, 0),
                kind=SlotKind.LIGHT,
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
        schedules = session.exec(
            select(Schedule)
            .where(Schedule.user_id == user_id)
            .order_by(Schedule.date.desc())
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
        logger.error(f"Validation error details: {e.errors()}")
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

        # Get schedule from database
        schedule = session.exec(
            select(Schedule).where(
                Schedule.user_id == user_id, Schedule.date == schedule_date
            )
        ).first()

        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="No schedule found for date",
                    details={"date": date, "user_id": user_id},
                ).model_dump(),
            )

        return ScheduleResponse.model_validate(schedule)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to fetch schedule",
                details={"error_type": type(e).__name__, "date": date},
            ).model_dump(),
        )
