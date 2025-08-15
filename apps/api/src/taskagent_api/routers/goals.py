from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from taskagent_api.auth import AuthUser, get_current_user
from taskagent_api.database import db
from taskagent_api.models import (
    ErrorResponse,
    GoalCreate,
    GoalResponse,
    GoalStatus,
    GoalUpdate,
)
from taskagent_api.services import goal_service

router = APIRouter(prefix="/goals", tags=["goals"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=GoalResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def create_goal(
    goal_data: GoalCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> GoalResponse:
    """Create a new goal"""
    goal = goal_service.create_goal(session, goal_data, current_user.user_id)
    return GoalResponse.model_validate(goal)


@router.get(
    "/project/{project_id}",
    response_model=list[GoalResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def get_goals_by_project(
    project_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[GoalResponse]:
    """Get goals for specific project"""
    goals = goal_service.get_goals_by_project(
        session, project_id, current_user.user_id, skip, limit
    )
    return [GoalResponse.model_validate(goal) for goal in goals]


@router.get(
    "/{goal_id}",
    response_model=GoalResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def get_goal(
    goal_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> GoalResponse:
    """Get specific goal"""
    goal = goal_service.get_goal(session, goal_id, current_user.user_id)
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Goal not found",
                details={"goal_id": goal_id},
            ).model_dump(),
        )
    return GoalResponse.model_validate(goal)


@router.put(
    "/{goal_id}",
    response_model=GoalResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
        422: {"model": ErrorResponse, "description": "Invalid status transition"},
    },
)
async def update_goal(
    goal_id: str,
    goal_data: GoalUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> GoalResponse:
    """Update specific goal"""

    # Runtime validation for status values
    if goal_data.status is not None:
        try:
            # Validate that the status is a valid enum value
            GoalStatus(goal_data.status.value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=ErrorResponse.create(
                    code="INVALID_STATUS_VALUE",
                    message=f"Invalid goal status: {goal_data.status.value}",
                    details={
                        "valid_statuses": [s.value for s in GoalStatus],
                        "provided_status": goal_data.status.value,
                    },
                ).model_dump(),
            )

    try:
        goal = goal_service.update_goal(
            session, goal_id, current_user.user_id, goal_data
        )
        return GoalResponse.model_validate(goal)
    except HTTPException as e:
        # Re-raise HTTP exceptions from service layer (e.g., status transition validation)
        if e.status_code == 422:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=ErrorResponse.create(
                    code="INVALID_STATUS_TRANSITION",
                    message=str(e.detail),
                    details={"goal_id": goal_id},
                ).model_dump(),
            )
        raise


@router.delete(
    "/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def delete_goal(
    goal_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific goal"""
    goal_service.delete_goal(session, goal_id, current_user.user_id)
