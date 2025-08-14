from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from taskagent_api.auth import AuthUser, get_current_user
from taskagent_api.database import db
from taskagent_api.models import (
    ErrorResponse,
    LogCreate,
    LogResponse,
    LogUpdate,
)
from taskagent_api.services import log_service

router = APIRouter(prefix="/logs", tags=["logs"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=LogResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def create_log(
    log_data: LogCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> LogResponse:
    """Create a new work time log"""
    log = log_service.create_log(session, log_data, current_user.user_id)
    return LogResponse.model_validate(log)


@router.get(
    "/batch",
    response_model=dict[str, list[LogResponse]],
    responses={
        400: {"model": ErrorResponse, "description": "Invalid task IDs"},
    },
)
async def get_logs_batch(
    task_ids: Annotated[str, Query(description="Comma-separated task IDs")],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict[str, list[LogResponse]]:
    """Get work time logs for multiple tasks in a single request"""
    # Parse comma-separated task IDs
    task_id_list = [tid.strip() for tid in task_ids.split(",") if tid.strip()]

    if not task_id_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorResponse.create(
                code="INVALID_REQUEST",
                message="No valid task IDs provided",
                details={"task_ids": task_ids},
            ).model_dump(),
        )

    # Limit the number of tasks to prevent abuse
    if len(task_id_list) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorResponse.create(
                code="TOO_MANY_TASKS",
                message="Maximum 100 tasks allowed per batch request",
                details={"task_count": len(task_id_list)},
            ).model_dump(),
        )

    # Get logs for all tasks efficiently
    result = log_service.get_logs_batch(
        session, task_id_list, current_user.user_id, skip, limit
    )

    # Convert to response model
    return {
        task_id: [LogResponse.model_validate(log) for log in logs]
        for task_id, logs in result.items()
    }


@router.get(
    "/task/{task_id}",
    response_model=list[LogResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def get_logs_by_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[LogResponse]:
    """Get work time logs for specific task"""
    logs = log_service.get_logs_by_task(
        session, task_id, current_user.user_id, skip, limit
    )
    return [LogResponse.model_validate(log) for log in logs]


@router.get(
    "/{log_id}",
    response_model=LogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Log not found"},
    },
)
async def get_log(
    log_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> LogResponse:
    """Get specific work time log"""
    log = log_service.get_log(session, log_id, current_user.user_id)
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Log not found",
                details={"log_id": log_id},
            ).model_dump(),
        )
    return LogResponse.model_validate(log)


@router.put(
    "/{log_id}",
    response_model=LogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Log not found"},
    },
)
async def update_log(
    log_id: str,
    log_data: LogUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> LogResponse:
    """Update specific work time log"""
    log = log_service.update_log(session, log_id, current_user.user_id, log_data)
    return LogResponse.model_validate(log)


@router.delete(
    "/{log_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Log not found"},
    },
)
async def delete_log(
    log_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific work time log"""
    log_service.delete_log(session, log_id, current_user.user_id)
