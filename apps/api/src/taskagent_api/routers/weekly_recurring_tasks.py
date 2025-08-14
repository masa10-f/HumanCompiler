from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from taskagent_api.auth import AuthUser, get_current_user
from taskagent_api.database import db
from taskagent_api.models import (
    ErrorResponse,
    TaskCategory,
    WeeklyRecurringTaskCreate,
    WeeklyRecurringTaskResponse,
    WeeklyRecurringTaskUpdate,
)
from taskagent_api.services import weekly_recurring_task_service

router = APIRouter(prefix="/weekly-recurring-tasks", tags=["weekly-recurring-tasks"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=WeeklyRecurringTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_weekly_recurring_task(
    task_data: WeeklyRecurringTaskCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WeeklyRecurringTaskResponse:
    """Create a new weekly recurring task"""
    task = weekly_recurring_task_service.create_weekly_recurring_task(
        session, task_data, current_user.user_id
    )
    return WeeklyRecurringTaskResponse.model_validate(task)


@router.get(
    "/",
    response_model=list[WeeklyRecurringTaskResponse],
)
async def get_weekly_recurring_tasks(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    category: Annotated[TaskCategory | None, Query()] = None,
    is_active: Annotated[bool | None, Query()] = None,
) -> list[WeeklyRecurringTaskResponse]:
    """Get weekly recurring tasks for current user"""
    tasks = weekly_recurring_task_service.get_weekly_recurring_tasks(
        session, current_user.user_id, skip, limit, category, is_active
    )
    return [WeeklyRecurringTaskResponse.model_validate(task) for task in tasks]


@router.get(
    "/{task_id}",
    response_model=WeeklyRecurringTaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Weekly recurring task not found"},
    },
)
async def get_weekly_recurring_task(
    task_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WeeklyRecurringTaskResponse:
    """Get specific weekly recurring task"""
    task = weekly_recurring_task_service.get_weekly_recurring_task(
        session, task_id, current_user.user_id
    )
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Weekly recurring task not found",
                details={"task_id": task_id},
            ).model_dump(),
        )
    return WeeklyRecurringTaskResponse.model_validate(task)


@router.put(
    "/{task_id}",
    response_model=WeeklyRecurringTaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Weekly recurring task not found"},
    },
)
async def update_weekly_recurring_task(
    task_id: UUID,
    task_data: WeeklyRecurringTaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WeeklyRecurringTaskResponse:
    """Update specific weekly recurring task"""
    task = weekly_recurring_task_service.update_weekly_recurring_task(
        session, task_id, current_user.user_id, task_data
    )
    return WeeklyRecurringTaskResponse.model_validate(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Weekly recurring task not found"},
    },
)
async def delete_weekly_recurring_task(
    task_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific weekly recurring task"""
    weekly_recurring_task_service.delete_weekly_recurring_task(
        session, task_id, current_user.user_id
    )
