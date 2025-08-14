"""Goal dependencies API router"""

from uuid import UUID
from typing import Annotated
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from taskagent_api.database import get_db
from taskagent_api.models import (
    GoalDependency,
    GoalDependencyCreate,
    GoalDependencyResponse,
    Goal,
)

router = APIRouter(prefix="/api/goal-dependencies", tags=["goal-dependencies"])


@router.post(
    "/", response_model=GoalDependencyResponse, status_code=status.HTTP_201_CREATED
)
async def create_goal_dependency(
    dependency: GoalDependencyCreate,
    db: Annotated[Session, Depends(get_db)],
) -> GoalDependencyResponse:
    """Create a new goal dependency"""

    # Validate that both goals exist
    goal = db.get(Goal, dependency.goal_id)
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goal with id {dependency.goal_id} not found",
        )

    depends_on_goal = db.get(Goal, dependency.depends_on_goal_id)
    if not depends_on_goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goal with id {dependency.depends_on_goal_id} not found",
        )

    # Validate no self-dependency (already handled by DB constraint)
    if dependency.goal_id == dependency.depends_on_goal_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal cannot depend on itself",
        )

    # Check for circular dependencies
    if _has_circular_dependency(db, dependency.goal_id, dependency.depends_on_goal_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Creating this dependency would create a circular dependency",
        )

    # Check if dependency already exists
    existing = db.exec(
        select(GoalDependency)
        .where(GoalDependency.goal_id == dependency.goal_id)
        .where(GoalDependency.depends_on_goal_id == dependency.depends_on_goal_id)
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Goal dependency already exists",
        )

    # Create the dependency
    db_dependency = GoalDependency(
        goal_id=dependency.goal_id, depends_on_goal_id=dependency.depends_on_goal_id
    )
    db.add(db_dependency)
    db.commit()
    db.refresh(db_dependency)

    return GoalDependencyResponse.model_validate(db_dependency)


@router.get("/goal/{goal_id}", response_model=list[GoalDependencyResponse])
async def get_goal_dependencies(
    goal_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[GoalDependencyResponse]:
    """Get all dependencies for a specific goal"""

    # Validate goal exists
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goal with id {goal_id} not found",
        )

    dependencies = db.exec(
        select(GoalDependency).where(GoalDependency.goal_id == goal_id)
    ).all()

    return [GoalDependencyResponse.model_validate(dep) for dep in dependencies]


@router.delete("/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal_dependency(
    dependency_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a goal dependency"""

    dependency = db.get(GoalDependency, dependency_id)
    if not dependency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goal dependency with id {dependency_id} not found",
        )

    db.delete(dependency)
    db.commit()


def _has_circular_dependency(
    db: Session, goal_id: UUID, depends_on_goal_id: UUID, max_depth: int = 100
) -> bool:
    """
    Check if adding a dependency would create a circular dependency.
    Uses iterative BFS approach for better performance and depth limiting.
    """

    # Use BFS to detect cycles more efficiently
    queue: deque[tuple[UUID, int]] = deque(
        [(depends_on_goal_id, 0)]
    )  # (goal_id, depth)
    visited: set[UUID] = {depends_on_goal_id}

    # Cache queries for better performance
    dependency_cache: dict[UUID, list[UUID]] = {}

    while queue:
        current_goal_id, depth = queue.popleft()

        # Depth limit to prevent infinite loops in corrupted data
        if depth >= max_depth:
            # Log warning about deep dependency chain
            import logging

            logger = logging.getLogger(__name__)

            logger.warning(
                f"Goal dependency chain depth limit reached: {max_depth}",
                extra={"goal_id": str(goal_id), "depends_on": str(depends_on_goal_id)},
            )
            return False  # Assume no cycle if we hit depth limit

        # Check if we've found a cycle
        if current_goal_id == goal_id:
            return True

        # Get dependent goals (with caching)
        if current_goal_id not in dependency_cache:
            dependent_goals = list(
                db.exec(
                    select(GoalDependency.goal_id).where(
                        GoalDependency.depends_on_goal_id == current_goal_id
                    )
                ).all()
            )
            dependency_cache[current_goal_id] = dependent_goals
        else:
            dependent_goals = dependency_cache[current_goal_id]

        # Add unvisited dependent goals to queue
        for dependent_goal_id in dependent_goals:
            if dependent_goal_id not in visited:
                visited.add(dependent_goal_id)
                queue.append((dependent_goal_id, depth + 1))

    return False
