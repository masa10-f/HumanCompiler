"""External hook ingestion API routes."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session

from humancompiler_api.database import get_session
from humancompiler_api.models import QuickTaskCreate, QuickTaskResponse
from humancompiler_api.services import hook_token_service, quick_task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hooks", tags=["hooks"])


def _extract_hook_token(request: Request) -> str:
    """Extract a hook token from supported headers."""
    authorization = request.headers.get("authorization")
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()

    header_token = request.headers.get("x-humancompiler-hook-token")
    if header_token and header_token.strip():
        return header_token.strip()

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Hook token required",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post(
    "/quick-tasks",
    response_model=QuickTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_quick_task_from_hook(
    task_data: QuickTaskCreate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> QuickTaskResponse:
    """Create a quick task using a user-scoped hook token."""
    token = _extract_hook_token(request)
    hook_token = hook_token_service.get_active_token_by_secret(session, token)
    if hook_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid hook token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    task = quick_task_service.create_quick_task(session, task_data, hook_token.user_id)
    hook_token_service.mark_token_used(session, hook_token)

    logger.info("Created hook quick task %s for user %s", task.id, hook_token.user_id)
    return QuickTaskResponse.model_validate(task)
