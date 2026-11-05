# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Write tools of the MCP server, and ``list_my_changes``.

Each write tool takes the REST body's fields as arguments and builds the PR1
request model (``agent_write_models``) from them inside the guarded call, so
the limits, the explicit-null rules and the 422 errors are REST's, and audited.
The writes themselves are ``agent_write_service``'s: ownership (another user's
ID is a 404 like a missing one), ``expected_updated_at``, the
``writes:unconfirmed`` check for destructive changes and the ``agent_changes``
rows are all shared with REST.

An optional argument the caller leaves out defaults to pydantic's ``MISSING``
sentinel and is not passed to the model, so it stays unset; an explicit
``null`` is passed through. That keeps "not sent" and ``null`` apart, as the
REST body's ``model_fields_set`` does.
"""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from mcp.server.mcpserver import Context
from mcp_types import CallToolResult, ToolAnnotations
from pydantic import MISSING, BaseModel, Field
from sqlmodel import Session, col, select

from humancompiler_api import agent_write_service
from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.agent_write_models import (
    DEPENDS_ON_MAX,
    EXPECTED_UPDATED_AT_DESCRIPTION,
    NOTE_REPLACE_LOSES,
    AgentGoalCreate,
    AgentGoalUpdate,
    AgentLogCreate,
    AgentNoteAppend,
    AgentNoteReplace,
    AgentTaskCreate,
    AgentTaskUpdate,
    Hours,
    LOG_COMMENT_MAX,
    LOG_MINUTES_MAX,
    NoteTargetKind,
)
from humancompiler_api.mcp_server import guarded_call, mcp_server
from humancompiler_api.mcp_tools_read import _note_payload, _utc_iso
from humancompiler_api.models import (
    AgentChange,
    AgentProposal,
    AgentScope,
    GoalStatus,
    LogResponse,
    TaskStatus,
    WorkType,
)
from humancompiler_api.routers.agent_writes import _goal_response, _task_response

NoteKind = Literal["project", "goal", "task"]

_NOTE_KINDS: dict[NoteKind, NoteTargetKind] = {
    "project": "projects",
    "goal": "goals",
    "task": "tasks",
}

_CREATE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
_MAY_DESTROY = ToolAnnotations(read_only_hint=False, destructive_hint=True)
_ADD_DEPENDENCY = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True
)
_READ_ONLY = ToolAnnotations(read_only_hint=True)

_UNCONFIRMED = (
    "need the writes:unconfirmed scope; without it the whole call is refused "
    "with a 403 error and nothing is written"
)
_UPDATE_GUIDE = (
    "Only the arguments you pass change: leave an argument out to keep the "
    "stored value, or pass null to clear description, memo or due_date. null "
    "for any other field is a 422 error. expected_updated_at must be the "
    "updated_at you last read; if the item changed since, nothing is written "
    "and the error is 409 with detail.current_updated_at, so read it again and "
    "retry. A call whose values all equal the stored ones changes nothing."
)
_NOT_FOUND = "Another user's item and a missing one both give a 404 error."
_DUE_DATE_DESCRIPTION = (
    "YYYY-MM-DD (taken as 00:00 JST) or an ISO 8601 date-time with an offset."
)


def _field_description(model: type[BaseModel], name: str) -> str | None:
    return model.model_fields[name].description


def _sent(**arguments: Any) -> dict[str, Any]:
    """The arguments the caller passed, null included; left-out ones dropped."""
    return {name: value for name, value in arguments.items() if value is not MISSING}


def _goal(session: Session, principal: AgentPrincipal, goal_id: Any) -> dict[str, Any]:
    response = _goal_response(session, principal.user_id, goal_id)
    return response.model_dump(mode="json")


def _task(session: Session, principal: AgentPrincipal, task_id: Any) -> dict[str, Any]:
    response = _task_response(session, principal.user_id, task_id)
    return response.model_dump(mode="json")


# --- Argument types --------------------------------------------------------------
#
# They mirror the PR1 models so the schema agents see is accurate. Optional
# update fields are nullable in the schema, as in REST's OpenAPI; the model
# then rejects null where it is not allowed, as an audited 422.

Title = Annotated[str, Field(min_length=1, max_length=200)]
Description = Annotated[str | None, Field(max_length=1000)]
DueDateArg = Annotated[str | None, Field(description=_DUE_DATE_DESCRIPTION)]
ExpectedUpdatedAt = Annotated[
    datetime, Field(description=EXPECTED_UPDATED_AT_DESCRIPTION)
]


# --- Goals ------------------------------------------------------------------------


@mcp_server.tool(
    name="create_goal",
    description=(
        "Create a goal in one of the user's projects. Returns {goal}. "
        f"{_NOT_FOUND} Not a destructive change."
    ),
    annotations=_CREATE,
)
async def create_goal(
    project_id: UUID,
    title: Title,
    ctx: Context,
    description: Description | MISSING = MISSING,
    due_date: DueDateArg | MISSING = MISSING,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentGoalCreate(
            project_id=project_id,
            title=title,
            **_sent(description=description, due_date=due_date),
        )
        goal = agent_write_service.create_goal(session, principal, data)
        return {"goal": _goal(session, principal, goal.id)}

    return await guarded_call("create_goal", AgentScope.GOALS_WRITE, run, ctx)


@mcp_server.tool(
    name="update_goal",
    description=(
        f"Update one of the user's goals. {_UPDATE_GUIDE} A status change must "
        "be an allowed transition, else a 422 error. Destructive changes "
        "(status cancelled, changing or clearing a non-empty description) "
        f"{_UNCONFIRMED}. Returns {{applied: true, goal}}. {_NOT_FOUND}"
    ),
    annotations=_MAY_DESTROY,
)
async def update_goal(
    goal_id: UUID,
    expected_updated_at: ExpectedUpdatedAt,
    ctx: Context,
    title: Annotated[
        str | None,
        Field(min_length=1, max_length=200, description="Cannot be null."),
    ]
    | MISSING = MISSING,
    description: Description | MISSING = MISSING,
    due_date: DueDateArg | MISSING = MISSING,
    status: Annotated[GoalStatus | None, Field(description="Cannot be null.")]
    | MISSING = MISSING,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentGoalUpdate(
            expected_updated_at=expected_updated_at,
            **_sent(
                title=title, description=description, due_date=due_date, status=status
            ),
        )
        agent_write_service.update_goal(session, principal, goal_id, data)
        return {"applied": True, "goal": _goal(session, principal, goal_id)}

    return await guarded_call("update_goal", AgentScope.GOALS_WRITE, run, ctx)


# --- Tasks ------------------------------------------------------------------------


@mcp_server.tool(
    name="create_task",
    description=(
        "Create a task in one of the user's goals. Returns {task}. depends_on "
        f"lists up to {DEPENDS_ON_MAX} of the user's tasks that must be "
        "finished first; if any is missing or another user's, the error is 404 "
        f"and nothing is created. {_NOT_FOUND} Not a destructive change."
    ),
    annotations=_CREATE,
)
async def create_task(
    goal_id: UUID,
    title: Title,
    estimate_hours: Annotated[Hours, Field(description="Hours, e.g. 1.5.")],
    ctx: Context,
    description: Description | MISSING = MISSING,
    due_date: DueDateArg | MISSING = MISSING,
    priority: Annotated[
        int,
        Field(ge=1, le=5, description=_field_description(AgentTaskCreate, "priority")),
    ]
    | MISSING = MISSING,
    work_type: Annotated[
        WorkType,
        Field(description="Defaults to light_work. Cannot be null."),
    ]
    | MISSING = MISSING,
    depends_on: Annotated[
        list[UUID],
        Field(
            max_length=DEPENDS_ON_MAX,
            description=_field_description(AgentTaskCreate, "depends_on"),
        ),
    ]
    | MISSING = MISSING,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentTaskCreate(
            goal_id=goal_id,
            title=title,
            estimate_hours=estimate_hours,
            **_sent(
                description=description,
                due_date=due_date,
                priority=priority,
                work_type=work_type,
                depends_on=depends_on,
            ),
        )
        task = agent_write_service.create_task(session, principal, data)
        return {"task": _task(session, principal, task.id)}

    return await guarded_call("create_task", AgentScope.TASKS_WRITE, run, ctx)


@mcp_server.tool(
    name="update_task",
    description=(
        f"Update one of the user's tasks. {_UPDATE_GUIDE} Destructive changes "
        "(status cancelled, changing or clearing a non-empty description or "
        "memo, and goal_id, which moves the task to another goal) "
        f"{_UNCONFIRMED}. memo_append adds text after the memo on a new line "
        "and is not destructive; it cannot be passed with memo, and the result "
        "must fit in 2000 characters. To finish a task, pass status completed "
        "with a memo_append summary. Returns {applied: true, task}. "
        f"{_NOT_FOUND}"
    ),
    annotations=_MAY_DESTROY,
)
async def update_task(
    task_id: UUID,
    expected_updated_at: ExpectedUpdatedAt,
    ctx: Context,
    title: Annotated[
        str | None,
        Field(min_length=1, max_length=200, description="Cannot be null."),
    ]
    | MISSING = MISSING,
    description: Description | MISSING = MISSING,
    memo: Annotated[str | None, Field(max_length=2000)] | MISSING = MISSING,
    memo_append: Annotated[
        str | None,
        Field(
            min_length=1,
            max_length=2000,
            description=_field_description(AgentTaskUpdate, "memo_append"),
        ),
    ]
    | MISSING = MISSING,
    estimate_hours: Annotated[Hours | None, Field(description="Cannot be null.")]
    | MISSING = MISSING,
    due_date: DueDateArg | MISSING = MISSING,
    status: Annotated[TaskStatus | None, Field(description="Cannot be null.")]
    | MISSING = MISSING,
    priority: Annotated[
        int | None,
        Field(ge=1, le=5, description=_field_description(AgentTaskUpdate, "priority")),
    ]
    | MISSING = MISSING,
    work_type: Annotated[WorkType | None, Field(description="Cannot be null.")]
    | MISSING = MISSING,
    goal_id: Annotated[
        UUID | None,
        Field(description="Move the task to another goal (destructive)."),
    ]
    | MISSING = MISSING,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentTaskUpdate(
            expected_updated_at=expected_updated_at,
            **_sent(
                title=title,
                description=description,
                memo=memo,
                memo_append=memo_append,
                estimate_hours=estimate_hours,
                due_date=due_date,
                status=status,
                priority=priority,
                work_type=work_type,
                goal_id=goal_id,
            ),
        )
        agent_write_service.update_task(session, principal, task_id, data)
        return {"applied": True, "task": _task(session, principal, task_id)}

    return await guarded_call("update_task", AgentScope.TASKS_WRITE, run, ctx)


# --- Task dependencies ----------------------------------------------------------


@mcp_server.tool(
    name="add_dependency",
    description=(
        "Make the task depend on depends_on_task_id (it comes after that task). "
        "Both must be the user's tasks, else a 404 error. A task cannot depend "
        "on itself, and a dependency that would close a cycle is refused; both "
        "give a 422 error. If the dependency already exists, nothing changes "
        "and created is false. Returns {task, created}. Not a destructive change."
    ),
    annotations=_ADD_DEPENDENCY,
)
async def add_dependency(
    task_id: UUID, depends_on_task_id: UUID, ctx: Context
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        _, created = agent_write_service.add_task_dependency(
            session, principal, task_id, depends_on_task_id
        )
        return {"task": _task(session, principal, task_id), "created": created}

    return await guarded_call("add_dependency", AgentScope.TASKS_WRITE, run, ctx)


@mcp_server.tool(
    name="remove_dependency",
    description=(
        "Remove the task's dependency on depends_on_task_id. This is a "
        f"destructive change: removing it and every other destructive change "
        f"{_UNCONFIRMED}. A dependency that does not exist gives a 404 error. "
        "Returns {applied: true, task}."
    ),
    annotations=_MAY_DESTROY,
)
async def remove_dependency(
    task_id: UUID, depends_on_task_id: UUID, ctx: Context
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        agent_write_service.remove_task_dependency(
            session, principal, task_id, depends_on_task_id
        )
        return {"applied": True, "task": _task(session, principal, task_id)}

    return await guarded_call("remove_dependency", AgentScope.TASKS_WRITE, run, ctx)


# --- Notes ------------------------------------------------------------------------

_NOTE_TARGET = (
    "kind is project, goal or task, and id is that item's id. Another user's "
    "item and a missing one both give a 404 error. Raw HTML in the Markdown is "
    "shown as text."
)


@mcp_server.tool(
    name="append_note",
    description=(
        "Add Markdown to the end of the note of a project, goal or task, under a "
        "heading with your token name and today's date. Creates the note if the "
        "item has none. Use it for dated work summaries. Not a destructive "
        "change, and no expected_updated_at is needed. Returns {note: {id, "
        f"updated_at, content_markdown}}, the whole note as Markdown. {_NOTE_TARGET}"
    ),
    annotations=_CREATE,
)
async def append_note(
    kind: NoteKind,
    id: UUID,
    content_markdown: Annotated[
        str,
        Field(
            min_length=1,
            max_length=20000,
            description=_field_description(AgentNoteAppend, "content_markdown"),
        ),
    ],
    ctx: Context,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentNoteAppend(content_markdown=content_markdown)
        note = agent_write_service.append_note(
            session, principal, _NOTE_KINDS[kind], id, data
        )
        return {"note": _note_payload(note)}

    return await guarded_call("append_note", AgentScope.NOTES_WRITE, run, ctx)


@mcp_server.tool(
    name="replace_note",
    description=(
        "Replace the whole note of a project, goal or task with the Markdown "
        "passed; an empty string empties it. Use it only when the user asks you "
        "to tidy the note. Replacing a note that has text is a destructive "
        f"change: it and every other destructive change {_UNCONFIRMED}. "
        "Creating the note or filling an empty one is not destructive. "
        f"{NOTE_REPLACE_LOSES} expected_updated_at must be the note's "
        "updated_at you last read, or null when the item has no note yet (that "
        "creates it). If they differ, nothing is written and the error is 409 "
        "with detail.current_updated_at (null when there is no note); read it "
        "again and retry. Returns {applied: true, note: {id, updated_at, "
        f"content_markdown}}. {_NOTE_TARGET}"
    ),
    annotations=_MAY_DESTROY,
)
async def replace_note(
    kind: NoteKind,
    id: UUID,
    expected_updated_at: Annotated[
        datetime | None,
        Field(description=_field_description(AgentNoteReplace, "expected_updated_at")),
    ],
    content_markdown: Annotated[
        str,
        Field(
            max_length=100000,
            description=_field_description(AgentNoteReplace, "content_markdown"),
        ),
    ],
    ctx: Context,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentNoteReplace(
            expected_updated_at=expected_updated_at,
            content_markdown=content_markdown,
        )
        note = agent_write_service.replace_note(
            session, principal, _NOTE_KINDS[kind], id, data
        )
        return {"applied": True, "note": _note_payload(note)}

    return await guarded_call("replace_note", AgentScope.NOTES_WRITE, run, ctx)


# --- Work logs --------------------------------------------------------------------


@mcp_server.tool(
    name="create_log",
    description=(
        "Record a work log (time record) on one of the user's tasks: "
        "actual_minutes is the time worked, and comment says what was done in "
        f"it (up to {LOG_COMMENT_MAX} characters), written so the user can read "
        "it later. Use it at the end of your work on a task. Logging work on a "
        "pending task makes it in_progress, as in the web app, which changes "
        "the task's updated_at; the result carries the task as it is now, so "
        "use its updated_at for a following update_task. Returns {log: {id, "
        "task_id, actual_minutes, comment, created_at, updated_at}, task}. "
        f"{_NOT_FOUND} Not a destructive change."
    ),
    annotations=_CREATE,
)
async def create_log(
    task_id: UUID,
    actual_minutes: Annotated[
        int,
        Field(
            gt=0,
            le=LOG_MINUTES_MAX,
            description=_field_description(AgentLogCreate, "actual_minutes"),
        ),
    ],
    ctx: Context,
    comment: Annotated[
        str | None,
        Field(
            max_length=LOG_COMMENT_MAX,
            description=_field_description(AgentLogCreate, "comment"),
        ),
    ]
    | MISSING = MISSING,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        data = AgentLogCreate(
            task_id=task_id,
            actual_minutes=actual_minutes,
            **_sent(comment=comment),
        )
        log, task = agent_write_service.create_log(session, principal, data)
        return {
            "log": LogResponse.model_validate(log).model_dump(mode="json"),
            "task": _task(session, principal, task.id),
        }

    return await guarded_call("create_log", AgentScope.LOGS_WRITE, run, ctx)


# --- list_my_changes ----------------------------------------------------------------


def _optional_iso(value: datetime | None) -> str | None:
    return _utc_iso(value) if value is not None else None


def _change_payload(row: AgentChange) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "created_at": _utc_iso(row.created_at),
        "entity_type": row.entity_type,
        "entity_id": str(row.entity_id),
        "action": row.action,
        "destructive": row.destructive,
        "reverted_at": _optional_iso(row.reverted_at),
    }


def _proposal_payload(row: AgentProposal) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "title": row.title,
        "status": row.status,
        "created_at": _utc_iso(row.created_at),
        "decided_at": _optional_iso(row.decided_at),
    }


@mcp_server.tool(
    name="list_my_changes",
    description=(
        "List the changes and proposals made with your own token, newest first: "
        "changes {id, created_at, entity_type, entity_id, action, destructive, "
        "reverted_at} (reverted_at is set when the user undid it) and proposals "
        "{id, kind, title, status, created_at, decided_at}. Up to limit of each. "
        "Any valid token may call it, since it shows only that token's own rows; "
        "proposals are listed only for a token with proposals:read and are an "
        "empty list without it. Use it to check what you already did before "
        "repeating work."
    ),
    annotations=_READ_ONLY,
)
async def list_my_changes(
    ctx: Context,
    limit: Annotated[
        int, Field(ge=1, le=100, description="Most changes and most proposals.")
    ] = 20,
) -> CallToolResult:
    def run(session: Session, principal: AgentPrincipal) -> dict[str, Any]:
        changes = session.exec(
            select(AgentChange)
            .where(AgentChange.user_id == principal.user_id)
            .where(AgentChange.agent_token_id == principal.token_id)
            .order_by(col(AgentChange.created_at).desc(), col(AgentChange.id).desc())
            .limit(limit)
        ).all()
        if AgentScope.PROPOSALS_READ.value not in principal.scopes:
            return {
                "changes": [_change_payload(row) for row in changes],
                "proposals": [],
            }
        proposals = session.exec(
            select(AgentProposal)
            .where(AgentProposal.user_id == principal.user_id)
            .where(AgentProposal.token_id == principal.token_id)
            .order_by(
                col(AgentProposal.created_at).desc(), col(AgentProposal.id).desc()
            )
            .limit(limit)
        ).all()
        return {
            "changes": [_change_payload(row) for row in changes],
            "proposals": [_proposal_payload(row) for row in proposals],
        }

    # No scope: the token reads only its own rows. Still authenticated,
    # rate-limited and audited.
    return await guarded_call("list_my_changes", (), run, ctx)
