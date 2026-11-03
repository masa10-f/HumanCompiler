# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API writes for goals and tasks (``/api/agent/v1``).

Every write is recorded in ``agent_changes``. Updates need the updated_at the
agent read, and destructive changes need the ``writes:unconfirmed`` scope.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from humancompiler_api import agent_write_service
from humancompiler_api.agent_auth import AgentPrincipal, require_scope
from humancompiler_api.agent_write_models import (
    AgentGoalCreate,
    AgentGoalUpdate,
    AgentTaskCreate,
    AgentTaskUpdate,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import AgentScope, Goal, GoalResponse, Task, TaskResponse
from humancompiler_api.routers.agent_v1 import _owned_goals, _owned_tasks

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])

UPDATE_GUIDE = (
    "Only the fields you send change; send null to clear description, memo or "
    "due_date (null resets priority to 3 and work_type to light_work). "
    "expected_updated_at must be the updated_at you last read: if the item "
    "changed since, nothing is written and the answer is 409 with "
    "detail.current_updated_at; read it again and retry. A request whose values "
    "all equal the stored ones changes nothing and keeps updated_at. "
    "A request with any destructive change (cancelling, changing or clearing "
    "description or memo, moving a task to another goal) needs the "
    "writes:unconfirmed scope; without it the whole request is refused with 403 "
    "and nothing is written. Send the destructive change as a proposal instead."
)


def _goal_response(session: Session, user_id: UUID, goal_id: UUID) -> GoalResponse:
    goal = session.exec(_owned_goals(user_id).where(Goal.id == goal_id)).one()
    return GoalResponse.model_validate(goal)


def _task_response(session: Session, user_id: UUID, task_id: UUID) -> TaskResponse:
    task = session.exec(_owned_tasks(user_id).where(Task.id == task_id)).one()
    return TaskResponse.model_validate(task)


@router.post(
    "/goals",
    response_model=GoalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a goal",
    description=(
        "Create a goal in one of the user's projects. Another user's project and "
        "a missing one both give 404."
    ),
)
async def create_goal(
    data: AgentGoalCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.GOALS_WRITE))
    ],
) -> GoalResponse:
    goal = agent_write_service.create_goal(session, principal, data)
    return _goal_response(session, principal.user_id, goal.id)  # type: ignore[arg-type]


@router.patch(
    "/goals/{goal_id}",
    response_model=GoalResponse,
    summary="Update a goal",
    description=(
        f"{UPDATE_GUIDE} A status change must be an allowed transition, else 422."
    ),
)
async def update_goal(
    goal_id: UUID,
    data: AgentGoalUpdate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.GOALS_WRITE))
    ],
) -> GoalResponse:
    agent_write_service.update_goal(session, principal, goal_id, data)
    return _goal_response(session, principal.user_id, goal_id)


@router.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a task",
    description=(
        "Create a task in one of the user's goals. Another user's goal and a "
        "missing one both give 404."
    ),
)
async def create_task(
    data: AgentTaskCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    task = agent_write_service.create_task(session, principal, data)
    return _task_response(session, principal.user_id, task.id)  # type: ignore[arg-type]


@router.patch(
    "/tasks/{task_id}",
    response_model=TaskResponse,
    summary="Update a task",
    description=(
        f"{UPDATE_GUIDE} memo_append adds text after the memo on a new line and "
        "is not destructive; it cannot be sent with memo, and the result must fit "
        "in 2000 characters."
    ),
)
async def update_task(
    task_id: UUID,
    data: AgentTaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.TASKS_WRITE))
    ],
) -> TaskResponse:
    agent_write_service.update_task(session, principal, task_id, data)
    return _task_response(session, principal.user_id, task_id)
