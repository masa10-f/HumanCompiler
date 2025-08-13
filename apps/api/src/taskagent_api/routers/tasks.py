from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from taskagent_api.auth import AuthUser, get_current_user
from taskagent_api.database import db
from taskagent_api.models import (
    ErrorResponse,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
    TaskDependencyCreate,
    TaskDependencyResponse,
    TaskDependencyTaskInfo,
)
from taskagent_api.services import task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


def get_session():
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
async def create_task(
    task_data: TaskCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Create a new task"""
    task = task_service.create_task(session, task_data, current_user.user_id)
    return TaskResponse.model_validate(task)


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
) -> list[TaskResponse]:
    """Get tasks for specific goal"""
    tasks = task_service.get_tasks_by_goal(
        session, goal_id, current_user.user_id, skip, limit
    )
    task_responses = []
    print(f"Processing {len(tasks)} tasks for goal {goal_id}")
    
    for i, task in enumerate(tasks):
        print(f"Processing task {i+1}/{len(tasks)}: {task.id} - {task.title}")
        try:
            # First validate the basic task
            task_response = TaskResponse.model_validate(task)
            print(f"✓ Task {task.id} validated successfully")
            
            # Initialize empty dependencies to avoid issues
            task_response.dependencies = []

            # Try to get dependencies, but don't fail if there's an issue
            try:
                dependencies = task_service.get_task_dependencies(
                    session, str(task.id), current_user.user_id
                )
                print(f"  Found {len(dependencies)} dependencies for task {task.id}")
                
                # Convert dependencies with task info
                dependency_responses = []
                for j, dep in enumerate(dependencies):
                    try:
                        dep_response = TaskDependencyResponse(
                            id=dep.id,
                            task_id=dep.task_id,
                            depends_on_task_id=dep.depends_on_task_id,
                            created_at=dep.created_at,
                        )
                        # Add task info if available
                        if dep.depends_on_task:
                            dep_response.depends_on_task = TaskDependencyTaskInfo(
                                id=dep.depends_on_task.id,
                                title=dep.depends_on_task.title,
                                status=dep.depends_on_task.status,
                            )
                        dependency_responses.append(dep_response)
                        print(f"  ✓ Dependency {j+1} processed successfully")
                    except Exception as e:
                        # Log the error but continue processing
                        print(f"  ✗ Error processing dependency {dep.id}: {e}")
                        continue
                task_response.dependencies = dependency_responses
                print(f"  Final dependencies count: {len(dependency_responses)}")
            except Exception as e:
                # If dependencies can't be loaded, just continue with empty list
                print(f"  ⚠ Error loading dependencies for task {task.id}: {e}")
                task_response.dependencies = []

            task_responses.append(task_response)
            print(f"✓ Task {task.id} added to response (total: {len(task_responses)})")
        except Exception as e:
            # Log task validation error but continue
            print(f"✗ CRITICAL: Error processing task {task.id}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    print(f"Returning {len(task_responses)} task responses")
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
) -> list[TaskResponse]:
    """Get all tasks for specific project"""
    tasks = task_service.get_tasks_by_project(
        session, project_id, current_user.user_id, skip, limit
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
    return TaskDependencyResponse.model_validate(dependency)


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
