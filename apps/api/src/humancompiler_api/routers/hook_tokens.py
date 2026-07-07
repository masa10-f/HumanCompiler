"""Hook token management API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    HookToken,
    HookTokenCreate,
    HookTokenCreatedResponse,
    HookTokenResponse,
)
from humancompiler_api.services import hook_token_service

router = APIRouter(prefix="/api/user/hook-tokens", tags=["hook-tokens"])


def _created_response(token_model: HookToken, token: str) -> HookTokenCreatedResponse:
    """Build the one-time token creation response."""
    return HookTokenCreatedResponse(
        id=token_model.id,
        user_id=token_model.user_id,
        name=token_model.name,
        token_prefix=token_model.token_prefix,
        last_used_at=token_model.last_used_at,
        created_at=token_model.created_at,
        updated_at=token_model.updated_at,
        token=token,
    )


@router.get("", response_model=list[HookTokenResponse])
@router.get("/", response_model=list[HookTokenResponse], include_in_schema=False)
async def list_hook_tokens(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[HookTokenResponse]:
    """List active hook tokens for the current user."""
    tokens = hook_token_service.get_hook_tokens(session, current_user.user_id)
    return [HookTokenResponse.model_validate(token) for token in tokens]


@router.post(
    "",
    response_model=HookTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=HookTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_hook_token(
    token_data: HookTokenCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> HookTokenCreatedResponse:
    """Create a hook token and return its secret once."""
    token_model, token = hook_token_service.create_hook_token(
        session, token_data, current_user.user_id
    )
    return _created_response(token_model, token)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_hook_token(
    token_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Revoke an active hook token."""
    hook_token_service.revoke_hook_token(session, token_id, current_user.user_id)
