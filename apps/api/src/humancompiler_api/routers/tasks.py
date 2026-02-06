import logging
from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
    TaskDependencyCreate,
    TaskDependencyResponse,
    TaskDependencyTaskInfo,
    SortBy,
    SortOrder,
)
from humancompiler_api.services import task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
@router.post(
    "",  # Handle requests without trailing slash
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,  # Don't duplicate in OpenAPI schema
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def create_task(
    task_data: TaskCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Create a new task"""
    import time

    start_time = time.time()
    logger.info(
        f"📋 Creating task for user {current_user.user_id}, goal {task_data.goal_id}"
    )

    try:
        logger.info(
            f"🔍 [TASKS] About to call task_service.create_task with user_id: {current_user.user_id}, goal_id: {task_data.goal_id}"
        )
        db_start = time.time()
        task = task_service.create_task(session, task_data, current_user.user_id)
        db_time = time.time() - db_start
        logger.info(f"✅ [TASKS] Successfully created task {task.id} in {db_time:.3f}s")

        response_start = time.time()
        result = TaskResponse.model_validate(task)
        response_time = time.time() - response_start

        total_time = time.time() - start_time
        logger.info(
            f"✅ Created task {task.id} | DB: {db_time:.3f}s | Response: {response_time:.3f}s | Total: {total_time:.3f}s"
        )

        return result
    except Exception as e:
        logger.error(f"❌ [TASKS] Error creating task: {type(e).__name__}: {e}")
        logger.error(f"❌ [TASKS] User ID was: {current_user.user_id}")
        logger.error(f"❌ [TASKS] Task data: {task_data}")
        import traceback

        logger.error(f"❌ [TASKS] Traceback: {traceback.format_exc()}")
        raise


@router.get(
    "/goal/{goal_id}",
    response_model=list[TaskResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def get_tasks_by_goal(
    goal_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    sort_by: Annotated[SortBy, Query()] = SortBy.STATUS,
    sort_order: Annotated[SortOrder, Query()] = SortOrder.ASC,
) -> list[TaskResponse]:
    """Get tasks for specific goal"""
    tasks = task_service.get_tasks_by_goal(
        session, goal_id, current_user.user_id, skip, limit, sort_by, sort_order
    )
    if not tasks:
        return []

    # Batch-load all dependencies for all tasks in 2 queries (deps + depends_on tasks)
    task_ids = [task.id for task in tasks]
    deps_by_task = task_service.get_task_dependencies_batch(
        session, task_ids, current_user.user_id
    )

    task_responses = []
    for task in tasks:
        task_response = TaskResponse.model_validate(task)

        # Use pre-loaded dependencies
        dependencies = deps_by_task.get(str(task.id), [])
        dependency_responses = []
        for dep in dependencies:
            dep_response = TaskDependencyResponse.model_validate(dep)
            if dep.depends_on_task:
                dep_response.depends_on_task = TaskDependencyTaskInfo.model_validate(
                    dep.depends_on_task
                )
            dependency_responses.append(dep_response)

        task_response.dependencies = dependency_responses
        task_responses.append(task_response)

    return task_responses


@router.get(
    "/project/{project_id}",
    response_model=list[TaskResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def get_tasks_by_project(
    project_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    sort_by: Annotated[SortBy, Query()] = SortBy.STATUS,
    sort_order: Annotated[SortOrder, Query()] = SortOrder.ASC,
) -> list[TaskResponse]:
    """Get all tasks for specific project"""
    tasks = task_service.get_tasks_by_project(
        session, project_id, current_user.user_id, skip, limit, sort_by, sort_order
    )
    return [TaskResponse.model_validate(task) for task in tasks]


@router.get(
    "/{task_id}",
    response_model=TaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def get_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Get specific task"""
    task = task_service.get_task(session, task_id, current_user.user_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Task not found",
                details={"task_id": task_id},
            ).model_dump(),
        )
    # Get dependencies for the task
    task_response = TaskResponse.model_validate(task)
    dependencies = task_service.get_task_dependencies(
        session, task_id, current_user.user_id
    )
    task_response.dependencies = [
        TaskDependencyResponse.model_validate(dep) for dep in dependencies
    ]
    return task_response


@router.put(
    "/{task_id}",
    response_model=TaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def update_task(
    task_id: str,
    task_data: TaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Update specific task"""
    task = task_service.update_task(session, task_id, current_user.user_id, task_data)
    return TaskResponse.model_validate(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def delete_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific task"""
    task_service.delete_task(session, task_id, current_user.user_id)


@router.post(
    "/{task_id}/dependencies",
    response_model=TaskDependencyResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        400: {"model": ErrorResponse, "description": "Invalid dependency"},
    },
)
async def add_task_dependency(
    task_id: str,
    dependency_data: TaskDependencyCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskDependencyResponse:
    """Add a dependency to a task"""
    dependency = task_service.add_task_dependency(
        session, task_id, dependency_data.depends_on_task_id, current_user.user_id
    )
    # Load the depends_on_task for the response
    depends_on_task = task_service.get_task(
        session, dependency.depends_on_task_id, current_user.user_id
    )
    dependency_response = TaskDependencyResponse.model_validate(dependency)
    if depends_on_task:
        dependency_response.depends_on_task = TaskDependencyTaskInfo.model_validate(
            depends_on_task
        )
    return dependency_response


@router.get(
    "/{task_id}/dependencies",
    response_model=list[TaskDependencyResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def get_task_dependencies(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[TaskDependencyResponse]:
    """Get all dependencies for a task"""
    dependencies = task_service.get_task_dependencies(
        session, task_id, current_user.user_id
    )
    return [TaskDependencyResponse.model_validate(dep) for dep in dependencies]


@router.delete(
    "/{task_id}/dependencies/{dependency_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Dependency not found"},
    },
)
async def delete_task_dependency(
    task_id: str,
    dependency_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete a task dependency"""
    task_service.delete_task_dependency(
        session, task_id, dependency_id, current_user.user_id
    )
