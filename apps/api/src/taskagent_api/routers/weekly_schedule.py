"""
Weekly schedule API endpoints for storing and retrieving weekly task selections.
"""

import json
import logging
from datetime import datetime, date
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from pydantic import BaseModel, Field

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import db
from taskagent_api.exceptions import ResourceNotFoundError, ValidationError
from taskagent_api.models import (
    WeeklySchedule,
    WeeklyScheduleCreate,
    WeeklyScheduleUpdate,
    WeeklyScheduleResponse,
    ErrorResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/weekly-schedule", tags=["weekly-schedule"])


class WeeklyScheduleSaveRequest(BaseModel):
    """Request to save weekly schedule data."""

    week_start_date: str = Field(
        ..., description="Week start date in YYYY-MM-DD format"
    )
    schedule_data: dict = Field(
        ..., description="Weekly schedule data including selected tasks"
    )


def validate_week_start_date(date_str: str) -> datetime:
    """
    Validate and parse week start date.

    Args:
        date_str: Date string in YYYY-MM-DD format

    Returns:
        Parsed datetime object

    Raises:
        HTTPException: If date format is invalid
    """
    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorResponse.create(
                code="INVALID_DATE_FORMAT",
                message="Week start date must be in YYYY-MM-DD format",
                details={"provided_date": date_str},
            ).model_dump(),
        )

    # Accept any day of the week as week start date
    logger.info(
        f"Week start date validated: {date_str} (weekday: {parsed_date.weekday()})"
    )

    return parsed_date


@router.post("/save", response_model=WeeklyScheduleResponse)
async def save_weekly_schedule(
    request: WeeklyScheduleSaveRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Save weekly schedule to database.

    This endpoint stores the weekly task selection result for later retrieval
    and integration with daily scheduling.
    """
    try:
        logger.info(
            f"Saving weekly schedule for user {user_id} for week {request.week_start_date}"
        )
        logger.debug(f"Request data: {request}")
        logger.debug(f"Schedule data type: {type(request.schedule_data)}")
        logger.debug(
            f"Schedule data content: {json.dumps(request.schedule_data, default=str, indent=2)}"
        )

        # Parse and validate week start date
        week_start = validate_week_start_date(request.week_start_date)

        # Check if weekly schedule already exists
        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        existing_schedule = session.exec(
            select(WeeklySchedule)
            .where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
            .limit(1)
        ).first()

        if existing_schedule:
            # Update existing schedule
            existing_schedule.schedule_json = request.schedule_data
            existing_schedule.updated_at = datetime.now()
            session.add(existing_schedule)
            session.commit()
            session.refresh(existing_schedule)
            logger.info(f"Updated existing weekly schedule {existing_schedule.id}")
            return WeeklyScheduleResponse.model_validate(existing_schedule)
        else:
            # Create new schedule
            new_schedule = WeeklySchedule(
                id=uuid4(),
                user_id=user_uuid,
                week_start_date=week_start,
                schedule_json=request.schedule_data,
            )
            session.add(new_schedule)
            session.commit()
            session.refresh(new_schedule)
            logger.info(f"Created new weekly schedule {new_schedule.id}")
            return WeeklyScheduleResponse.model_validate(new_schedule)

    except Exception as e:
        logger.error(f"Error saving weekly schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to save weekly schedule",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.get("/list", response_model=list[WeeklyScheduleResponse])
async def list_weekly_schedules(
    skip: int = 0,
    limit: int = 30,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get list of saved weekly schedules for user.

    Returns schedules ordered by week start date (newest first).
    """
    try:
        logger.info(
            f"Fetching weekly schedule list for user {user_id} (skip={skip}, limit={limit})"
        )

        # Validate parameters
        if skip < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_SKIP_PARAMETER",
                    message="Skip parameter must be non-negative",
                    details={"provided_skip": skip, "minimum_value": 0},
                ).model_dump(),
            )

        if limit < 1 or limit > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_LIMIT_PARAMETER",
                    message="Limit parameter must be between 1 and 100",
                    details={"provided_limit": limit, "valid_range": "1-100"},
                ).model_dump(),
            )

        # Convert user_id to UUID if it's a string
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

        # Enhanced error handling for database query
        try:
            logger.debug(f"Executing weekly schedules query for user {user_uuid}")

            # Get schedules from database ordered by week start date (newest first)
            query = (
                select(WeeklySchedule)
                .where(WeeklySchedule.user_id == user_uuid)
                .order_by(WeeklySchedule.week_start_date.desc())
                .offset(skip)
                .limit(limit)
            )

            logger.debug(f"SQL Query: {query}")
            schedules = session.exec(query).all()

            logger.info(f"Found {len(schedules)} weekly schedules for user {user_id}")

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
                        message="Failed to query weekly schedules",
                        details={
                            "error_type": type(db_error).__name__,
                            "error_message": str(db_error),
                        },
                    ).model_dump(),
                )

        # Convert to response models
        result = []
        for schedule in schedules:
            try:
                validated_schedule = WeeklyScheduleResponse.model_validate(schedule)
                result.append(validated_schedule)
            except Exception as validation_error:
                logger.error(
                    f"Failed to validate weekly schedule {schedule.id}: {validation_error}"
                )
                continue

        logger.info(f"Successfully validated {len(result)} weekly schedules")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error fetching weekly schedule list: {e}")
        import traceback

        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to fetch weekly schedule list",
                details={"error_type": type(e).__name__, "user_id": user_id},
            ).model_dump(),
        )


@router.get("/{week_start_date}", response_model=WeeklyScheduleResponse)
async def get_weekly_schedule(
    week_start_date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get saved weekly schedule for specific week.

    Week start date should be in YYYY-MM-DD format.
    """
    try:
        # Validate date format
        week_start = validate_week_start_date(week_start_date)

        logger.info(
            f"Fetching weekly schedule for user {user_id} for week {week_start_date}"
        )

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Get schedule from database
        schedule = session.exec(
            select(WeeklySchedule)
            .where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
            .limit(1)
        ).first()

        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="No weekly schedule found for week",
                    details={"week_start_date": week_start_date, "user_id": user_id},
                ).model_dump(),
            )

        return WeeklyScheduleResponse.model_validate(schedule)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching weekly schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to fetch weekly schedule",
                details={
                    "error_type": type(e).__name__,
                    "week_start_date": week_start_date,
                },
            ).model_dump(),
        )


@router.delete("/{week_start_date}")
async def delete_weekly_schedule(
    week_start_date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Delete saved weekly schedule for specific week.

    Week start date should be in YYYY-MM-DD format.
    """
    try:
        # Validate date format
        week_start = validate_week_start_date(week_start_date)

        logger.info(
            f"Deleting weekly schedule for user {user_id} for week {week_start_date}"
        )

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Get schedule from database
        schedule = session.exec(
            select(WeeklySchedule)
            .where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
            .limit(1)
        ).first()

        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="No weekly schedule found for week",
                    details={"week_start_date": week_start_date, "user_id": user_id},
                ).model_dump(),
            )

        session.delete(schedule)
        session.commit()
        logger.info(f"Deleted weekly schedule {schedule.id}")

        return {"message": "Weekly schedule deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting weekly schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to delete weekly schedule",
                details={
                    "error_type": type(e).__name__,
                    "week_start_date": week_start_date,
                },
            ).model_dump(),
        )
