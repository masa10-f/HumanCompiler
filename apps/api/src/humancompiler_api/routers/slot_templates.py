"""
Slot Templates Router

Provides CRUD endpoints for managing day-of-week slot presets.
Users can create templates for each day of the week with custom time slots.
"""

from collections.abc import Generator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    SlotTemplateCreate,
    SlotTemplateResponse,
    SlotTemplateUpdate,
    SlotTemplateListResponse,
    DayOfWeekTemplatesResponse,
)
from humancompiler_api.services import slot_template_service

router = APIRouter(prefix="/slot-templates", tags=["slot-templates"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "",
    response_model=SlotTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=SlotTemplateResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_slot_template(
    template_data: SlotTemplateCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> SlotTemplateResponse:
    """Create a new slot template for a day of week"""
    template = slot_template_service.create_slot_template(
        session, template_data, current_user.user_id
    )
    return SlotTemplateResponse.from_db_model(template)


@router.get(
    "",
    response_model=SlotTemplateListResponse,
)
@router.get(
    "/",
    response_model=SlotTemplateListResponse,
    include_in_schema=False,
)
async def get_slot_templates(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    day_of_week: Annotated[int | None, Query(ge=0, le=6)] = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> SlotTemplateListResponse:
    """Get slot templates for current user

    Args:
        day_of_week: Optional filter for day of week (0=Monday, 6=Sunday)
        skip: Number of templates to skip
        limit: Maximum number of templates to return
    """
    templates = slot_template_service.get_slot_templates(
        session, current_user.user_id, day_of_week, skip, limit
    )
    return SlotTemplateListResponse(
        templates=[SlotTemplateResponse.from_db_model(t) for t in templates],
        total=len(templates),
    )


@router.get(
    "/by-day",
    response_model=list[DayOfWeekTemplatesResponse],
)
async def get_templates_by_day(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[DayOfWeekTemplatesResponse]:
    """Get all slot templates grouped by day of week

    Returns templates organized by day (Monday-Sunday) with default template marked.
    """
    grouped = slot_template_service.get_all_templates_grouped_by_day(
        session, current_user.user_id
    )
    result = []
    for day_data in grouped:
        result.append(DayOfWeekTemplatesResponse(
            day_of_week=day_data["day_of_week"],
            day_name=day_data["day_name"],
            templates=[SlotTemplateResponse.from_db_model(t) for t in day_data["templates"]],
            default_template=SlotTemplateResponse.from_db_model(day_data["default_template"])
            if day_data["default_template"] else None,
        ))
    return result


@router.get(
    "/default/{day_of_week}",
    response_model=SlotTemplateResponse | None,
    responses={
        200: {"description": "Default template or null if none set"},
    },
)
async def get_default_template_for_day(
    day_of_week: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> SlotTemplateResponse | None:
    """Get the default template for a specific day of week

    Args:
        day_of_week: Day of week (0=Monday, 6=Sunday)
    """
    if day_of_week < 0 or day_of_week > 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="day_of_week must be between 0 (Monday) and 6 (Sunday)",
        )

    template = slot_template_service.get_default_template_for_day(
        session, current_user.user_id, day_of_week
    )
    if template:
        return SlotTemplateResponse.from_db_model(template)
    return None


@router.get(
    "/{template_id}",
    response_model=SlotTemplateResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Slot template not found"},
    },
)
async def get_slot_template(
    template_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> SlotTemplateResponse:
    """Get specific slot template"""
    template = slot_template_service.get_slot_template(
        session, template_id, current_user.user_id
    )
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Slot template not found",
                details={"template_id": str(template_id)},
            ).model_dump(),
        )
    return SlotTemplateResponse.from_db_model(template)


@router.put(
    "/{template_id}",
    response_model=SlotTemplateResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Slot template not found"},
    },
)
async def update_slot_template(
    template_id: UUID,
    template_data: SlotTemplateUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> SlotTemplateResponse:
    """Update specific slot template"""
    template = slot_template_service.update_slot_template(
        session, template_id, current_user.user_id, template_data
    )
    return SlotTemplateResponse.from_db_model(template)


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Slot template not found"},
    },
)
async def delete_slot_template(
    template_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific slot template"""
    slot_template_service.delete_slot_template(
        session, template_id, current_user.user_id
    )
