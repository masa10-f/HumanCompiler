"""Task dependencies API router"""

from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from taskagent_api.database import get_db
from taskagent_api.models import (
    TaskDependency,
    TaskDependencyCreate,
    TaskDependencyResponse,
    Task,
)

router = APIRouter(prefix="/api/task-dependencies", tags=["task-dependencies"])


@router.post(
    "/", response_model=TaskDependencyResponse, status_code=status.HTTP_201_CREATED
)
async def create_task_dependency(
    dependency: TaskDependencyCreate,
    db: Annotated[Session, Depends(get_db)],
) -> TaskDependencyResponse:
    """Create a new task dependency"""

    # Validate that both tasks exist
    task = db.get(Task, dependency.task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {dependency.task_id} not found",
        )

    depends_on_task = db.get(Task, dependency.depends_on_task_id)
    if not depends_on_task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {dependency.depends_on_task_id} not found",
        )

    # Validate no self-dependency (already handled by DB constraint)
    if dependency.task_id == dependency.depends_on_task_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task cannot depend on itself",
        )

    # Check for circular dependencies
    if _has_circular_dependency(db, dependency.task_id, dependency.depends_on_task_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Creating this dependency would create a circular dependency",
        )

    # Check if dependency already exists
    existing = db.exec(
        select(TaskDependency)
        .where(TaskDependency.task_id == dependency.task_id)
        .where(TaskDependency.depends_on_task_id == dependency.depends_on_task_id)
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task dependency already exists",
        )

    # Create the dependency
    db_dependency = TaskDependency.model_validate(dependency)
    db.add(db_dependency)
    db.commit()
    db.refresh(db_dependency)

    return TaskDependencyResponse.model_validate(db_dependency)


@router.get("/task/{task_id}", response_model=list[TaskDependencyResponse])
async def get_task_dependencies(
    task_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[TaskDependencyResponse]:
    """Get all dependencies for a specific task"""

    # Validate task exists
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found",
        )

    dependencies = db.exec(
        select(TaskDependency).where(TaskDependency.task_id == task_id)
    ).all()

    return [TaskDependencyResponse.model_validate(dep) for dep in dependencies]


@router.delete("/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_dependency(
    dependency_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a task dependency"""

    dependency = db.get(TaskDependency, dependency_id)
    if not dependency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task dependency with id {dependency_id} not found",
        )

    db.delete(dependency)
    db.commit()


def _has_circular_dependency(
    db: Session, task_id: UUID, depends_on_task_id: UUID, max_depth: int = 100
) -> bool:
    """
    Check if adding a dependency would create a circular dependency.
    Uses iterative BFS approach for better performance and depth limiting.
    """
    from collections import deque

    # Use BFS to detect cycles more efficiently
    queue = deque([(depends_on_task_id, 0)])  # (task_id, depth)
    visited = {depends_on_task_id}

    # Cache queries for better performance
    dependency_cache = {}

    while queue:
        current_task_id, depth = queue.popleft()

        # Depth limit to prevent infinite loops in corrupted data
        if depth >= max_depth:
            # Log warning about deep dependency chain
            from taskagent_api.logger import logger

            logger.warning(
                f"Dependency chain depth limit reached: {max_depth}",
                extra={"task_id": str(task_id), "depends_on": str(depends_on_task_id)},
            )
            return False  # Assume no cycle if we hit depth limit

        # Check if we've found a cycle
        if current_task_id == task_id:
            return True

        # Get dependent tasks (with caching)
        if current_task_id not in dependency_cache:
            dependent_tasks = db.exec(
                select(TaskDependency.task_id).where(
                    TaskDependency.depends_on_task_id == current_task_id
                )
            ).all()
            dependency_cache[current_task_id] = dependent_tasks
        else:
            dependent_tasks = dependency_cache[current_task_id]

        # Add unvisited dependent tasks to queue
        for dependent_task_id in dependent_tasks:
            if dependent_task_id not in visited:
                visited.add(dependent_task_id)
                queue.append((dependent_task_id, depth + 1))

    return False
