"""Planning API endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from humancompiler_api.ai.goal_task_drafts import (
    GoalTaskDraftApplyRequest,
    GoalTaskDraftApplyResponse,
    GoalTaskDraftJobResponse,
    GoalTaskDraftJobStatusResponse,
    GoalTaskDraftRequest,
    GoalTaskDraftResponse,
    goal_task_draft_service,
)
from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.models import ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai-planning"])


@router.post(
    "/goal-task-draft-jobs",
    response_model=GoalTaskDraftJobResponse,
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Project, goal, or task not found",
        },
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def start_goal_task_draft_job(
    request: GoalTaskDraftRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> GoalTaskDraftJobResponse:
    """Start a background AI draft generation job."""
    try:
        return goal_task_draft_service.start_draft_job(session, user_id, request)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error starting goal/task draft job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during goal/task draft job start",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.get(
    "/goal-task-draft-jobs/{response_id}",
    response_model=GoalTaskDraftJobStatusResponse,
    responses={
        404: {"model": ErrorResponse, "description": "AI draft job not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_goal_task_draft_job(
    response_id: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> GoalTaskDraftJobStatusResponse:
    """Get the current status or result of a background AI draft generation job."""
    try:
        return goal_task_draft_service.get_draft_job(session, user_id, response_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error retrieving goal/task draft job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during goal/task draft job retrieval",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.post(
    "/goal-task-drafts",
    response_model=GoalTaskDraftResponse,
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Project, goal, or task not found",
        },
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def generate_goal_task_draft(
    request: GoalTaskDraftRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> GoalTaskDraftResponse:
    """Generate editable AI drafts for goals and tasks."""
    try:
        return goal_task_draft_service.generate_draft(session, user_id, request)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in goal/task draft generation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during goal/task draft generation",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.post(
    "/apply-goal-task-draft",
    response_model=GoalTaskDraftApplyResponse,
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Project, goal, or task not found",
        },
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def apply_goal_task_draft(
    request: GoalTaskDraftApplyRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> GoalTaskDraftApplyResponse:
    """Persist selected goal/task drafts after user review."""
    try:
        return goal_task_draft_service.apply_draft(session, user_id, request)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error applying goal/task draft: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during goal/task draft apply",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.post(
    "/analyze-workload",
    responses={
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def analyze_workload(
    project_ids: list[str] | None = None,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Analyze current workload and provide recommendations.

    This endpoint analyzes:
    - Total estimated hours vs capacity
    - Task distribution across projects
    - Due date pressure and urgency
    - Potential bottlenecks and overcommitments
    """
    try:
        from humancompiler_api.ai.analysis_cache import analyze_workload_cached

        # Use cached version for workload analysis
        return analyze_workload_cached(session, user_id, project_ids)

    except Exception as e:
        logger.error(f"Error in workload analysis: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during workload analysis",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.post(
    "/suggest-priorities",
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def suggest_task_priorities(
    project_id: str | None = None,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Get AI suggestions for task prioritization.

    Uses heuristics to suggest task priorities based on:
    - Due dates and urgency
    - Estimated effort vs impact
    - Dependencies and blockers
    - Project strategic importance
    """
    try:
        from humancompiler_api.ai.analysis_cache import suggest_priorities_cached

        # Use cached version for priority suggestions
        result = suggest_priorities_cached(session, user_id, project_id)

        # Check for errors in cached result
        if not result.get("success") and result.get("error") == "Project not found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="Project not found",
                    details={"project_id": project_id},
                ).model_dump(),
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in priority suggestions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during priority analysis",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )
