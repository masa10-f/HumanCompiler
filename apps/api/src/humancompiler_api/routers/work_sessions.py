"""
Work Sessions Router for Runner/Focus mode

Provides endpoints for managing work sessions:
- Start a new session
- Checkout (end) current session with KPT reflection
- Get current active session
- Get session history
"""

from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    LogResponse,
    SnoozeRequest,
    SnoozeResponse,
    WorkSessionStartRequest,
    WorkSessionCheckoutRequest,
    WorkSessionUpdate,
    WorkSessionResponse,
    WorkSessionWithLogResponse,
)
from humancompiler_api.services import work_session_service
from humancompiler_api.notification_service import NotificationService

router = APIRouter(prefix="/work-sessions", tags=["work-sessions"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/start",
    response_model=WorkSessionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        409: {"model": ErrorResponse, "description": "Active session already exists"},
    },
    summary="Start a new work session",
    description="Start a new work session for a specific task. Only one active session per user is allowed.",
)
async def start_session(
    start_data: WorkSessionStartRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WorkSessionResponse:
    """Start a new work session"""
    work_session = work_session_service.start_session(
        session, start_data, current_user.user_id
    )
    session.commit()
    session.refresh(work_session)
    return WorkSessionResponse.model_validate(work_session)


@router.post(
    "/checkout",
    response_model=WorkSessionWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "No active session found"},
    },
    summary="Checkout current session",
    description="End the current session with a decision (continue/switch/break/complete), KPT reflection, and optionally update remaining estimate. A log entry is automatically created.",
)
async def checkout_session(
    checkout_data: WorkSessionCheckoutRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WorkSessionWithLogResponse:
    """Checkout current session and create log"""
    work_session, log = work_session_service.checkout_session(
        session, current_user.user_id, checkout_data
    )

    # Calculate actual minutes for response
    actual_minutes = None
    if work_session.ended_at and work_session.started_at:
        actual_minutes = int(
            (work_session.ended_at - work_session.started_at).total_seconds() / 60
        )

    response = WorkSessionWithLogResponse.model_validate(work_session)
    response.generated_log = LogResponse.model_validate(log)
    response.actual_minutes = actual_minutes
    return response


@router.get(
    "/current",
    response_model=WorkSessionResponse | None,
    summary="Get current active session",
    description="Get the current active session for the authenticated user. Returns null if no active session exists.",
)
async def get_current_session(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WorkSessionResponse | None:
    """Get current active session"""
    work_session = work_session_service.get_current_session(
        session, current_user.user_id
    )
    if not work_session:
        return None
    return WorkSessionResponse.model_validate(work_session)


@router.get(
    "/history",
    response_model=list[WorkSessionResponse],
    summary="Get session history",
    description="Get all sessions for the authenticated user, ordered by start time descending.",
)
async def get_session_history(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0, description="Number of records to skip")] = 0,
    limit: Annotated[
        int, Query(ge=1, le=100, description="Maximum number of records to return")
    ] = 20,
) -> list[WorkSessionResponse]:
    """Get session history for user"""
    sessions = work_session_service.get_session_history(
        session, current_user.user_id, skip, limit
    )
    return [WorkSessionResponse.model_validate(s) for s in sessions]


@router.get(
    "/task/{task_id}",
    response_model=list[WorkSessionResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
    summary="Get sessions for a specific task",
    description="Get all sessions for a specific task, ordered by start time descending.",
)
async def get_sessions_by_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0, description="Number of records to skip")] = 0,
    limit: Annotated[
        int, Query(ge=1, le=100, description="Maximum number of records to return")
    ] = 20,
) -> list[WorkSessionResponse]:
    """Get sessions for specific task"""
    sessions = work_session_service.get_sessions_by_task(
        session, task_id, current_user.user_id, skip, limit
    )
    return [WorkSessionResponse.model_validate(s) for s in sessions]


@router.put(
    "/{session_id}",
    response_model=WorkSessionResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Session not found"},
        400: {"model": ErrorResponse, "description": "Cannot edit active session"},
    },
    summary="Update work session KPT",
    description="Update KPT (Keep/Problem/Try) fields of a completed work session. Only KPT fields can be updated.",
)
async def update_session(
    session_id: str,
    update_data: WorkSessionUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WorkSessionResponse:
    """Update work session KPT fields"""
    work_session = work_session_service.update_session_kpt(
        session, session_id, current_user.user_id, update_data
    )
    return WorkSessionResponse.model_validate(work_session)


# Issue #228: Notification/Escalation endpoints


@router.post(
    "/snooze",
    response_model=SnoozeResponse,
    responses={
        400: {
            "model": ErrorResponse,
            "description": "Snooze limit reached or session unresponsive",
        },
        404: {"model": ErrorResponse, "description": "No active session found"},
    },
    summary="Snooze current session checkout",
    description="Extend the planned checkout time by 5 minutes. Limited to 2 snoozes per session. Cannot snooze if session is marked unresponsive.",
)
async def snooze_session(
    snooze_data: SnoozeRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> SnoozeResponse:
    """Snooze the checkout timer"""
    from fastapi import HTTPException

    notification_service = NotificationService(session)

    try:
        work_session = notification_service.snooze_session(
            current_user.user_id,
            snooze_data.snooze_minutes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return SnoozeResponse(
        session=WorkSessionResponse.model_validate(work_session),
        new_planned_checkout_at=work_session.planned_checkout_at,
        snooze_count=work_session.snooze_count,
        max_snooze_count=2,
    )


@router.get(
    "/unresponsive",
    response_model=WorkSessionResponse | None,
    summary="Get unresponsive session",
    description="Check if there's an unresponsive session requiring immediate checkout. Returns the session if found, null otherwise.",
)
async def get_unresponsive_session(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WorkSessionResponse | None:
    """Get unresponsive session for recovery flow"""
    notification_service = NotificationService(session)
    work_session = notification_service.get_unresponsive_session(current_user.user_id)

    if not work_session:
        return None

    return WorkSessionResponse.model_validate(work_session)
