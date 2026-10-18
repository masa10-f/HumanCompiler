"""External hook ingestion API routes."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from humancompiler_api.agent_auth import AgentPrincipal, require_scope
from humancompiler_api.database import get_session
from humancompiler_api.models import AgentScope, QuickTaskCreate, QuickTaskResponse
from humancompiler_api.services import quick_task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hooks", tags=["hooks"])


@router.post(
    "/quick-tasks",
    response_model=QuickTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_quick_task_from_hook(
    task_data: QuickTaskCreate,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.QUICK_TASKS_WRITE))
    ],
) -> QuickTaskResponse:
    """Create a quick task using a user-scoped agent token."""
    task = quick_task_service.create_quick_task(session, task_data, principal.user_id)

    logger.info("Created hook quick task %s for user %s", task.id, principal.user_id)
    return QuickTaskResponse.model_validate(task)
