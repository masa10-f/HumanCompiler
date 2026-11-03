# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent writes: goals, tasks, task dependencies and notes written by an agent token.

Each public write is one transaction: the entity and its ``agent_changes`` row
are committed together, and any error rolls both back. The helpers that do not
commit (``record_change``, ``require_destructive_allowed``,
``check_expected_updated_at``) are shared with the other agent writes.
"""

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session, SQLModel, col, select

from humancompiler_api import proposal_service
from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.agent_write_models import (
    AgentGoalCreate,
    AgentGoalUpdate,
    AgentNoteAppend,
    AgentNoteReplace,
    AgentTaskCreate,
    AgentTaskUpdate,
    NoteTargetKind,
)
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    AgentChange,
    AgentChangeAction,
    AgentChangeActor,
    AgentChangeEntity,
    AgentScope,
    AgentToken,
    ContextNote,
    Goal,
    GoalCreate,
    GoalStatus,
    Project,
    Task,
    TaskCreate,
    TaskDependency,
    TaskStatus,
)
from humancompiler_api.note_markdown import markdown_to_note_html
from humancompiler_api.proposal_payloads import NoteTarget
from humancompiler_api.services import (
    _dependency_path_exists,
    _touch,
    goal_service,
    project_service,
    task_service,
)

DESTRUCTIVE_DETAIL = "This change needs the writes:unconfirmed scope"
SELF_DEPENDENCY_DETAIL = "Task cannot depend on itself"
CYCLE_DETAIL = "Creating this dependency would create a circular dependency"
STALE_MESSAGE = "Changed since you read it; read it again and retry"
MEMO_MAX_LENGTH = 2000
MEMO_APPEND_SEPARATOR = "\n"
_TAG = re.compile(r"<[^>]*>")
# Elements that are content without any text; a note holding one is not blank.
_CONTENT_ELEMENT = re.compile(
    r"<\s*(?:img|hr|video|audio|iframe|embed|object|svg|picture)\b", re.IGNORECASE
)


def _is_blank(value: str | None) -> bool:
    """True for a stored text the user has written nothing in."""
    return value is None or not value.strip()


def _is_blank_html(content: str) -> bool:
    """True for note HTML with no text, such as TipTap's empty ``<p></p>``.

    Strips the tags, decodes entities (``&nbsp;``) and whitespace. A note with
    an image or a horizontal rule is not blank, though it has no text."""
    if _CONTENT_ELEMENT.search(content):
        return False
    return not html.unescape(_TAG.sub("", content)).strip()


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; they are UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _comparable(value: Any) -> Any:
    return _as_utc(value) if isinstance(value, datetime) else value


def _to_json(values: dict[str, Any]) -> dict[str, Any]:
    """Field values as JSON: datetimes in UTC, Decimals as exact strings."""
    result: dict[str, Any] = jsonable_encoder(
        {name: _comparable(value) for name, value in values.items()},
        custom_encoder={Decimal: str},
    )
    return result


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)


def _stale(current: datetime | None) -> HTTPException:
    """409 with the stored updated_at in UTC (None: there is nothing stored)."""
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={
            "message": STALE_MESSAGE,
            "current_updated_at": (
                _as_utc(current).isoformat() if current is not None else None
            ),
        },
    )


def check_expected_updated_at(stored: datetime, expected: datetime) -> None:
    """Raise 409 unless the caller read the stored version.

    Both values are compared in UTC; a naive value counts as UTC."""
    if _as_utc(stored) != _as_utc(expected):
        raise _stale(stored)


def require_destructive_allowed(principal: AgentPrincipal) -> None:
    """Raise 403 unless the token may make destructive changes directly."""
    if AgentScope.WRITES_UNCONFIRMED.value not in principal.scopes:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DESTRUCTIVE_DETAIL)


def record_change(
    session: Session,
    principal: AgentPrincipal,
    *,
    entity_type: AgentChangeEntity,
    entity_id: UUID,
    action: AgentChangeAction,
    before: dict[str, Any] | None,
    after: dict[str, Any],
    destructive: bool,
    project_id: UUID | None,
    goal_id: UUID | None,
) -> AgentChange:
    """Add the ``agent_changes`` row for a write, flushed but not committed.

    ``agent_name`` copies the token's name now, so renaming the token later
    does not rewrite the history."""
    agent_name = _agent_name(session, principal)
    row = AgentChange(
        user_id=principal.user_id,
        actor=AgentChangeActor.AGENT.value,
        agent_token_id=principal.token_id,
        agent_name=agent_name,
        entity_type=entity_type.value,
        entity_id=entity_id,
        project_id=project_id,
        goal_id=goal_id,
        action=action.value,
        before=_to_json(before) if before is not None else None,
        after=_to_json(after),
        destructive=destructive,
    )
    session.add(row)
    session.flush()
    return row


def _agent_name(session: Session, principal: AgentPrincipal) -> str:
    """The token's current name."""
    agent_name = session.exec(
        select(AgentToken.name).where(AgentToken.id == principal.token_id)
    ).first()
    if agent_name is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid agent token")
    return agent_name


def _owned_project(session: Session, user_id: UUID, project_id: UUID) -> Project:
    try:
        project = project_service.get_project(session, project_id, user_id)
    except ResourceNotFoundError:
        raise _not_found("Project not found") from None
    if project is None:
        raise _not_found("Project not found")
    return project


def _owned_goal(session: Session, user_id: UUID, goal_id: UUID) -> Goal:
    try:
        goal = goal_service.get_goal(session, goal_id, user_id)
    except ResourceNotFoundError:
        raise _not_found("Goal not found") from None
    if goal is None:
        raise _not_found("Goal not found")
    return goal


def _owned_task(
    session: Session, user_id: UUID, task_id: UUID, detail: str = "Task not found"
) -> Task:
    try:
        task = task_service.get_task(session, task_id, user_id)
    except ResourceNotFoundError:
        raise _not_found(detail) from None
    if task is None:
        raise _not_found(detail)
    return task


def _lock(session: Session, entity: Goal | Task) -> None:
    """Lock the entity's row (a no-op on SQLite), then reread it.

    ``FOR NO KEY UPDATE`` serializes agent writes to the row, but does not wait
    for (or deadlock with) the ``FOR KEY SHARE`` that inserting a row with a
    foreign key to it takes, such as a new task under a locked goal. Only the
    id is selected so the goal's computed ``estimate_hours`` subquery never
    sits in a locking query. The refresh reads the values committed before the
    lock was granted."""
    model = type(entity)
    session.exec(
        select(col(model.id))
        .where(col(model.id) == entity.id)
        .with_for_update(key_share=True)
    ).one()
    session.refresh(entity)


def _stored_updated_at(entity: Goal | Task | ContextNote) -> datetime:
    if entity.updated_at is None:
        # Every row gets updated_at on insert; a NULL is a server fault (500).
        raise RuntimeError(f"{type(entity).__name__} {entity.id} has no updated_at")
    return entity.updated_at


def _diff(entity: SQLModel, requested: dict[str, Any]) -> dict[str, tuple[Any, Any]]:
    """``{field: (stored, requested)}`` for the fields whose value would change."""
    changes: dict[str, tuple[Any, Any]] = {}
    for name, new in requested.items():
        old = getattr(entity, name)
        if _comparable(old) != _comparable(new):
            changes[name] = (old, new)
    return changes


def _apply(entity: SQLModel, changes: dict[str, tuple[Any, Any]]) -> None:
    for name, (_, new) in changes.items():
        setattr(entity, name, new)


def create_goal(
    session: Session, principal: AgentPrincipal, data: AgentGoalCreate
) -> Goal:
    """Create a goal under one of the user's projects."""
    try:
        _owned_project(session, principal.user_id, data.project_id)
        goal = goal_service.build(
            session,
            GoalCreate(
                project_id=data.project_id,
                title=data.title,
                description=data.description,
                due_date=data.due_date,
            ),
            principal.user_id,
        )
        if goal.id is None:
            raise RuntimeError("build() did not assign an id")
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.GOAL,
            entity_id=goal.id,
            action=AgentChangeAction.CREATE,
            before=None,
            after={name: getattr(goal, name) for name in data.model_fields_set},
            destructive=False,
            project_id=goal.project_id,
            goal_id=goal.id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return goal


def update_goal(
    session: Session, principal: AgentPrincipal, goal_id: UUID, data: AgentGoalUpdate
) -> Goal:
    """Change the sent fields of one of the user's goals.

    Cancelling and changing a non-empty description are destructive."""
    try:
        goal = _owned_goal(session, principal.user_id, goal_id)
        _lock(session, goal)
        check_expected_updated_at(_stored_updated_at(goal), data.expected_updated_at)
        changes = _diff(
            goal, {name: getattr(data, name) for name in data.sent_fields()}
        )
        if not changes:
            session.commit()
            return goal
        if "status" in changes:
            goal_service._validate_status_transition(*changes["status"])
        destructive = changes.get("status", (None, None))[
            1
        ] == GoalStatus.CANCELLED or _overwrites_text(changes, {"description"})
        if destructive:
            require_destructive_allowed(principal)
        _apply(goal, changes)
        goal.updated_at = datetime.now(UTC)
        session.add(goal)
        session.flush()
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.GOAL,
            entity_id=goal_id,
            action=AgentChangeAction.UPDATE,
            before={name: old for name, (old, _) in changes.items()},
            after={name: new for name, (_, new) in changes.items()},
            destructive=destructive,
            project_id=goal.project_id,
            goal_id=goal_id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return goal


def create_task(
    session: Session, principal: AgentPrincipal, data: AgentTaskCreate
) -> Task:
    """Create a task under one of the user's goals, with its dependencies.

    The task and every dependency in ``depends_on`` are one transaction: a
    missing or foreign dependency (404) creates nothing."""
    try:
        goal = _owned_goal(session, principal.user_id, data.goal_id)
        task = task_service.build(
            session,
            TaskCreate(
                goal_id=data.goal_id,
                title=data.title,
                description=data.description,
                estimate_hours=data.estimate_hours,
                due_date=data.due_date,
                status=TaskStatus.PENDING,
                priority=data.priority,
                work_type=data.work_type,
            ),
            principal.user_id,
        )
        if task.id is None:
            raise RuntimeError("build() did not assign an id")
        after = {
            name: getattr(task, name) for name in data.model_fields_set - {"depends_on"}
        }
        if "depends_on" in data.model_fields_set:
            after["depends_on"] = data.depends_on
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.TASK,
            entity_id=task.id,
            action=AgentChangeAction.CREATE,
            before=None,
            after=after,
            destructive=False,
            project_id=goal.project_id,
            goal_id=data.goal_id,
        )
        for depends_on_task_id in data.depends_on:
            depends_on = _owned_task(
                session,
                principal.user_id,
                depends_on_task_id,
                "Dependency task not found",
            )
            _insert_dependency(session, principal, task, depends_on, goal.project_id)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return task


def _overwrites_text(changes: dict[str, tuple[Any, Any]], fields: set[str]) -> bool:
    """True if a change replaces or clears text the user wrote in ``fields``.

    Filling an empty field erases nothing, so it is not destructive."""
    return any(name in changes and not _is_blank(changes[name][0]) for name in fields)


def _is_destructive_task_change(changes: dict[str, tuple[Any, Any]]) -> bool:
    return bool(
        changes.get("status", (None, None))[1] == TaskStatus.CANCELLED
        or "goal_id" in changes
        or _overwrites_text(changes, {"description", "memo"})
    )


def update_task(
    session: Session, principal: AgentPrincipal, task_id: UUID, data: AgentTaskUpdate
) -> Task:
    """Change the sent fields of one of the user's tasks.

    Cancelling, changing a non-empty description or memo, and moving the task
    to another goal are destructive. ``memo_append`` adds to the memo and is
    not."""
    user_id = principal.user_id
    try:
        task = _owned_task(session, user_id, task_id)
        _lock(session, task)
        check_expected_updated_at(_stored_updated_at(task), data.expected_updated_at)

        changes = _diff(
            task,
            {
                name: getattr(data, name)
                for name in data.sent_fields() - {"memo_append"}
            },
        )

        if "goal_id" in changes:
            goal = _owned_goal(session, user_id, changes["goal_id"][1])
        else:
            goal = _owned_goal(session, user_id, task.goal_id)

        appended = data.memo_append
        stored_memo = task.memo or ""
        new_memo: str | None = None
        if appended is not None:
            new_memo = (
                stored_memo + MEMO_APPEND_SEPARATOR + appended
                if stored_memo
                else appended
            )
            if len(new_memo) > MEMO_MAX_LENGTH:
                raise _unprocessable(
                    f"memo would exceed {MEMO_MAX_LENGTH} characters after the append"
                )

        if not changes and new_memo is None:
            session.commit()
            return task

        destructive = _is_destructive_task_change(changes)
        if destructive:
            require_destructive_allowed(principal)

        before = {name: old for name, (old, _) in changes.items()}
        after = {name: new for name, (_, new) in changes.items()}
        _apply(task, changes)
        if new_memo is not None:
            before["memo_length"] = len(stored_memo)
            after["memo_append"] = appended
            task.memo = new_memo
        task.updated_at = datetime.now(UTC)
        session.add(task)
        session.flush()
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.TASK,
            entity_id=task_id,
            action=AgentChangeAction.UPDATE,
            before=before,
            after=after,
            destructive=destructive,
            project_id=goal.project_id,
            goal_id=goal.id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return task


def _task_id(task: Task) -> UUID:
    if task.id is None:
        raise RuntimeError("Task has no id")
    return task.id


def _insert_dependency(
    session: Session,
    principal: AgentPrincipal,
    task: Task,
    depends_on: Task,
    project_id: UUID,
) -> bool:
    """Make ``task`` depend on ``depends_on``, flushed but not committed.

    Both tasks must already be the user's. Applies the checks of
    ``task_service.add_task_dependency`` with 422 instead of its 400. Returns
    False, changing nothing, when the dependency already exists."""
    task_id, depends_on_task_id = _task_id(task), _task_id(depends_on)
    if task_id == depends_on_task_id:
        raise _unprocessable(SELF_DEPENDENCY_DETAIL)
    if _dependency_path_exists(
        session,
        TaskDependency.task_id,
        TaskDependency.depends_on_task_id,
        depends_on_task_id,
        task_id,
    ):
        raise _unprocessable(CYCLE_DETAIL)
    existing = session.exec(
        select(TaskDependency.id)
        .where(TaskDependency.task_id == task_id)
        .where(TaskDependency.depends_on_task_id == depends_on_task_id)
    ).first()
    if existing is not None:
        return False
    dependency_id = uuid4()
    session.add(
        TaskDependency(
            id=dependency_id, task_id=task_id, depends_on_task_id=depends_on_task_id
        )
    )
    _touch(session, task)
    session.flush()
    record_change(
        session,
        principal,
        entity_type=AgentChangeEntity.TASK_DEPENDENCY,
        entity_id=dependency_id,
        action=AgentChangeAction.CREATE,
        before=None,
        after={"task_id": task_id, "depends_on_task_id": depends_on_task_id},
        destructive=False,
        project_id=project_id,
        goal_id=task.goal_id,
    )
    return True


def add_task_dependency(
    session: Session, principal: AgentPrincipal, task_id: UUID, depends_on_task_id: UUID
) -> tuple[Task, bool]:
    """Make one of the user's tasks depend on another of theirs.

    Returns the dependent task and whether a dependency was added; adding an
    existing one changes nothing and records nothing. Not destructive."""
    user_id = principal.user_id
    try:
        task = _owned_task(session, user_id, task_id)
        depends_on = _owned_task(
            session, user_id, depends_on_task_id, "Dependency task not found"
        )
        # Lock both tasks in one order, so two requests adding A->B and B->A
        # run one after the other and the second sees the first's row.
        for entity in sorted((task, depends_on), key=lambda item: str(item.id)):
            _lock(session, entity)
        goal = _owned_goal(session, user_id, task.goal_id)
        added = _insert_dependency(
            session, principal, task, depends_on, goal.project_id
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return task, added


def remove_task_dependency(
    session: Session, principal: AgentPrincipal, task_id: UUID, depends_on_task_id: UUID
) -> Task:
    """Remove a dependency of one of the user's tasks. Destructive.

    There is no ``expected_updated_at``: a dependency has no version. A pair
    that does not exist is 404."""
    user_id = principal.user_id
    try:
        task = _owned_task(session, user_id, task_id)
        _lock(session, task)
        dependency = session.exec(
            select(TaskDependency)
            .where(TaskDependency.task_id == task_id)
            .where(TaskDependency.depends_on_task_id == depends_on_task_id)
        ).first()
        if dependency is None:
            raise _not_found("Dependency not found")
        require_destructive_allowed(principal)
        goal = _owned_goal(session, user_id, task.goal_id)
        dependency_id = dependency.id
        if dependency_id is None:
            raise RuntimeError("Task dependency has no id")
        session.delete(dependency)
        _touch(session, task)
        session.flush()
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.TASK_DEPENDENCY,
            entity_id=dependency_id,
            action=AgentChangeAction.UPDATE,
            before={"task_id": task_id, "depends_on_task_id": depends_on_task_id},
            after={"removed": True},
            destructive=True,
            project_id=goal.project_id,
            goal_id=task.goal_id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return task


@dataclass(frozen=True)
class _NoteTarget:
    """The item a note is on, with the parents its change rows carry."""

    target: NoteTarget
    project_id: UUID
    goal_id: UUID | None


def _owned_note_target(
    session: Session, user_id: UUID, kind: NoteTargetKind, target_id: UUID
) -> _NoteTarget:
    """Check the note's project, goal or task is the user's (else 404)."""
    if kind == "projects":
        _owned_project(session, user_id, target_id)
        return _NoteTarget(NoteTarget(project_id=target_id), target_id, None)
    if kind == "goals":
        goal = _owned_goal(session, user_id, target_id)
        return _NoteTarget(NoteTarget(goal_id=target_id), goal.project_id, target_id)
    task = _owned_task(session, user_id, target_id)
    goal = _owned_goal(session, user_id, task.goal_id)
    return _NoteTarget(NoteTarget(task_id=target_id), goal.project_id, task.goal_id)


def _note_id(note: ContextNote) -> UUID:
    if note.id is None:
        raise RuntimeError("Context note has no id")
    return note.id


def _check_note_version(note: ContextNote | None, expected: datetime | None) -> None:
    """Raise 409 unless ``expected`` is the note's updated_at.

    ``expected`` is None only for an item without a note, and the 409 for a
    missing note has ``current_updated_at`` None."""
    if note is None:
        if expected is not None:
            raise _stale(None)
        return
    stored = _stored_updated_at(note)
    if expected is None:
        raise _stale(stored)
    check_expected_updated_at(stored, expected)


def _create_note_for_replace(
    session: Session, user_id: UUID, note_target: _NoteTarget
) -> ContextNote:
    """Create the missing note; a concurrent first create gives the stale 409.

    ``create_note`` answers that race with a plain-text 409; the PUT answers
    every 409 with ``{message, current_updated_at}``."""
    try:
        return proposal_service.create_note(session, user_id, note_target.target)
    except HTTPException as error:
        if error.status_code == status.HTTP_409_CONFLICT:
            raise _stale(None) from None
        raise


def append_note(
    session: Session,
    principal: AgentPrincipal,
    kind: NoteTargetKind,
    target_id: UUID,
    data: AgentNoteAppend,
) -> ContextNote:
    """Append Markdown to the note of one of the user's projects, goals or tasks.

    The text goes under a heading with the token's name and today's date (JST),
    as an accepted note_append proposal does. Creates the note if the item has
    none. Not destructive."""
    try:
        note_target = _owned_note_target(session, principal.user_id, kind, target_id)
        note = proposal_service.lock_note(session, note_target.target)
        if note is None:
            note = proposal_service.create_note(
                session, principal.user_id, note_target.target
            )
        old_length = len(note.content)
        block = proposal_service.append_agent_markdown(
            note, _agent_name(session, principal), data.content_markdown
        )
        session.add(note)
        session.flush()
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.CONTEXT_NOTE,
            entity_id=_note_id(note),
            action=AgentChangeAction.APPEND,
            before={"length": old_length},
            after={"appended_html": block},
            destructive=False,
            project_id=note_target.project_id,
            goal_id=note_target.goal_id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return note


def replace_note(
    session: Session,
    principal: AgentPrincipal,
    kind: NoteTargetKind,
    target_id: UUID,
    data: AgentNoteReplace,
) -> ContextNote:
    """Replace the note of one of the user's projects, goals or tasks.

    Destructive when the note has text (see ``_is_blank_html``); creating the
    note or filling an empty one is not. ``expected_updated_at`` must be the
    note's updated_at, or None when the item has no note yet; then the note is
    created. Replacing an existing note with the HTML it already has changes
    nothing and records nothing."""
    try:
        note_target = _owned_note_target(session, principal.user_id, kind, target_id)
        note = proposal_service.lock_note(session, note_target.target)
        _check_note_version(note, data.expected_updated_at)
        destructive = note is not None and not _is_blank_html(note.content)
        if destructive:
            require_destructive_allowed(principal)
        new_html = markdown_to_note_html(data.content_markdown)
        if note is not None and note.content == new_html:
            session.commit()
            return note
        if note is None:
            note = _create_note_for_replace(session, principal.user_id, note_target)
        old_html = note.content
        note.content = new_html
        note.content_type = "html"
        note.updated_at = datetime.now(UTC)
        session.add(note)
        session.flush()
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.CONTEXT_NOTE,
            entity_id=_note_id(note),
            action=AgentChangeAction.REPLACE,
            before={"content": old_html},
            after={"content": new_html},
            destructive=destructive,
            project_id=note_target.project_id,
            goal_id=note_target.goal_id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return note
