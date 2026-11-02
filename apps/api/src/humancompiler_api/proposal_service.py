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
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    AgentProposal,
    AgentToken,
    ProposalKind,
    ProposalStatus,
)
from humancompiler_api.proposal_payloads import ProposalCreateRequest
from humancompiler_api.services import goal_service, project_service, task_service

logger = logging.getLogger(__name__)

MAX_PENDING_PROPOSALS = 200


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
