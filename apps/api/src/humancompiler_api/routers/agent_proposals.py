# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API for proposals (``/api/agent/v1/proposals``).

Agents send what they think the user should do; the user decides in the web
inbox. These endpoints only receive proposals and show their state.
"""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.routing import APIRoute
from sqlmodel import Session, col, select

from humancompiler_api import proposal_service
from humancompiler_api.agent_auth import AgentPrincipal, require_scope
from humancompiler_api.agent_pagination import (
    AgentPage,
    PageParams,
    page_params,
    paginate,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentProposal,
    AgentProposalResponse,
    AgentScope,
    ProposalKind,
    ProposalStatus,
)
from humancompiler_api.proposal_payloads import ProposalCreateRequest

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])

MAX_BODY_BYTES = 64 * 1024

IDEMPOTENCY_GUIDE = (
    "idempotency_key is unique per user. Derive it from the evidence, so the same "
    "evidence always gives the same key, for example "
    "'distiller:<kind>:<source logical id>@<version hash>'. A repeated key returns "
    "the stored proposal with 200 and creates nothing, whatever the new body says "
    "and even when the user already rejected it: a rejected proposal is never "
    "recreated under the same key. Send a new key only for new evidence."
)

BODY_CAP_GUIDE = (
    "The 64 KB cap is on the raw request body in bytes, not on characters. "
    "Non-ASCII text costs about 3 bytes per character in UTF-8, and 6 or more "
    "when the client escapes it as \\uXXXX, so send UTF-8 JSON without escaping. "
    "A long note_append may not fit even within the content_markdown limit; split "
    "it into several proposals."
)

ACCEPTED_EXPERIMENTS_GUIDE = (
    "To collect the experiments the user approved, call "
    "GET /api/agent/v1/proposals?kind=experiment&status=accepted&status=edited. "
    "An edited proposal's final_payload is what the user approved."
)


class BodyCappedRoute(APIRoute):
    """A route that answers 413 for a body over 64 KB before parsing it.

    FastAPI parses and validates the body before any dependency runs, so the cap
    has to sit in the route handler. ``request.body()`` caches the bytes, and the
    default handler reuses them.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        default_handler = super().get_route_handler()

        async def capped_handler(request: Request) -> Response:
            body = await request.body()
            if len(body) > MAX_BODY_BYTES:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"Request body exceeds {MAX_BODY_BYTES} bytes",
                )
            return await default_handler(request)

        return capped_handler


# Only the intake endpoint is capped; the reads below keep the default route class.
intake_router = APIRouter(route_class=BodyCappedRoute)


@intake_router.post(
    "/proposals",
    response_model=AgentProposalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send a proposal to the user's inbox",
    description=(
        "Send a proposal for the user to accept, edit or reject. Returns 201 for a "
        "new proposal and 200 when the idempotency_key was already used. Returns "
        "409 when the user has 200 pending proposals, 413 when the body is over "
        "64 KB, and 422 when the payload does not match the kind or points at a "
        "project, goal or task that is not the user's. The 413 is decided before "
        "authentication, so an oversized request gets 413 even without a valid "
        "token, and it is not recorded in the audit log. "
        f"{IDEMPOTENCY_GUIDE} "
        f"{BODY_CAP_GUIDE}"
    ),
    responses={
        status.HTTP_200_OK: {
            "model": AgentProposalResponse,
            "description": "The idempotency_key was already used; the stored proposal.",
        }
    },
)
async def create_proposal(
    data: ProposalCreateRequest,
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.PROPOSALS_WRITE))
    ],
) -> AgentProposalResponse:
    row, created = proposal_service.create_proposal(session, principal, data)
    if not created:
        response.status_code = status.HTTP_200_OK
    return AgentProposalResponse.from_row(row)


router.include_router(intake_router)


@router.get(
    "/proposals",
    response_model=AgentPage[AgentProposalResponse],
    summary="List the user's proposals",
    description=(
        "List all of the user's proposals, whichever token sent them, ordered by "
        "(updated_at, id). Pass updated_since to see decisions made since your "
        "last call. "
        f"{ACCEPTED_EXPERIMENTS_GUIDE}"
    ),
)
async def list_proposals(
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.PROPOSALS_READ))
    ],
    params: Annotated[PageParams, Depends(page_params())],
    kind: Annotated[
        list[ProposalKind] | None,
        Query(description="Only these kinds. Repeat the parameter for several."),
    ] = None,
    proposal_status: Annotated[
        list[ProposalStatus] | None,
        Query(
            alias="status",
            description="Only these statuses. Repeat the parameter for several.",
        ),
    ] = None,
) -> AgentPage[AgentProposalResponse]:
    statement = select(AgentProposal).where(AgentProposal.user_id == principal.user_id)
    if kind:
        statement = statement.where(
            col(AgentProposal.kind).in_([item.value for item in kind])
        )
    if proposal_status:
        statement = statement.where(
            col(AgentProposal.status).in_([item.value for item in proposal_status])
        )
    rows, next_cursor = paginate(session, statement, AgentProposal, params)
    return AgentPage[AgentProposalResponse](
        items=[AgentProposalResponse.from_row(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get(
    "/proposals/{proposal_id}",
    response_model=AgentProposalResponse,
    summary="Get one proposal",
)
async def get_proposal(
    proposal_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.PROPOSALS_READ))
    ],
) -> AgentProposalResponse:
    """Return one proposal; another user's proposal is reported as not found."""
    row = session.exec(
        select(AgentProposal).where(
            AgentProposal.id == proposal_id,
            AgentProposal.user_id == principal.user_id,
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    return AgentProposalResponse.from_row(row)
