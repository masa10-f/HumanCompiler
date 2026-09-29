# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Export project and goal context as Markdown for use with AI assistants."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_serializer
from sqlmodel import Session

from humancompiler_api.ai.context_export import (
    ContextExportOptions,
    ContextExportResult,
    build_goal_context_export,
    build_project_context_export,
)
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.models import ErrorResponse

router = APIRouter(prefix="/context-export", tags=["context-export"])

_NOT_FOUND_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse, "description": "Not found"},
}


class ContextExportResponse(BaseModel):
    """A Markdown document bundling notes and work history."""

    filename: str
    markdown: str
    generated_at: datetime

    @field_serializer("generated_at")
    def serialize_generated_at(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    @classmethod
    def from_result(cls, result: ContextExportResult) -> "ContextExportResponse":
        return cls(
            filename=result.filename,
            markdown=result.markdown,
            generated_at=result.generated_at,
        )


def get_export_options(
    include_completed: bool = True,
    include_work_sessions: bool = True,
    include_daily_plans: bool = True,
    period_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> ContextExportOptions:
    """Parse export options from query parameters."""
    return ContextExportOptions(
        include_completed=include_completed,
        include_work_sessions=include_work_sessions,
        include_daily_plans=include_daily_plans,
        period_days=period_days,
    )


@router.get(
    "/projects/{project_id}",
    response_model=ContextExportResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def export_project_context(
    project_id: UUID,
    options: Annotated[ContextExportOptions, Depends(get_export_options)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ContextExportResponse:
    """Export a project's notes, tasks, and work history as Markdown."""
    result = build_project_context_export(
        session, UUID(str(current_user.user_id)), project_id, options
    )
    return ContextExportResponse.from_result(result)


@router.get(
    "/goals/{goal_id}",
    response_model=ContextExportResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def export_goal_context(
    goal_id: UUID,
    options: Annotated[ContextExportOptions, Depends(get_export_options)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ContextExportResponse:
    """Export a goal's notes, tasks, and work history as Markdown."""
    result = build_goal_context_export(
        session, UUID(str(current_user.user_id)), goal_id, options
    )
    return ContextExportResponse.from_result(result)
