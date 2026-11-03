# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Proposal inbox: intake of agent proposals and the rules around it.

A plain module of functions. Accepting and rejecting a proposal, and the web
router, live beside the intake here and share its helpers.
"""

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    AgentProposal,
    AgentProposalResponse,
    AgentToken,
    ContextNote,
    Goal,
    GoalCreate,
    Project,
    ProposalKind,
    ProposalResponse,
    ProposalResultType,
    ProposalStatus,
    QuickTaskCreate,
    Task,
    TaskCreate,
)
from humancompiler_api.note_markdown import (
    agent_append_heading,
    append_html,
    markdown_to_note_html,
)
from humancompiler_api.proposal_payloads import (
    EDITABLE_KINDS,
    DecisionRequestPayload,
    NoteAppendPayload,
    ProposalAcceptRequest,
    ProposalCreateRequest,
    ProposalRejectRequest,
    normalize_payload,
    parse_payload,
)
from humancompiler_api.services import (
    goal_service,
    project_service,
    quick_task_service,
    task_service,
)

logger = logging.getLogger(__name__)

MAX_PENDING_PROPOSALS = 200

# The date in the heading of an agent's note append is the user's calendar day.
APP_TIMEZONE = ZoneInfo("Asia/Tokyo")


def _unknown(field: str) -> HTTPException:
    """The same answer for an ID that is missing and one that is not the user's."""
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown {field}"
    )


def _project_of_project(
    session: Session, user_id: UUID, value: Any, field: str
) -> UUID:
    try:
        return project_service.get_project(session, value, user_id).id  # type: ignore[union-attr,return-value]
    except ResourceNotFoundError:
        raise _unknown(field) from None


def _project_of_goal(session: Session, user_id: UUID, value: Any, field: str) -> UUID:
    try:
        return goal_service.get_goal(session, value, user_id).project_id  # type: ignore[union-attr]
    except ResourceNotFoundError:
        raise _unknown(field) from None


def _project_of_task(session: Session, user_id: UUID, value: Any, field: str) -> UUID:
    try:
        task = task_service.get_task(session, value, user_id)
    except ResourceNotFoundError:
        raise _unknown(field) from None
    # A task's goal belongs to the same user as the task.
    return _project_of_goal(session, user_id, task.goal_id, field)  # type: ignore[union-attr]


def resolve_project_id(
    session: Session, user_id: UUID, kind: ProposalKind, payload: dict[str, Any]
) -> UUID | None:
    """Check that every ID the payload points at is the user's and find its project.

    An ID that is not the user's and one that does not exist both raise the same
    422, so the answer does not tell which IDs exist.
    """
    if kind is ProposalKind.QUICK_TASK:
        return None
    if kind is ProposalKind.TASK:
        return _project_of_goal(session, user_id, payload["goal_id"], "goal_id")
    if kind is ProposalKind.NOTE_APPEND:
        target = payload["target"]
        if target.get("task_id") is not None:
            return _project_of_task(
                session, user_id, target["task_id"], "target.task_id"
            )
        if target.get("goal_id") is not None:
            return _project_of_goal(
                session, user_id, target["goal_id"], "target.goal_id"
            )
        return _project_of_project(
            session, user_id, target["project_id"], "target.project_id"
        )
    if payload.get("project_id") is None:
        return None
    return _project_of_project(session, user_id, payload["project_id"], "project_id")


def _find_by_key(
    session: Session, user_id: UUID, idempotency_key: str
) -> AgentProposal | None:
    return session.exec(
        select(AgentProposal).where(
            AgentProposal.user_id == user_id,
            AgentProposal.idempotency_key == idempotency_key,
        )
    ).first()


def _pending_count(session: Session, user_id: UUID) -> int:
    return session.exec(
        select(func.count())
        .select_from(AgentProposal)
        .where(
            AgentProposal.user_id == user_id,
            col(AgentProposal.status) == ProposalStatus.PENDING.value,
        )
    ).one()


def create_proposal(
    session: Session, principal: AgentPrincipal, data: ProposalCreateRequest
) -> tuple[AgentProposal, bool]:
    """Store a proposal. Returns ``(row, created)``.

    A repeated idempotency key returns the stored row, whatever its state and
    whatever the new request says, and wins over the pending cap.
    """
    user_id = principal.user_id
    existing = _find_by_key(session, user_id, data.idempotency_key)
    if existing is not None:
        return existing, False

    # Best-effort cap: the count and the insert are not atomic, so concurrent
    # intakes with different keys could exceed it slightly. Production runs one
    # uvicorn worker on one machine and this handler uses a sync session, so in
    # practice requests are serialised. No locking on purpose.
    if _pending_count(session, user_id) >= MAX_PENDING_PROPOSALS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Proposal inbox is full")

    project_id = resolve_project_id(session, user_id, data.kind, data.payload)

    agent_name = session.exec(
        select(AgentToken.name).where(AgentToken.id == principal.token_id)
    ).first()
    if agent_name is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid agent token")

    row = AgentProposal(
        id=uuid4(),
        user_id=user_id,
        token_id=principal.token_id,
        agent_name=agent_name,
        kind=data.kind.value,
        title=data.title,
        rationale=data.rationale,
        payload=data.payload,
        sources=[source.model_dump(mode="json") for source in data.sources],
        idempotency_key=data.idempotency_key,
        project_id=project_id,
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        # A concurrent request with the same key committed first.
        session.rollback()
        winner = _find_by_key(session, user_id, data.idempotency_key)
        if winner is None:
            raise
        return winner, False
    session.refresh(row)
    return row, True


def _unprocessable(detail: Any) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def _validation_detail(error: ValidationError) -> Any:
    """Pydantic errors in a form that serialises to JSON."""
    return jsonable_encoder(error.errors(include_url=False, include_context=False))


def _lock_pending(session: Session, user_id: UUID, proposal_id: UUID) -> AgentProposal:
    """Read the user's proposal under a row lock and require it to be pending.

    The lock (a no-op on SQLite) makes a second accept or reject wait for the
    first to commit, then see it is decided and get 409, so a double click or two
    tabs never act twice."""
    row = session.exec(
        select(AgentProposal)
        .where(AgentProposal.id == proposal_id, AgentProposal.user_id == user_id)
        .with_for_update()
        # Use the locked row's values, not a copy the session already holds.
        .execution_options(populate_existing=True)
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    if row.status != ProposalStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Proposal already decided")
    return row


def _check_decision(
    kind: ProposalKind, parsed: BaseModel, data: ProposalAcceptRequest
) -> None:
    """A decision request needs an answer; only it takes an option number."""
    if kind is not ProposalKind.DECISION_REQUEST:
        if data.decision_option is not None:
            raise _unprocessable("decision_option is only for decision_request")
        return
    options = parsed.options if isinstance(parsed, DecisionRequestPayload) else []
    if data.decision_option is not None:
        if data.decision_option >= len(options):
            raise _unprocessable("decision_option is out of range")
        return
    if not (data.decision_note or "").strip():
        raise _unprocessable(
            "A decision_request needs decision_option or decision_note"
        )


def _create_input(model: type[BaseModel], parsed: BaseModel) -> Any:
    """Build a ``*Create`` from a payload; unset fields keep the model defaults."""
    try:
        return model.model_validate(parsed.model_dump(exclude_none=True))
    except ValidationError as error:
        raise _unprocessable(_validation_detail(error)) from error


def _append_to_note(
    session: Session, user_id: UUID, agent_name: str, payload: NoteAppendPayload
) -> ContextNote:
    """Append the agent's text to the target's note, creating the note if needed.

    The same lookup as ``routers/notes.get_or_create_note``, without its commit."""
    target = payload.target
    query = select(ContextNote)
    if target.project_id is not None:
        query = query.where(ContextNote.project_id == target.project_id)
    elif target.goal_id is not None:
        query = query.where(ContextNote.goal_id == target.goal_id)
    else:
        query = query.where(ContextNote.task_id == target.task_id)
    # Lock the note row (a no-op on SQLite) so that two accepts appending to
    # the same note run one after the other; otherwise both read the same
    # content and the later write drops the earlier append. The proposal row is
    # always locked first, then the note, so the order cannot deadlock.
    note = session.exec(
        query.with_for_update().execution_options(populate_existing=True)
    ).first()
    if note is None:
        note = ContextNote(
            id=uuid4(),
            user_id=user_id,
            project_id=target.project_id,
            goal_id=target.goal_id,
            task_id=target.task_id,
            content="",
            content_type="html",
        )
        session.add(note)
        try:
            session.flush()
        except IntegrityError:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Note was created concurrently; retry"
            ) from None

    heading = agent_append_heading(agent_name, datetime.now(APP_TIMEZONE).date())
    note.content = append_html(
        note.content, heading + markdown_to_note_html(payload.content_markdown)
    )
    # The web editor loads every note as HTML, whatever content_type says.
    note.content_type = "html"
    note.updated_at = datetime.now(UTC)
    session.add(note)
    session.flush()
    return note


def _materialise(
    session: Session,
    user_id: UUID,
    row: AgentProposal,
    kind: ProposalKind,
    parsed: BaseModel,
) -> tuple[ProposalResultType, UUID] | None:
    """Create what an accepted proposal stands for, flushed but not committed.

    Ownership of every referenced ID has been checked by ``resolve_project_id``."""
    if kind is ProposalKind.GOAL:
        goal = goal_service.build(session, _create_input(GoalCreate, parsed), user_id)
        return ProposalResultType.GOAL, goal.id  # type: ignore[return-value]
    if kind is ProposalKind.TASK:
        task = task_service.build(session, _create_input(TaskCreate, parsed), user_id)
        return ProposalResultType.TASK, task.id  # type: ignore[return-value]
    if kind is ProposalKind.QUICK_TASK:
        quick_task = quick_task_service.build(
            session, _create_input(QuickTaskCreate, parsed), user_id
        )
        return ProposalResultType.QUICK_TASK, quick_task.id  # type: ignore[return-value]
    if isinstance(parsed, NoteAppendPayload):
        note = _append_to_note(session, user_id, row.agent_name, parsed)
        return ProposalResultType.CONTEXT_NOTE, note.id  # type: ignore[return-value]
    # contradiction, decision_request and experiment record the decision only.
    return None


def _references(kind: ProposalKind, dump: dict[str, Any]) -> Any:
    """The IDs a normalised payload points at, as resolve_project_id reads them."""
    if kind is ProposalKind.QUICK_TASK:
        return None
    if kind is ProposalKind.TASK:
        return dump.get("goal_id")
    if kind is ProposalKind.NOTE_APPEND:
        return dump.get("target")
    return dump.get("project_id")


def _apply_accept(
    session: Session, user_id: UUID, row: AgentProposal, data: ProposalAcceptRequest
) -> None:
    kind = ProposalKind(row.kind)
    if data.payload is not None and kind not in EDITABLE_KINDS:
        raise _unprocessable("This kind cannot be edited")
    try:
        original = parse_payload(kind, row.payload)
    except ValidationError:
        # Checked first: a stale stored payload is not the caller's input error.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Stored proposal no longer matches its schema; reject it instead",
        ) from None
    used_payload = data.payload if data.payload is not None else row.payload
    try:
        parsed = parse_payload(kind, used_payload)
    except ValidationError as error:
        raise _unprocessable(_validation_detail(error)) from error

    _check_decision(kind, parsed, data)

    used_dump = parsed.model_dump(mode="json")
    original_dump = original.model_dump(mode="json")
    # A payload sent back unchanged (or only re-spelled) counts as not edited.
    edited = used_dump != original_dump
    try:
        project_id = resolve_project_id(session, user_id, kind, used_dump)
    except HTTPException:
        if _references(kind, used_dump) != _references(kind, original_dump):
            # The user's edit points somewhere invalid: an input error.
            raise
        # The proposal pointed at a valid target when it arrived, and the user
        # did not change where it points (whatever else they edited); the
        # target has since gone.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Proposal target no longer exists; reject it instead",
        ) from None

    result = _materialise(session, user_id, row, kind, parsed)

    now = datetime.now(UTC)
    row.status = (
        ProposalStatus.EDITED.value if edited else ProposalStatus.ACCEPTED.value
    )
    row.final_payload = normalize_payload(kind, used_payload)
    row.project_id = project_id
    row.decision_note = data.decision_note
    row.decision_option = data.decision_option
    row.result_type = result[0].value if result else None
    row.result_id = result[1] if result else None
    row.decided_at = now
    # Set here too: agents poll by updated_at and not every database has the
    # trigger that advances it.
    row.updated_at = now
    session.add(row)


def accept_proposal(
    session: Session, user_id: UUID, proposal_id: UUID, data: ProposalAcceptRequest
) -> AgentProposal:
    """Accept a pending proposal, creating what it proposes.

    The entity and the decision are written in one transaction, committed once
    at the end; any failure rolls both back and leaves the proposal pending."""
    try:
        row = _lock_pending(session, user_id, proposal_id)
        _apply_accept(session, user_id, row, data)
        session.commit()
    except IntegrityError:
        # A constraint failed while writing (typically the target was deleted
        # after the ownership check, a foreign key violation). Note-creation
        # races are mapped to their own 409 where they happen.
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Proposal target no longer exists; reject it instead",
        ) from None
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def reject_proposal(
    session: Session, user_id: UUID, proposal_id: UUID, data: ProposalRejectRequest
) -> AgentProposal:
    """Reject a pending proposal. Nothing is created; final_payload stays NULL."""
    try:
        row = _lock_pending(session, user_id, proposal_id)
        now = datetime.now(UTC)
        row.status = ProposalStatus.REJECTED.value
        row.reject_category = data.reject_category.value
        row.decision_note = data.decision_note
        row.decided_at = now
        row.updated_at = now
        session.add(row)
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def _uuid_or_none(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


def _referenced_ids(row: AgentProposal) -> tuple[UUID | None, UUID | None]:
    """The goal and task IDs a proposal's payload points at, if any.

    What the user approved (``final_payload``) wins over what the agent sent."""
    payload = row.final_payload if row.final_payload is not None else row.payload
    kind = ProposalKind(row.kind)
    if kind is ProposalKind.TASK:
        return _uuid_or_none(payload.get("goal_id")), None
    if kind is ProposalKind.NOTE_APPEND:
        target = payload.get("target") or {}
        return _uuid_or_none(target.get("goal_id")), _uuid_or_none(
            target.get("task_id")
        )
    return None, None


def _names(
    session: Session,
    id_column: Any,
    name_column: Any,
    ids: set[UUID],
    service: Any,
    user_id: UUID,
) -> dict[UUID, str]:
    """``{id: name}`` for the user's own rows among ``ids``, in one query."""
    if not ids:
        return {}
    rows = session.exec(
        select(id_column, name_column).where(
            col(id_column).in_(ids), service._get_user_filter(user_id)
        )
    )
    return {row_id: name for row_id, name in rows}


def to_web_responses(
    session: Session, user_id: UUID, rows: list[AgentProposal]
) -> list[ProposalResponse]:
    """Build the inbox responses for a page of proposals.

    Names come from one query per referenced table, however many rows the page
    has, limited to the user's own projects, goals and tasks. A missing or
    foreign target gives None. ``task_goal_id`` is the goal of the referenced
    task, from the same task query, so the web can link to the task."""
    project_ids: set[UUID] = set()
    goal_ids: set[UUID] = set()
    task_ids: set[UUID] = set()
    for row in rows:
        if row.project_id is not None:
            project_ids.add(row.project_id)
        goal_id, task_id = _referenced_ids(row)
        if goal_id is not None:
            goal_ids.add(goal_id)
        if task_id is not None:
            task_ids.add(task_id)

    project_names = _names(
        session, Project.id, Project.title, project_ids, project_service, user_id
    )
    goal_titles = _names(session, Goal.id, Goal.title, goal_ids, goal_service, user_id)
    task_titles: dict[UUID, str] = {}
    task_goal_ids: dict[UUID, UUID] = {}
    if task_ids:
        task_rows = session.exec(
            select(Task.id, Task.title, Task.goal_id).where(
                col(Task.id).in_(task_ids), task_service._get_user_filter(user_id)
            )
        )
        for found_id, found_title, found_goal_id in task_rows:
            if found_id is None:
                continue
            task_titles[found_id] = found_title
            task_goal_ids[found_id] = found_goal_id

    responses: list[ProposalResponse] = []
    for row in rows:
        goal_id, task_id = _referenced_ids(row)
        base = AgentProposalResponse.from_row(row)
        responses.append(
            ProposalResponse(
                **dict(base),
                project_name=project_names.get(row.project_id)
                if row.project_id is not None
                else None,
                goal_title=goal_titles.get(goal_id) if goal_id is not None else None,
                task_title=task_titles.get(task_id) if task_id is not None else None,
                task_goal_id=task_goal_ids.get(task_id)
                if task_id is not None
                else None,
            )
        )
    return responses
