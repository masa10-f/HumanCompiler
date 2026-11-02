# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com


"""Web API for the proposal inbox (``/api/proposals``, Supabase login).

The user reads proposals here and accepts, edits or rejects them. The rules of
a decision live in ``proposal_service``; this router only maps requests to it.
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, col, func, select

from humancompiler_api import proposal_service
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.common.error_handlers import validate_uuid
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentProposal,
    ProposalKind,
    ProposalListResponse,
    ProposalResponse,
    ProposalStatus,
    ProposalSummaryItem,
    ProposalSummaryResponse,
)
from humancompiler_api.proposal_payloads import (
    ProposalAcceptRequest,
    ProposalRejectRequest,
)

router = APIRouter(prefix="/proposals", tags=["proposals"])

SUMMARY_LATEST = 3


@router.get("", response_model=ProposalListResponse)
async def list_proposals(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    proposal_status: Annotated[
        Literal["pending", "decided"], Query(alias="status")
    ] = "pending",
    kind: ProposalKind | None = None,
    project_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProposalListResponse:
    """List the user's proposals: pending (newest first) or decided (latest first)."""
    user_id = validate_uuid(current_user.user_id, "user_id")
    conditions = [AgentProposal.user_id == user_id]
    if proposal_status == "pending":
        conditions.append(col(AgentProposal.status) == ProposalStatus.PENDING.value)
        order = [col(AgentProposal.created_at).desc(), col(AgentProposal.id)]
    else:
        conditions.append(col(AgentProposal.status) != ProposalStatus.PENDING.value)
        order = [col(AgentProposal.decided_at).desc(), col(AgentProposal.id)]
    if kind is not None:
        conditions.append(col(AgentProposal.kind) == kind.value)
    if project_id is not None:
        conditions.append(col(AgentProposal.project_id) == project_id)

    total = session.exec(
        select(func.count()).select_from(AgentProposal).where(*conditions)
    ).one()
    rows = list(
        session.exec(
            select(AgentProposal)
            .where(*conditions)
            .order_by(*order)
            .offset(offset)
            .limit(limit)
        ).all()
    )
    return ProposalListResponse(
        items=proposal_service.to_web_responses(session, user_id, rows),
        total=total,
    )


@router.get("/summary", response_model=ProposalSummaryResponse)
async def proposals_summary(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProposalSummaryResponse:
    """How many proposals wait, and the newest three. For the dashboard and header."""
    user_id = validate_uuid(current_user.user_id, "user_id")
    pending = (
        AgentProposal.user_id == user_id,
        col(AgentProposal.status) == ProposalStatus.PENDING.value,
    )
    count = session.exec(
        select(func.count()).select_from(AgentProposal).where(*pending)
    ).one()
    latest = session.exec(
        select(AgentProposal)
        .where(*pending)
        .order_by(col(AgentProposal.created_at).desc(), col(AgentProposal.id))
        .limit(SUMMARY_LATEST)
    ).all()
    return ProposalSummaryResponse(
        pending_count=count,
        latest=[
            ProposalSummaryItem(
                id=row.id,  # type: ignore[arg-type]
                kind=ProposalKind(row.kind),
                title=row.title,
                agent_name=row.agent_name,
                created_at=row.created_at,
            )
            for row in latest
        ],
    )


@router.get("/{proposal_id}", response_model=ProposalResponse)
async def get_proposal(
    proposal_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProposalResponse:
    """Return one proposal; another user's proposal is reported as not found."""
    user_id = validate_uuid(current_user.user_id, "user_id")
    row = session.exec(
        select(AgentProposal).where(
            AgentProposal.id == proposal_id, AgentProposal.user_id == user_id
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    return proposal_service.to_web_responses(session, user_id, [row])[0]


@router.post("/{proposal_id}/accept", response_model=ProposalResponse)
async def accept_proposal(
    proposal_id: UUID,
    data: ProposalAcceptRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProposalResponse:
    """Accept a pending proposal, optionally with the user's edited payload."""
    user_id = validate_uuid(current_user.user_id, "user_id")
    row = proposal_service.accept_proposal(session, user_id, proposal_id, data)
    return proposal_service.to_web_responses(session, user_id, [row])[0]


@router.post("/{proposal_id}/reject", response_model=ProposalResponse)
async def reject_proposal(
    proposal_id: UUID,
    data: ProposalRejectRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProposalResponse:
    """Reject a pending proposal with a reason."""
    user_id = validate_uuid(current_user.user_id, "user_id")
    row = proposal_service.reject_proposal(session, user_id, proposal_id, data)
    return proposal_service.to_web_responses(session, user_id, [row])[0]
