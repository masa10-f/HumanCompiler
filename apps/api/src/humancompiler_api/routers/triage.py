"""Capacity triage API endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    TriageApplyRequest,
    TriageApplyResponse,
    TriageCapacitySettingsResponse,
    TriageCapacitySettingsUpdate,
    TriageItemOverrideRequest,
    TriageRunCreateRequest,
    TriageRunResponse,
    TriageRunSource,
)
from humancompiler_api.triage import triage_service

router = APIRouter(prefix="/triage", tags=["triage"])


@router.get("/settings", response_model=TriageCapacitySettingsResponse)
async def get_triage_settings(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageCapacitySettingsResponse:
    """Get or create current user's triage capacity settings."""
    return triage_service.get_settings_response(session, user_id)


@router.put("/settings", response_model=TriageCapacitySettingsResponse)
async def update_triage_settings(
    settings_data: TriageCapacitySettingsUpdate,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageCapacitySettingsResponse:
    """Update current user's triage capacity settings."""
    return triage_service.update_settings(session, user_id, settings_data)


@router.post("/runs", response_model=TriageRunResponse)
async def create_triage_run(
    request: TriageRunCreateRequest | None = None,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageRunResponse:
    """Generate a manual triage run."""
    request = request or TriageRunCreateRequest()
    return triage_service.create_run(
        session,
        user_id,
        source=TriageRunSource.MANUAL,
        use_ai_rank_adjustment=request.use_ai_rank_adjustment,
    )


@router.get("/runs/latest", response_model=TriageRunResponse | None)
async def get_latest_triage_run(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageRunResponse | None:
    """Get the latest triage run, if one exists."""
    return triage_service.get_latest_run_response(session, user_id)


@router.get("/runs/{run_id}", response_model=TriageRunResponse)
async def get_triage_run(
    run_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageRunResponse:
    """Get a triage run by ID."""
    return triage_service.get_run_response(session, user_id, run_id)


@router.patch("/runs/{run_id}/items/{item_id}", response_model=TriageRunResponse)
async def override_triage_item(
    run_id: UUID,
    item_id: UUID,
    request: TriageItemOverrideRequest,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageRunResponse:
    """Override one triage item before applying the run."""
    return triage_service.override_item(
        session, user_id, run_id, item_id, request.user_override
    )


@router.post("/runs/{run_id}/apply", response_model=TriageApplyResponse)
async def apply_triage_run(
    run_id: UUID,
    request: TriageApplyRequest,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageApplyResponse:
    """Apply selected cancellation recommendations from a triage run."""
    return triage_service.apply_run(session, user_id, run_id, request.item_ids)
