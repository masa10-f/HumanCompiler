"""
Reschedule Router for checkout-based rescheduling (Issue #227)

Provides endpoints for managing reschedule suggestions:
- Get pending suggestions
- Get suggestion details
- Accept suggestion
- Reject suggestion
- Get decision history
"""

from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    RescheduleDecisionRequest,
    RescheduleDecisionResponse,
    RescheduleSuggestionResponse,
    ScheduleDiff,
)
from humancompiler_api.reschedule_service import reschedule_service

router = APIRouter(prefix="/reschedule", tags=["reschedule"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.get(
    "/suggestions",
    response_model=list[RescheduleSuggestionResponse],
    summary="Get pending reschedule suggestions",
    description="Get all pending reschedule suggestions for the authenticated user.",
)
async def get_pending_suggestions(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[RescheduleSuggestionResponse]:
    """Get all pending reschedule suggestions"""
    suggestions = reschedule_service.get_pending_suggestions(
        session, current_user.user_id
    )

    return [_build_suggestion_response(suggestion) for suggestion in suggestions]


@router.get(
    "/suggestions/{suggestion_id}",
    response_model=RescheduleSuggestionResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Suggestion not found"},
    },
    summary="Get reschedule suggestion details",
    description="Get details of a specific reschedule suggestion.",
)
async def get_suggestion(
    suggestion_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> RescheduleSuggestionResponse:
    """Get a specific reschedule suggestion"""
    suggestion = reschedule_service.get_suggestion_by_id(
        session, suggestion_id, current_user.user_id
    )

    if not suggestion:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reschedule suggestion not found",
        )

    return _build_suggestion_response(suggestion)


@router.post(
    "/suggestions/{suggestion_id}/accept",
    response_model=RescheduleSuggestionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid state transition"},
        404: {"model": ErrorResponse, "description": "Suggestion not found"},
    },
    summary="Accept reschedule suggestion",
    description="Accept a reschedule suggestion and apply the proposed schedule.",
)
async def accept_suggestion(
    suggestion_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    request: RescheduleDecisionRequest | None = None,
) -> RescheduleSuggestionResponse:
    """Accept a reschedule suggestion"""
    reason = request.reason if request else None

    suggestion = reschedule_service.accept_suggestion(
        session, suggestion_id, current_user.user_id, reason
    )

    return _build_suggestion_response(suggestion)


@router.post(
    "/suggestions/{suggestion_id}/reject",
    response_model=RescheduleSuggestionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid state transition"},
        404: {"model": ErrorResponse, "description": "Suggestion not found"},
    },
    summary="Reject reschedule suggestion",
    description="Reject a reschedule suggestion and keep the original schedule.",
)
async def reject_suggestion(
    suggestion_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    request: RescheduleDecisionRequest | None = None,
) -> RescheduleSuggestionResponse:
    """Reject a reschedule suggestion"""
    reason = request.reason if request else None

    suggestion = reschedule_service.reject_suggestion(
        session, suggestion_id, current_user.user_id, reason
    )

    return _build_suggestion_response(suggestion)


@router.get(
    "/decisions",
    response_model=list[RescheduleDecisionResponse],
    summary="Get reschedule decision history",
    description="Get the history of reschedule decisions for learning analysis.",
)
async def get_decision_history(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[
        int, Query(ge=1, le=100, description="Maximum number of records to return")
    ] = 50,
) -> list[RescheduleDecisionResponse]:
    """Get reschedule decision history"""
    decisions = reschedule_service.get_decision_history(
        session, current_user.user_id, limit
    )

    return [
        RescheduleDecisionResponse.model_validate(decision) for decision in decisions
    ]


def _build_suggestion_response(suggestion) -> RescheduleSuggestionResponse:
    """Build a suggestion response with parsed diff"""
    response = RescheduleSuggestionResponse.model_validate(suggestion)

    # Parse diff_json into ScheduleDiff
    if suggestion.diff_json:
        response.diff = ScheduleDiff(
            pushed_tasks=suggestion.diff_json.get("pushed_tasks", []),
            added_tasks=suggestion.diff_json.get("added_tasks", []),
            removed_tasks=suggestion.diff_json.get("removed_tasks", []),
            reordered_tasks=suggestion.diff_json.get("reordered_tasks", []),
            total_changes=suggestion.diff_json.get("total_changes", 0),
            has_significant_changes=suggestion.diff_json.get(
                "has_significant_changes", False
            ),
        )

    return response
