"""Hook token management API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.common.error_handlers import (
    ResourceNotFoundError,
    validate_uuid,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentScope,
    AgentToken,
    HookTokenCreate,
    HookTokenCreatedResponse,
    HookTokenResponse,
)
from humancompiler_api.services import agent_token_service

router = APIRouter(prefix="/api/user/hook-tokens", tags=["hook-tokens"])

_HOOK_ONLY_SCOPES = {AgentScope.QUICK_TASKS_WRITE.value}


def _created_response(token_model: AgentToken, token: str) -> HookTokenCreatedResponse:
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


def _hook_only_tokens(session: Session, user_id: str) -> list[AgentToken]:
    """Active tokens that can only write quick tasks."""
    tokens = agent_token_service.list_active_tokens(session, user_id)
    return [token for token in tokens if set(token.scopes) == _HOOK_ONLY_SCOPES]


@router.get("", response_model=list[HookTokenResponse])
@router.get("/", response_model=list[HookTokenResponse], include_in_schema=False)
async def list_hook_tokens(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[HookTokenResponse]:
    """List active tokens that can only write quick tasks."""
    return [
        HookTokenResponse.model_validate(token)
        for token in _hook_only_tokens(session, current_user.user_id)
    ]


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
    token_model, token = agent_token_service.create_token(
        session, current_user.user_id, token_data.name, [AgentScope.QUICK_TASKS_WRITE]
    )
    return _created_response(token_model, token)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_hook_token(
    token_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Revoke an active hook token. Tokens this API does not list are not found."""
    token_uuid = validate_uuid(token_id, "token_id")
    hook_tokens = _hook_only_tokens(session, current_user.user_id)
    if not any(token.id == token_uuid for token in hook_tokens):
        raise ResourceNotFoundError("AgentToken", token_uuid)
    agent_token_service.revoke_token(session, token_uuid, current_user.user_id)
