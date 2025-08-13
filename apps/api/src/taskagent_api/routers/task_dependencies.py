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
    db: Session, task_id: UUID, depends_on_task_id: UUID
) -> bool:
    """Check if adding a dependency would create a circular dependency"""

    def _check_path(
        current_task_id: UUID, target_task_id: UUID, visited: set[UUID]
    ) -> bool:
        if current_task_id in visited:
            return False  # Already visited, no cycle here

        if current_task_id == target_task_id:
            return True  # Found a cycle

        visited.add(current_task_id)

        # Get all tasks that depend on the current task
        dependent_tasks = db.exec(
            select(TaskDependency.task_id).where(
                TaskDependency.depends_on_task_id == current_task_id
            )
        ).all()

        for dependent_task_id in dependent_tasks:
            if _check_path(dependent_task_id, target_task_id, visited.copy()):
                return True

        return False

    return _check_path(depends_on_task_id, task_id, set())
