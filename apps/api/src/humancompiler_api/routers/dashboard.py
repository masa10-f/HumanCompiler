# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Dashboard-specific API endpoints."""

from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_serializer
from sqlmodel import Session, col, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.models import Goal, GoalStatus, Project, Task, TaskStatus

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class RecentItemResponse(BaseModel):
    """A recently updated task or goal shown as a dashboard shortcut."""

    kind: Literal["task", "goal"]
    id: UUID
    title: str
    status: TaskStatus | GoalStatus
    project_id: UUID
    project_title: str
    goal_id: UUID
    goal_title: str
    updated_at: datetime

    @field_serializer("updated_at")
    def serialize_updated_at(self, value: datetime) -> str:
        """Serialize SQLite's naive datetimes consistently as UTC."""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


def _to_recent_item(
    *,
    kind: Literal["task", "goal"],
    item_id: UUID | None,
    title: str,
    status: TaskStatus | GoalStatus,
    project_id: UUID,
    project_title: str,
    goal_id: UUID,
    goal_title: str,
    updated_at: datetime | None,
) -> RecentItemResponse:
    """Build a shortcut from a lightweight projected database row."""
    return RecentItemResponse(
        kind=kind,
        id=cast(UUID, item_id),
        title=title,
        status=status,
        project_id=project_id,
        project_title=project_title,
        goal_id=goal_id,
        goal_title=goal_title,
        updated_at=cast(datetime, updated_at),
    )


@router.get("/recent-items", response_model=list[RecentItemResponse])
async def get_recent_items(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> list[RecentItemResponse]:
    """Return the user's most recently updated tasks and goals."""
    owner_id = UUID(str(current_user.user_id))

    goal_rows = session.exec(
        select(
            Goal.id,
            Goal.title,
            Goal.status,
            Goal.project_id,
            Project.title,
            Goal.updated_at,
        )
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == owner_id,
            col(Goal.updated_at).is_not(None),
        )
        .order_by(col(Goal.updated_at).desc(), col(Goal.id).desc())
        .limit(limit)
    ).all()
    task_rows = session.exec(
        select(
            Task.id,
            Task.title,
            Task.status,
            Goal.project_id,
            Project.title,
            Task.goal_id,
            Goal.title,
            Task.updated_at,
        )
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == owner_id,
            col(Task.updated_at).is_not(None),
        )
        .order_by(col(Task.updated_at).desc(), col(Task.id).desc())
        .limit(limit)
    ).all()

    items = [
        _to_recent_item(
            kind="goal",
            item_id=goal_id,
            title=goal_title,
            status=goal_status,
            project_id=project_id,
            project_title=project_title,
            goal_id=cast(UUID, goal_id),
            goal_title=goal_title,
            updated_at=updated_at,
        )
        for (
            goal_id,
            goal_title,
            goal_status,
            project_id,
            project_title,
            updated_at,
        ) in goal_rows
    ]
    items.extend(
        _to_recent_item(
            kind="task",
            item_id=task_id,
            title=task_title,
            status=task_status,
            project_id=project_id,
            project_title=project_title,
            goal_id=goal_id,
            goal_title=goal_title,
            updated_at=updated_at,
        )
        for (
            task_id,
            task_title,
            task_status,
            project_id,
            project_title,
            goal_id,
            goal_title,
            updated_at,
        ) in task_rows
    )

    return sorted(
        items,
        key=lambda item: (item.updated_at, str(item.id), item.kind),
        reverse=True,
    )[:limit]
