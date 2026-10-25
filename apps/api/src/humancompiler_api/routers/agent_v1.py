# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Read-only agent API (``/api/agent/v1``), authenticated by agent token."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

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
    Goal,
    GoalDependency,
    GoalResponse,
    GoalStatus,
    Project,
    ProjectResponse,
    ProjectStatus,
    Task,
    TaskDependency,
    TaskResponse,
    TaskStatus,
)
from humancompiler_api.services import goal_service, project_service, task_service

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])

INCREMENTAL_SYNC_GUIDE = (
    "Incremental sync: pass the largest updated_at you received, minus 5 minutes, "
    "as updated_since on the next call. The 5 minutes absorb commits that become "
    "visible late, so drop rows whose (id, updated_at) pair you already have. "
    "Deletions never appear in a diff; to detect them, fetch the full set of IDs "
    "and compare it with your local set. Adding or removing a dependency advances "
    "the dependent goal or task's updated_at. Derived and embedded values do not: "
    "a goal's estimate_hours (the sum of its tasks), the depends_on_* summaries, "
    "and dependencies on a deleted item. Read those from the referenced items "
    "you sync."
)


def _owned_goals(user_id: UUID) -> SelectOfScalar[Goal]:
    """The user's goals, with dependencies loaded in one query per page."""
    return (
        select(Goal)
        .where(goal_service._get_user_filter(user_id))
        .options(
            selectinload(Goal.dependencies).selectinload(GoalDependency.depends_on_goal)
        )
    )


def _owned_tasks(user_id: UUID) -> SelectOfScalar[Task]:
    """The user's tasks, with dependencies loaded in one query per page."""
    return (
        select(Task)
        .where(task_service._get_user_filter(user_id))
        .options(
            selectinload(Task.dependencies).selectinload(TaskDependency.depends_on_task)
        )
    )


@router.get("/me", response_model=AgentMeResponse)
async def get_me(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(get_agent_principal)],
) -> AgentMeResponse:
    """Return the identity and scopes of the calling agent token."""
    # Authentication loaded this row moments ago, and revocation only sets
    # revoked_at, so the row is always present.
    token_name = session.exec(
        select(AgentToken.name).where(AgentToken.id == principal.token_id)
    ).one()
    return AgentMeResponse(
        token_name=token_name,
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found") from None
    return ProjectResponse.model_validate(project)


@router.get(
    "/goals",
    response_model=AgentPage[GoalResponse],
    description=f"List the user's goals ordered by (updated_at, id). {INCREMENTAL_SYNC_GUIDE}",
)
async def list_goals(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.GOALS_READ))],
    params: Annotated[PageParams, Depends(page_params())],
    project_id: Annotated[
        UUID | None,
        Query(description="Filter by project. Another user's project yields no rows."),
    ] = None,
    goal_status: Annotated[
        GoalStatus | None, Query(alias="status", description="Filter by status.")
    ] = None,
) -> AgentPage[GoalResponse]:
    statement = _owned_goals(principal.user_id)
    if project_id is not None:
        statement = statement.where(Goal.project_id == project_id)
    if goal_status is not None:
        statement = statement.where(Goal.status == goal_status)
    rows, next_cursor = paginate(session, statement, Goal, params)
    return AgentPage[GoalResponse](
        items=[GoalResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/goals/{goal_id}", response_model=GoalResponse)
async def get_goal(
    goal_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.GOALS_READ))],
) -> GoalResponse:
    """Return one goal; another user's goal is reported as not found."""
    goal = session.exec(
        _owned_goals(principal.user_id).where(Goal.id == goal_id)
    ).first()
    if goal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    return GoalResponse.model_validate(goal)


@router.get(
    "/tasks",
    response_model=AgentPage[TaskResponse],
    description=f"List the user's tasks ordered by (updated_at, id). {INCREMENTAL_SYNC_GUIDE}",
)
async def list_tasks(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.TASKS_READ))],
    params: Annotated[PageParams, Depends(page_params())],
    project_id: Annotated[
        UUID | None,
        Query(description="Filter by project. Another user's project yields no rows."),
    ] = None,
    goal_id: Annotated[
        UUID | None,
        Query(description="Filter by goal. Another user's goal yields no rows."),
    ] = None,
    task_status: Annotated[
        TaskStatus | None, Query(alias="status", description="Filter by status.")
    ] = None,
) -> AgentPage[TaskResponse]:
    statement = _owned_tasks(principal.user_id)
    if project_id is not None:
        statement = statement.where(
            col(Task.goal_id).in_(select(Goal.id).where(Goal.project_id == project_id))
        )
    if goal_id is not None:
        statement = statement.where(Task.goal_id == goal_id)
    if task_status is not None:
        statement = statement.where(Task.status == task_status)
    rows, next_cursor = paginate(session, statement, Task, params)
    return AgentPage[TaskResponse](
        items=[TaskResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.TASKS_READ))],
) -> TaskResponse:
    """Return one task; another user's task is reported as not found."""
    task = session.exec(
        _owned_tasks(principal.user_id).where(Task.id == task_id)
    ).first()
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return TaskResponse.model_validate(task)
