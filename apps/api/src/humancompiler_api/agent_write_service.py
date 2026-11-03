# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent writes: goals and tasks created and updated by an agent token.

Each public write is one transaction: the entity and its ``agent_changes`` row
are committed together, and any error rolls both back. The helpers that do not
commit (``record_change``, ``require_destructive_allowed``,
``check_expected_updated_at``) are shared with the other agent writes.
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session, SQLModel, col, select

from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.agent_write_models import (
    AgentGoalCreate,
    AgentGoalUpdate,
    AgentTaskCreate,
    AgentTaskUpdate,
)
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    AgentChange,
    AgentChangeAction,
    AgentChangeActor,
    AgentChangeEntity,
    AgentScope,
    AgentToken,
    Goal,
    GoalCreate,
    GoalStatus,
    Task,
    TaskCreate,
    TaskStatus,
    WorkType,
)
from humancompiler_api.services import goal_service, project_service, task_service

DESTRUCTIVE_DETAIL = "This change needs the writes:unconfirmed scope"
STALE_MESSAGE = "Changed since you read it; read it again and retry"
MEMO_MAX_LENGTH = 2000
MEMO_APPEND_SEPARATOR = "\n"

# The columns are NOT NULL, so a null sent for these resets the default.
_TASK_DEFAULTS: dict[str, Any] = {"priority": 3, "work_type": WorkType.LIGHT_WORK}


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


def check_expected_updated_at(stored: datetime, expected: datetime) -> None:
    """Raise 409 unless the caller read the stored version.

    Both values are compared in UTC; a naive value counts as UTC."""
    current = _as_utc(stored)
    if current != _as_utc(expected):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "message": STALE_MESSAGE,
                "current_updated_at": current.isoformat(),
            },
        )


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
    agent_name = session.exec(
        select(AgentToken.name).where(AgentToken.id == principal.token_id)
    ).first()
    if agent_name is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid agent token")
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


def _owned_goal(session: Session, user_id: UUID, goal_id: UUID) -> Goal:
    try:
        goal = goal_service.get_goal(session, goal_id, user_id)
    except ResourceNotFoundError:
        raise _not_found("Goal not found") from None
    if goal is None:
        raise _not_found("Goal not found")
    return goal


def _owned_task(session: Session, user_id: UUID, task_id: UUID) -> Task:
    try:
        task = task_service.get_task(session, task_id, user_id)
    except ResourceNotFoundError:
        raise _not_found("Task not found") from None
    if task is None:
        raise _not_found("Task not found")
    return task


def _lock(session: Session, entity: Goal | Task) -> None:
    """Lock the entity's row (a no-op on SQLite), then reread it.

    Only the id is selected under ``FOR UPDATE`` so the goal's computed
    ``estimate_hours`` subquery never sits in a locking query. The refresh reads
    the values committed before the lock was granted."""
    model = type(entity)
    session.exec(
        select(col(model.id)).where(col(model.id) == entity.id).with_for_update()
    ).one()
    session.refresh(entity)


def _stored_updated_at(entity: Goal | Task) -> datetime:
    if entity.updated_at is None:
        # Every row gets updated_at on insert; a NULL means the row is broken.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Stored updated_at is missing; contact support"
        )
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
        try:
            project_service.get_project(session, data.project_id, principal.user_id)
        except ResourceNotFoundError:
            raise _not_found("Project not found") from None
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

    Cancelling and changing the description are destructive."""
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
        destructive = (
            changes.get("status", (None, None))[1] == GoalStatus.CANCELLED
            or "description" in changes
        )
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
    """Create a task under one of the user's goals."""
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
                priority=(
                    data.priority
                    if data.priority is not None
                    else _TASK_DEFAULTS["priority"]
                ),
                work_type=data.work_type or _TASK_DEFAULTS["work_type"],
            ),
            principal.user_id,
        )
        if task.id is None:
            raise RuntimeError("build() did not assign an id")
        record_change(
            session,
            principal,
            entity_type=AgentChangeEntity.TASK,
            entity_id=task.id,
            action=AgentChangeAction.CREATE,
            before=None,
            after={name: getattr(task, name) for name in data.model_fields_set},
            destructive=False,
            project_id=goal.project_id,
            goal_id=data.goal_id,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return task


def _is_destructive_task_change(changes: dict[str, tuple[Any, Any]]) -> bool:
    return bool(
        changes.get("status", (None, None))[1] == TaskStatus.CANCELLED
        or {"description", "memo", "goal_id"} & changes.keys()
    )


def update_task(
    session: Session, principal: AgentPrincipal, task_id: UUID, data: AgentTaskUpdate
) -> Task:
    """Change the sent fields of one of the user's tasks.

    Cancelling, changing the description or memo, and moving the task to
    another goal are destructive. ``memo_append`` adds to the memo and is not."""
    user_id = principal.user_id
    try:
        task = _owned_task(session, user_id, task_id)
        _lock(session, task)
        check_expected_updated_at(_stored_updated_at(task), data.expected_updated_at)

        requested: dict[str, Any] = {}
        for name in data.sent_fields() - {"memo_append"}:
            value = getattr(data, name)
            if value is None and name in _TASK_DEFAULTS:
                value = _TASK_DEFAULTS[name]
            requested[name] = value
        changes = _diff(task, requested)

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
