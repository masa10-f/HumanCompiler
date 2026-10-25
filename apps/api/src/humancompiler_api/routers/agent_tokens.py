# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent token management API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from humancompiler_api.agent_audit import list_audit_logs_for_token
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.common.error_handlers import validate_uuid
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AGENT_BROAD_SCOPES,
    AGENT_SCOPE_DESCRIPTIONS,
    AGENT_TOKEN_PRESETS,
    AgentAuditLogResponse,
    AgentScope,
    AgentScopeCatalog,
    AgentScopeInfo,
    AgentTokenCreate,
    AgentTokenCreatedResponse,
    AgentTokenResponse,
)
from humancompiler_api.services import agent_token_service

router = APIRouter(prefix="/api/user/agent-tokens", tags=["agent-tokens"])


@router.get("", response_model=list[AgentTokenResponse])
@router.get("/", response_model=list[AgentTokenResponse], include_in_schema=False)
async def list_agent_tokens(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[AgentTokenResponse]:
    """List the user's active agent tokens."""
    return [
        AgentTokenResponse.model_validate(token)
        for token in agent_token_service.list_active_tokens(
            session, current_user.user_id
        )
    ]


@router.post(
    "",
    response_model=AgentTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=AgentTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_agent_token(
    token_data: AgentTokenCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> AgentTokenCreatedResponse:
    """Create an agent token and return its secret once."""
    token_model, token = agent_token_service.create_token(
        session,
        current_user.user_id,
        token_data.name,
        token_data.scopes,
        token_data.description,
    )
    return AgentTokenCreatedResponse(
        **AgentTokenResponse.model_validate(token_model).model_dump(),
        token=token,
    )


@router.get("/scopes", response_model=AgentScopeCatalog)
async def list_agent_scopes(
    _current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> AgentScopeCatalog:
    """List every grantable scope (in definition order) and the token presets."""
    return AgentScopeCatalog(
        scopes=[
            AgentScopeInfo(
                scope=scope.value,
                description=AGENT_SCOPE_DESCRIPTIONS[scope],
                broad=scope in AGENT_BROAD_SCOPES,
            )
            for scope in AgentScope
        ],
        presets=list(AGENT_TOKEN_PRESETS),
    )


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_agent_token(
    token_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Revoke an active agent token. Others' or revoked tokens are not found."""
    agent_token_service.revoke_token(
        session, validate_uuid(token_id, "token_id"), current_user.user_id
    )


@router.get("/{token_id}/audit-logs", response_model=list[AgentAuditLogResponse])
async def list_agent_token_audit_logs(
    token_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AgentAuditLogResponse]:
    """List recent audit rows of one of the user's tokens, revoked ones included."""
    token = agent_token_service.get_owned_token(session, token_id, current_user.user_id)
    logs = list_audit_logs_for_token(session, token.id, token.user_id, limit)
    return [AgentAuditLogResponse.model_validate(log) for log in logs]
