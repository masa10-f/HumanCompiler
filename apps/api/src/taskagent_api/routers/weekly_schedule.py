"""
Weekly schedule API endpoints for storing and retrieving weekly task selections.
"""

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

        # Parse and validate week start date
        try:
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Week start date must be in YYYY-MM-DD format",
                    details={"provided_date": request.week_start_date},
                ).model_dump(),
            )

        # Check if weekly schedule already exists
        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        existing_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
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
                status_code=400, detail=f"Invalid skip parameter: {skip}"
            )

        if limit < 1 or limit > 100:
            raise HTTPException(
                status_code=400, detail=f"Invalid limit parameter: {limit}"
            )

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Get schedules from database ordered by week start date (newest first)
        schedules = session.exec(
            select(WeeklySchedule)
            .where(WeeklySchedule.user_id == user_uuid)
            .order_by(WeeklySchedule.week_start_date.desc())
            .offset(skip)
            .limit(limit)
        ).all()

        logger.info(f"Found {len(schedules)} weekly schedules for user {user_id}")

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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch weekly schedule list",
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
        try:
            week_start = datetime.strptime(week_start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Week start date must be in YYYY-MM-DD format",
                    details={"provided_date": week_start_date},
                ).model_dump(),
            )

        logger.info(
            f"Fetching weekly schedule for user {user_id} for week {week_start_date}"
        )

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Get schedule from database
        schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
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
        try:
            week_start = datetime.strptime(week_start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Week start date must be in YYYY-MM-DD format",
                    details={"provided_date": week_start_date},
                ).model_dump(),
            )

        logger.info(
            f"Deleting weekly schedule for user {user_id} for week {week_start_date}"
        )

        # Convert user_id to UUID if it's a string
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id

        # Get schedule from database
        schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == user_uuid,
                WeeklySchedule.week_start_date == week_start,
            )
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
