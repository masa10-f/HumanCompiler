# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
QuickTask API endpoints for unclassified tasks not belonging to any project.
"""

import logging
from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    QuickTaskCreate,
    QuickTaskResponse,
    QuickTaskUpdate,
    QuickTaskConvertRequest,
    TaskResponse,
    TaskStatus,
    SortBy,
    SortOrder,
)
from humancompiler_api.services import quick_task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quick-tasks", tags=["quick-tasks"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=QuickTaskResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request"},
    },
)
@router.post(
    "",  # Handle requests without trailing slash
    response_model=QuickTaskResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request"},
    },
)
async def create_quick_task(
    task_data: QuickTaskCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> QuickTaskResponse:
    """Create a new quick task (unclassified task not belonging to any project)"""
    logger.info(f"📋 Creating quick task for user {current_user.user_id}")

    try:
        task = quick_task_service.create_quick_task(
            session, task_data, current_user.user_id
        )
        logger.info(f"✅ Created quick task {task.id}")
        return QuickTaskResponse.model_validate(task)
    except Exception as e:
        logger.error(f"❌ Error creating quick task: {type(e).__name__}: {e}")
        raise


@router.get(
    "/",
    response_model=list[QuickTaskResponse],
)
@router.get(
    "",  # Handle requests without trailing slash
    response_model=list[QuickTaskResponse],
    include_in_schema=False,
)
async def get_quick_tasks(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    sort_by: Annotated[SortBy, Query()] = SortBy.CREATED_AT,
    sort_order: Annotated[SortOrder, Query()] = SortOrder.DESC,
    task_status: Annotated[TaskStatus | None, Query(alias="status")] = None,
) -> list[QuickTaskResponse]:
    """Get all quick tasks for current user with optional filtering and sorting"""
    logger.debug(
        f"Fetching quick tasks for user {current_user.user_id}, "
        f"skip={skip}, limit={limit}, status={task_status}"
    )

    tasks = quick_task_service.get_quick_tasks(
        session,
        current_user.user_id,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order,
        status=task_status,
    )
    return [QuickTaskResponse.model_validate(task) for task in tasks]


@router.get(
    "/{task_id}",
    response_model=QuickTaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Quick task not found"},
    },
)
async def get_quick_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> QuickTaskResponse:
    """Get specific quick task"""
    task = quick_task_service.get_quick_task(session, task_id, current_user.user_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Quick task not found",
                details={"task_id": task_id},
            ).model_dump(),
        )
    return QuickTaskResponse.model_validate(task)


@router.put(
    "/{task_id}",
    response_model=QuickTaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Quick task not found"},
    },
)
async def update_quick_task(
    task_id: str,
    task_data: QuickTaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> QuickTaskResponse:
    """Update specific quick task"""
    task = quick_task_service.update_quick_task(
        session, task_id, current_user.user_id, task_data
    )
    return QuickTaskResponse.model_validate(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Quick task not found"},
    },
)
async def delete_quick_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific quick task"""
    quick_task_service.delete_quick_task(session, task_id, current_user.user_id)


@router.post(
    "/{task_id}/convert",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Quick task or goal not found"},
    },
)
async def convert_quick_task_to_task(
    task_id: str,
    convert_data: QuickTaskConvertRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Convert a quick task to a regular task by assigning it to a goal.

    This will:
    1. Create a new regular task with the quick task's data
    2. Delete the original quick task
    """
    logger.info(
        f"📋 Converting quick task {task_id} to regular task for user {current_user.user_id}"
    )

    try:
        new_task = quick_task_service.convert_to_task(
            session, task_id, convert_data.goal_id, current_user.user_id
        )
        logger.info(f"✅ Converted quick task {task_id} to task {new_task.id}")
        return TaskResponse.model_validate(new_task)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error converting quick task: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="CONVERSION_ERROR",
                message="Failed to convert quick task",
                details={"task_id": task_id, "error": str(e)},
            ).model_dump(),
        )
