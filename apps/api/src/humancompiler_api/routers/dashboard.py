"""Dashboard-specific API endpoints."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, col, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.models import Goal, Project, Task

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class RecentItemResponse(BaseModel):
    """A recently updated task or goal shown as a dashboard shortcut."""

    kind: Literal["task", "goal"]
    id: UUID
    title: str
    status: str
    project_id: UUID
    project_title: str
    goal_id: UUID
    goal_title: str
    updated_at: datetime


@router.get("/recent-items", response_model=list[RecentItemResponse])
async def get_recent_items(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> list[RecentItemResponse]:
    """Return the user's most recently updated tasks and goals."""
    owner_id = UUID(str(current_user.user_id))

    goal_rows = session.exec(
        select(Goal, Project)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == owner_id,
            col(Goal.updated_at).is_not(None),
        )
        .order_by(col(Goal.updated_at).desc(), col(Goal.id).asc())
        .limit(limit)
    ).all()
    task_rows = session.exec(
        select(Task, Goal, Project)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == owner_id,
            col(Task.updated_at).is_not(None),
        )
        .order_by(col(Task.updated_at).desc(), col(Task.id).asc())
        .limit(limit)
    ).all()

    items = [
        RecentItemResponse(
            kind="goal",
            id=goal.id,
            title=goal.title,
            status=goal.status.value,
            project_id=project.id,
            project_title=project.title,
            goal_id=goal.id,
            goal_title=goal.title,
            updated_at=goal.updated_at,
        )
        for goal, project in goal_rows
        if goal.id is not None
        and project.id is not None
        and goal.updated_at is not None
    ]
    items.extend(
        RecentItemResponse(
            kind="task",
            id=task.id,
            title=task.title,
            status=task.status.value,
            project_id=project.id,
            project_title=project.title,
            goal_id=goal.id,
            goal_title=goal.title,
            updated_at=task.updated_at,
        )
        for task, goal, project in task_rows
        if task.id is not None
        and goal.id is not None
        and project.id is not None
        and task.updated_at is not None
    )

    return sorted(
        items,
        key=lambda item: (item.updated_at, str(item.id)),
        reverse=True,
    )[:limit]
