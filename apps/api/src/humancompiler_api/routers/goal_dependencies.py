"""Goal dependencies API router"""

from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_db
from humancompiler_api.models import (
    GoalDependencyCreate,
    GoalDependencyResponse,
)
from humancompiler_api.services import goal_service

router = APIRouter(prefix="/api/goal-dependencies", tags=["goal-dependencies"])


@router.post(
    "/", response_model=GoalDependencyResponse, status_code=status.HTTP_201_CREATED
)
async def create_goal_dependency(
    dependency: GoalDependencyCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> GoalDependencyResponse:
    """Create a new goal dependency between two goals owned by the user"""
    db_dependency = goal_service.add_goal_dependency(
        db,
        dependency.goal_id,
        dependency.depends_on_goal_id,
        current_user.user_id,
    )
    return GoalDependencyResponse.model_validate(db_dependency)


# The frontend calls these with a trailing slash. Serve it directly: a slash
# redirect can cross origins (Vercel rewrite -> fly.dev) and drop Authorization.
@router.get("/goal/{goal_id}", response_model=list[GoalDependencyResponse])
@router.get(
    "/goal/{goal_id}/",
    response_model=list[GoalDependencyResponse],
    include_in_schema=False,  # Don't duplicate in OpenAPI schema
)
async def get_goal_dependencies(
    goal_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[GoalDependencyResponse]:
    """Get all dependencies for a goal owned by the user"""
    dependencies = goal_service.get_goal_dependencies(db, goal_id, current_user.user_id)
    return [GoalDependencyResponse.model_validate(dep) for dep in dependencies]


@router.delete("/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete(
    "/{dependency_id}/",
    status_code=status.HTTP_204_NO_CONTENT,
    include_in_schema=False,  # Don't duplicate in OpenAPI schema
)
async def delete_goal_dependency(
    dependency_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete a goal dependency whose goal is owned by the user"""
    goal_service.delete_goal_dependency_by_id(db, dependency_id, current_user.user_id)
