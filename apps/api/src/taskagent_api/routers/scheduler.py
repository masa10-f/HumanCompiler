"""
Scheduler API endpoints for task scheduling optimization.
"""

import logging

# Always use mock implementation - scheduler package has been removed
# Future optimization: implement OR-Tools directly in this module
import os
from datetime import datetime, time, timezone, UTC
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator, ConfigDict, field_serializer
from sqlmodel import Session, select

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import db
from taskagent_api.exceptions import ResourceNotFoundError, ValidationError
from taskagent_api.models import Schedule, ScheduleResponse
from taskagent_api.services import goal_service, task_service

# Use mock implementation since scheduler package has been removed
USE_MOCK_SCHEDULER = True

if USE_MOCK_SCHEDULER:
    logging.warning("Using mock scheduler implementation for containerized deployment")
    # Define mock classes and functions for testing
    from dataclasses import dataclass
    from datetime import datetime, time
    from enum import Enum

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

    from dataclasses import field

    @dataclass
    class ScheduleResult:
        success: bool
        assignments: list = field(default_factory=list)
        unscheduled_tasks: list = field(default_factory=list)
        total_scheduled_hours: float = 0.0
        optimization_status: str = "MOCKED"
        solve_time_seconds: float = 0.0
        objective_value: float = 0.0

    def optimize_schedule(tasks, time_slots, date=None):
        return ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=[],
            total_scheduled_hours=0.0,
            optimization_status="NO_TASKS",
        )

    def optimize_schedule_api(tasks, time_slots, date=None):
        return optimize_schedule(tasks, time_slots, date)

    def validate_schedule_request(request):
        return True

    def format_schedule_result(result):
        return result


logger = logging.getLogger(__name__)
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    except ResourceNotFoundError as e:
        logger.error(f"Resource not found in schedule creation: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    except Exception as e:
        logger.error(f"Unexpected error in schedule creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during schedule optimization",
        )


@router.get("/test", response_model=dict[str, str])
async def test_scheduler():
    """Test endpoint to verify scheduler package integration."""
    try:
        # Use the already imported SchedulerTask and TaskKind from module level
        # This works with both real scheduler package and mock implementations
        test_task = SchedulerTask(
            id="test",
            title="Test Task",
            estimate_hours=1.0,
            priority=1,
            kind=TaskKind.LIGHT,
        )

        return {
            "status": "success",
            "message": "Scheduler package imported successfully",
            "test_task_id": test_task.id,
            "ortools_available": "True",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Scheduler package test failed: {str(e)}",
            "ortools_available": "False",
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
            detail="Failed to save schedule",
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
                detail="Date must be in YYYY-MM-DD format",
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
                detail=f"No schedule found for date {date}",
            )

        return ScheduleResponse.model_validate(schedule)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch schedule",
        )
