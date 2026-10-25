# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Read-only agent API (``/api/agent/v1``), authenticated by agent token."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from humancompiler_api.agent_auth import (
    AgentPrincipal,
    get_agent_principal,
    require_scope,
)
from humancompiler_api.agent_pagination import (
    AgentPage,
    PageParams,
    page_params,
    paginate,
)
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentMeResponse,
    AgentScope,
    AgentToken,
    Project,
    ProjectResponse,
    ProjectStatus,
)
from humancompiler_api.services import project_service

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])

INCREMENTAL_SYNC_GUIDE = (
    "Incremental sync: pass the largest updated_at you received, minus 5 minutes, "
    "as updated_since on the next call. The 5 minutes absorb commits that become "
    "visible late, so drop rows whose (id, updated_at) pair you already have. "
    "Deletions never appear in a diff; to detect them, fetch the full set of IDs "
    "and compare it with your local set."
)


@router.get("/me", response_model=AgentMeResponse)
async def get_me(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(get_agent_principal)],
) -> AgentMeResponse:
    """Return the identity and scopes of the calling agent token."""
    agent_token = session.get(AgentToken, principal.token_id)
    if agent_token is None:
        # Revoked between authentication and this lookup.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid agent token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AgentMeResponse(
        token_name=agent_token.name,
        token_prefix=principal.token_prefix,
        scopes=sorted(principal.scopes),
        user_id=principal.user_id,
    )


@router.get(
    "/projects",
    response_model=AgentPage[ProjectResponse],
    description=f"List the user's projects ordered by (updated_at, id). {INCREMENTAL_SYNC_GUIDE}",
)
async def list_projects(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.PROJECTS_READ))
    ],
    params: Annotated[PageParams, Depends(page_params())],
    project_status: Annotated[
        ProjectStatus | None, Query(alias="status", description="Filter by status.")
    ] = None,
) -> AgentPage[ProjectResponse]:
    statement = select(Project).where(
        project_service._get_user_filter(principal.user_id)
    )
    if project_status is not None:
        statement = statement.where(Project.status == project_status)
    rows, next_cursor = paginate(session, statement, Project, params)
    return AgentPage[ProjectResponse](
        items=[ProjectResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.PROJECTS_READ))
    ],
) -> ProjectResponse:
    """Return one project; another user's project is reported as not found."""
    try:
        project = project_service.get_project(session, project_id, principal.user_id)
    except ResourceNotFoundError:
        project = None
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return ProjectResponse.model_validate(project)
