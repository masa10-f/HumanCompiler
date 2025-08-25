from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from humancompiler_api.services import UserService

router = APIRouter(prefix="/users", tags=["users"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"model": ErrorResponse, "description": "User already exists"},
    },
)
async def create_user(
    user_data: UserCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> UserResponse:
    """Create or get current user profile"""
    user = UserService.create_user(session, user_data, current_user.user_id)
    return UserResponse.model_validate(user)


@router.get(
    "/me",
    response_model=UserResponse,
    responses={
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def get_current_user_profile(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> UserResponse:
    """Get current user profile"""
    user = UserService.get_user(session, current_user.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return UserResponse.model_validate(user)


@router.put(
    "/me",
    response_model=UserResponse,
    responses={
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def update_current_user_profile(
    user_data: UserUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> UserResponse:
    """Update current user profile"""
    user = UserService.update_user(session, current_user.user_id, user_data)
    return UserResponse.model_validate(user)
