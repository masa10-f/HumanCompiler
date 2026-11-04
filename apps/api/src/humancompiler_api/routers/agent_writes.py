# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API writes for goals, tasks, task dependencies, context notes and work logs.

All under ``/api/agent/v1``.

Every write is recorded in ``agent_changes``. Updates need the updated_at the
agent read, and destructive changes need the ``writes:unconfirmed`` scope.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session

from humancompiler_api import agent_write_service
from humancompiler_api.agent_auth import AgentPrincipal, require_scope
from humancompiler_api.agent_write_models import (
    AgentDependencyCreate,
    AgentGoalCreate,
    AgentGoalUpdate,
    AgentLogCreate,
    AgentNoteAppend,
    AgentNoteReplace,
    AgentTaskCreate,
    AgentTaskUpdate,
    NoteTargetKind,
    NOTE_REPLACE_LOSES,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentScope,
    ContextNoteResponse,
    Goal,
    GoalResponse,
    LogResponse,
    Task,
    TaskResponse,
)
from humancompiler_api.routers.agent_proposals import body_capped_route
from humancompiler_api.routers.agent_v1 import _owned_goals, _owned_tasks

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])

NOTE_MAX_BODY_BYTES = 512 * 1024

UPDATE_GUIDE = (
    "Only the fields you send change; send null to clear description, memo or "
    "due_date. Any other field sent as null is rejected with 422. "
    "expected_updated_at must be the updated_at you last read: if the item "
    "changed since, nothing is written and the answer is 409 with "
    "detail.current_updated_at; read it again and retry. A request whose values "
    "all equal the stored ones changes nothing and keeps updated_at. "
    "A request with any destructive change (cancelling, changing or clearing "
    "a non-empty description or memo, moving a task to another goal) needs the "
    "writes:unconfirmed scope; without it the whole request is refused with 403 "
    "and nothing is written. Send the destructive change as a proposal instead."
)


NOTE_GUIDE = (
    "kind is projects, goals or tasks, and target_id is that item's id. "
    "Another user's item and a missing one both give 404. The request body is "
    "capped at 512 KB (raw bytes, before parsing): a larger body gets 413, "
    "decided before authentication. Raw HTML in the Markdown is shown as text."
)


def _goal_response(session: Session, user_id: UUID, goal_id: UUID) -> GoalResponse:
    goal = session.exec(_owned_goals(user_id).where(Goal.id == goal_id)).one()
    return GoalResponse.model_validate(goal)


def _task_response(session: Session, user_id: UUID, task_id: UUID) -> TaskResponse:
    task = session.exec(_owned_tasks(user_id).where(Task.id == task_id)).one()
    return TaskResponse.model_validate(task)


@router.post(
    "/goals",
    response_model=GoalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a goal",
    description=(
        "Create a goal in one of the user's projects. Another user's project and "
        "a missing one both give 404."
    ),
)
async def create_goal(
    data: AgentGoalCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.GOALS_WRITE))
    ],
) -> GoalResponse:
    goal = agent_write_service.create_goal(session, principal, data)
    return _goal_response(session, principal.user_id, goal.id)  # type: ignore[arg-type]


@router.patch(
    "/goals/{goal_id}",
    response_model=GoalResponse,
    summary="Update a goal",
    description=(
        f"{UPDATE_GUIDE} A status change must be an allowed transition, else 422."
    ),
)
async def update_goal(
    goal_id: UUID,
    data: AgentGoalUpdate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.GOALS_WRITE))
    ],
) -> GoalResponse:
    agent_write_service.update_goal(session, principal, goal_id, data)
    return _goal_response(session, principal.user_id, goal_id)


@router.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a task",
    description=(
        "Create a task in one of the user's goals. Another user's goal and a "
        "missing one both give 404. depends_on lists up to 20 of the user's "
        "tasks that must be finished first; if any is missing or another "
        "user's, the answer is 404 and nothing is created."
    ),
)
async def create_task(
    data: AgentTaskCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    task = agent_write_service.create_task(session, principal, data)
    return _task_response(session, principal.user_id, task.id)  # type: ignore[arg-type]


@router.patch(
    "/tasks/{task_id}",
    response_model=TaskResponse,
    summary="Update a task",
    description=(
        f"{UPDATE_GUIDE} memo_append adds text after the memo on a new line and "
        "is not destructive; it cannot be sent with memo, and the result must fit "
        "in 2000 characters."
    ),
)
async def update_task(
    task_id: UUID,
    data: AgentTaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    agent_write_service.update_task(session, principal, task_id, data)
    return _task_response(session, principal.user_id, task_id)


@router.post(
    "/tasks/{task_id}/dependencies",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": TaskResponse,
            "description": "The dependency already existed; nothing changed",
        }
    },
    summary="Add a task dependency",
    description=(
        "Make the task depend on depends_on_task_id (it comes after that task). "
        "Both must be the user's tasks, else 404. A task cannot depend on "
        "itself, and a dependency that would close a cycle is refused; both "
        "give 422. If the dependency already exists, nothing changes and the "
        "answer is 200 instead of 201. Not a destructive change."
    ),
)
async def add_task_dependency(
    task_id: UUID,
    data: AgentDependencyCreate,
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    _, added = agent_write_service.add_task_dependency(
        session, principal, task_id, data.depends_on_task_id
    )
    if not added:
        response.status_code = status.HTTP_200_OK
    return _task_response(session, principal.user_id, task_id)


@router.delete(
    "/tasks/{task_id}/dependencies/{depends_on_task_id}",
    response_model=TaskResponse,
    summary="Remove a task dependency",
    description=(
        "Remove the task's dependency on depends_on_task_id. This is a "
        "destructive change: it needs the writes:unconfirmed scope, else 403 "
        "and nothing changes; send it as a proposal instead. A dependency that "
        "does not exist gives 404."
    ),
)
async def remove_task_dependency(
    task_id: UUID,
    depends_on_task_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    agent_write_service.remove_task_dependency(
        session, principal, task_id, depends_on_task_id
    )
    return _task_response(session, principal.user_id, task_id)


@router.post(
    "/logs",
    response_model=LogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record work time on a task",
    description=(
        "Record a work log (time record) on one of the user's tasks: the minutes "
        "worked and, in comment, what was done. Logging work on a pending task "
        "makes it in_progress, as in the web app, which changes the task's "
        "updated_at. Another user's task and a missing one both give 404. Not "
        "a destructive change."
    ),
)
async def create_log(
    data: AgentLogCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.LOGS_WRITE))],
) -> LogResponse:
    log, _ = agent_write_service.create_log(session, principal, data)
    return LogResponse.model_validate(log)


# The note writes take whole notes, so they get a larger cap than the default.
notes_router = APIRouter(route_class=body_capped_route(NOTE_MAX_BODY_BYTES))


@notes_router.post(
    "/context-notes/{kind}/{target_id}/append",
    response_model=ContextNoteResponse,
    summary="Append to a note",
    description=(
        "Add Markdown to the end of the note of a project, goal or task, under a "
        "heading with your token name and today's date. Creates the note if the "
        "item has none. Not a destructive change, and no expected_updated_at is "
        f"needed. {NOTE_GUIDE}"
    ),
)
async def append_note(
    kind: NoteTargetKind,
    target_id: UUID,
    data: AgentNoteAppend,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.NOTES_WRITE))
    ],
) -> ContextNoteResponse:
    note = agent_write_service.append_note(session, principal, kind, target_id, data)
    return ContextNoteResponse.model_validate(note)


@notes_router.put(
    "/context-notes/{kind}/{target_id}",
    response_model=ContextNoteResponse,
    summary="Replace a note",
    description=(
        "Replace the whole note of a project, goal or task with the Markdown "
        "sent; an empty string empties it. Replacing a note that has text is a "
        "destructive change: it needs the writes:unconfirmed scope, else 403 "
        "and nothing changes; send it as a proposal instead. Creating the note "
        "or filling an empty one is not destructive. "
        f"{NOTE_REPLACE_LOSES} expected_updated_at must be the note's "
        "updated_at you last read, or null when the item has no note yet (that "
        "creates it). If they differ, nothing is written and the answer is 409 "
        "with detail.current_updated_at (null when there is no note); read it "
        f"again and retry. {NOTE_GUIDE}"
    ),
)
async def replace_note(
    kind: NoteTargetKind,
    target_id: UUID,
    data: AgentNoteReplace,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.NOTES_WRITE))
    ],
) -> ContextNoteResponse:
    note = agent_write_service.replace_note(session, principal, kind, target_id, data)
    return ContextNoteResponse.model_validate(note)


router.include_router(notes_router)
