# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Read-only agent API (``/api/agent/v1``), authenticated by agent token."""

from datetime import date, datetime, time
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import ColumnElement, and_, or_
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
from humancompiler_api.ai.context_export import (
    ContextExportOptions,
    build_goal_context_export,
    build_project_context_export,
)
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentMeResponse,
    AgentScope,
    AgentToken,
    ContextNote,
    ContextNoteResponse,
    DailyPlanDocument,
    Goal,
    GoalDependency,
    GoalResponse,
    GoalStatus,
    Log,
    LogResponse,
    Project,
    ProjectResponse,
    ProjectStatus,
    QuickTask,
    QuickTaskResponse,
    Schedule,
    Task,
    TaskDependency,
    TaskResponse,
    TaskStatus,
    WorkSession,
    WorkSessionResponse,
)
from humancompiler_api.routers.context_export import (
    _NOT_FOUND_RESPONSES,
    ContextExportResponse,
    get_export_options,
)
from humancompiler_api.routers.daily_plans import (
    DailyPlanDocumentV1,
    DailyPlanResponse,
)
from humancompiler_api.services import (
    goal_service,
    log_service,
    project_service,
    quick_task_service,
    task_service,
    work_session_service,
)

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


class AgentDailyPlanResponse(DailyPlanResponse):
    """A daily plan document; the agent API always has its id and updated_at."""

    id: UUID
    updated_at: datetime


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


def _owned_note_filter(user_id: UUID) -> ColumnElement[bool]:
    """Notes the user owns whose every set parent is also the user's.

    A note carries ``user_id`` plus up to one parent. The ``user_id`` alone is
    not enough, so each parent column must be NULL or point at the user's own
    row. A note with no parent is decided by ``user_id`` only.
    """
    return and_(
        ContextNote.user_id == user_id,
        or_(
            col(ContextNote.project_id).is_(None),
            col(ContextNote.project_id).in_(
                select(Project.id).where(project_service._get_user_filter(user_id))
            ),
        ),
        or_(
            col(ContextNote.goal_id).is_(None),
            col(ContextNote.goal_id).in_(
                select(Goal.id).where(goal_service._get_user_filter(user_id))
            ),
        ),
        or_(
            col(ContextNote.task_id).is_(None),
            col(ContextNote.task_id).in_(
                select(Task.id).where(task_service._get_user_filter(user_id))
            ),
        ),
    )


def _schedules_by_date(
    session: Session, user_id: UUID, days: list[date]
) -> dict[date, dict[str, Any]]:
    """Load the schedules of ``days`` in one query, keyed by calendar date.

    Schedules are keyed by naive midnight, as ``daily_plans._get_schedule`` does.
    """
    if not days:
        return {}
    midnights = [datetime.combine(day, time.min) for day in days]
    rows = session.exec(
        select(Schedule).where(
            Schedule.user_id == user_id, col(Schedule.date).in_(midnights)
        )
    ).all()
    return {row.date.date(): row.plan_json for row in rows}


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


@router.get(
    "/quick-tasks",
    response_model=AgentPage[QuickTaskResponse],
    description=f"List the user's quick tasks ordered by (updated_at, id). {INCREMENTAL_SYNC_GUIDE}",
)
async def list_quick_tasks(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.QUICK_TASKS_READ))
    ],
    params: Annotated[PageParams, Depends(page_params())],
    task_status: Annotated[
        TaskStatus | None, Query(alias="status", description="Filter by status.")
    ] = None,
) -> AgentPage[QuickTaskResponse]:
    statement = select(QuickTask).where(
        quick_task_service._get_user_filter(principal.user_id)
    )
    if task_status is not None:
        statement = statement.where(QuickTask.status == task_status)
    rows, next_cursor = paginate(session, statement, QuickTask, params)
    return AgentPage[QuickTaskResponse](
        items=[QuickTaskResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get(
    "/logs",
    response_model=AgentPage[LogResponse],
    description=f"List the user's work logs ordered by (updated_at, id). {INCREMENTAL_SYNC_GUIDE}",
)
async def list_logs(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.LOGS_READ))],
    params: Annotated[PageParams, Depends(page_params())],
    task_id: Annotated[
        UUID | None,
        Query(description="Filter by task. Another user's task yields no rows."),
    ] = None,
) -> AgentPage[LogResponse]:
    statement = select(Log).where(log_service._get_user_filter(principal.user_id))
    if task_id is not None:
        statement = statement.where(Log.task_id == task_id)
    rows, next_cursor = paginate(session, statement, Log, params)
    return AgentPage[LogResponse](
        items=[LogResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get(
    "/work-sessions",
    response_model=AgentPage[WorkSessionResponse],
    description=(
        "List the user's work sessions ordered by (updated_at, id). "
        f"{INCREMENTAL_SYNC_GUIDE} The embedded task summary does not advance a "
        "work session's updated_at; read task changes from /tasks."
    ),
)
async def list_work_sessions(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.WORK_SESSIONS_READ))
    ],
    params: Annotated[PageParams, Depends(page_params())],
    task_id: Annotated[
        UUID | None,
        Query(description="Filter by task. Another user's task yields no rows."),
    ] = None,
) -> AgentPage[WorkSessionResponse]:
    statement = (
        select(WorkSession)
        .where(work_session_service._get_user_filter(principal.user_id))
        .options(selectinload(WorkSession.task))
    )
    if task_id is not None:
        statement = statement.where(WorkSession.task_id == task_id)
    rows, next_cursor = paginate(session, statement, WorkSession, params)
    return AgentPage[WorkSessionResponse](
        items=[WorkSessionResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get(
    "/context-notes",
    response_model=AgentPage[ContextNoteResponse],
    description=(
        "List the user's context notes ordered by (updated_at, id). "
        f"{INCREMENTAL_SYNC_GUIDE} Each filter matches only notes attached "
        "directly to that item, not notes on its goals or tasks."
    ),
)
async def list_context_notes(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.NOTES_READ))],
    params: Annotated[PageParams, Depends(page_params())],
    project_id: Annotated[
        UUID | None,
        Query(description="Filter by project. Another user's project yields no rows."),
    ] = None,
    goal_id: Annotated[
        UUID | None,
        Query(description="Filter by goal. Another user's goal yields no rows."),
    ] = None,
    task_id: Annotated[
        UUID | None,
        Query(description="Filter by task. Another user's task yields no rows."),
    ] = None,
) -> AgentPage[ContextNoteResponse]:
    statement = select(ContextNote).where(_owned_note_filter(principal.user_id))
    if project_id is not None:
        statement = statement.where(ContextNote.project_id == project_id)
    if goal_id is not None:
        statement = statement.where(ContextNote.goal_id == goal_id)
    if task_id is not None:
        statement = statement.where(ContextNote.task_id == task_id)
    rows, next_cursor = paginate(session, statement, ContextNote, params)
    return AgentPage[ContextNoteResponse](
        items=[ContextNoteResponse.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get(
    "/daily-plans",
    response_model=AgentPage[AgentDailyPlanResponse],
    description=(
        "List the user's daily plan documents ordered by (updated_at, id). "
        "Only days that have a document are returned, even if a schedule exists "
        f"for the day. {INCREMENTAL_SYNC_GUIDE} The embedded schedule does not "
        "advance a daily plan's updated_at; to pick up schedule changes, re-read "
        "the date range with date_from and date_to."
    ),
)
async def list_daily_plans(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.DAILY_PLANS_READ))
    ],
    params: Annotated[PageParams, Depends(page_params(7, 31))],
    date_from: Annotated[
        date | None,
        Query(description="Only plans on or after this date (YYYY-MM-DD)."),
    ] = None,
    date_to: Annotated[
        date | None,
        Query(description="Only plans on or before this date (YYYY-MM-DD)."),
    ] = None,
) -> AgentPage[AgentDailyPlanResponse]:
    if date_from is not None and date_to is not None and date_from > date_to:
        return AgentPage[AgentDailyPlanResponse](items=[])
    statement = select(DailyPlanDocument).where(
        DailyPlanDocument.user_id == principal.user_id
    )
    if date_from is not None:
        statement = statement.where(DailyPlanDocument.date >= date_from)
    if date_to is not None:
        statement = statement.where(DailyPlanDocument.date <= date_to)
    rows, next_cursor = paginate(session, statement, DailyPlanDocument, params)
    schedules = _schedules_by_date(session, principal.user_id, [r.date for r in rows])
    return AgentPage[AgentDailyPlanResponse](
        items=[
            AgentDailyPlanResponse(
                id=row.id,
                date=row.date.isoformat(),
                revision=row.revision,
                document=DailyPlanDocumentV1.model_validate(row.document_json),
                schedule=schedules.get(row.date),
                updated_at=row.updated_at,
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )


# The export does heavy synchronous DB work, so these handlers are plain ``def``
# and run in the threadpool, as the web endpoints do. ``ResourceNotFoundError``
# becomes a 404 through the global service error handler.
@router.get(
    "/context-export/projects/{project_id}",
    response_model=ContextExportResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def export_project_context(
    project_id: UUID,
    options: Annotated[ContextExportOptions, Depends(get_export_options)],
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.CONTEXT_READ))
    ],
) -> ContextExportResponse:
    """Export a project's notes, tasks, and work history as Markdown."""
    result = build_project_context_export(
        session, principal.user_id, project_id, options
    )
    return ContextExportResponse.from_result(result)


@router.get(
    "/context-export/goals/{goal_id}",
    response_model=ContextExportResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def export_goal_context(
    goal_id: UUID,
    options: Annotated[ContextExportOptions, Depends(get_export_options)],
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.CONTEXT_READ))
    ],
) -> ContextExportResponse:
    """Export a goal's notes, tasks, and work history as Markdown."""
    result = build_goal_context_export(session, principal.user_id, goal_id, options)
    return ContextExportResponse.from_result(result)
