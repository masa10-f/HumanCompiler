"""
AI-powered planning API endpoints using OpenAI Assistants API.
"""

import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session
from uuid import UUID

from taskagent_api.ai import WeeklyPlanRequest, WeeklyPlanResponse, WeeklyPlanService
from taskagent_api.ai_service import OpenAIService
from taskagent_api.auth import get_current_user_id
from taskagent_api.database import get_session, db
from taskagent_api.models import ErrorResponse
from core.cache import cached, invalidate_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai-planning"])


@router.post(
    "/weekly-plan",
    response_model=WeeklyPlanResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def generate_weekly_plan(
    request: WeeklyPlanRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Generate AI-powered weekly plan using OpenAI Assistants API.

    This endpoint:
    1. Collects user's projects, goals, and pending tasks
    2. Formats context data for AI consumption
    3. Calls OpenAI GPT-4 with function calling for structured planning
    4. Returns optimized weekly schedule with recommendations

    The AI considers:
    - Task priorities and due dates
    - Deep work vs light work scheduling
    - Energy management throughout the day
    - Goal alignment and project balance
    - Realistic capacity planning
    """
    try:
        logger.info(
            f"Generating weekly plan for user {user_id} starting {request.week_start_date}"
        )

        # Validate week start date
        try:
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Invalid date format. Use YYYY-MM-DD",
                    details={"provided_date": request.week_start_date},
                ).model_dump(),
            ) from e

        # Check if date is in the past (allow current week)
        today = date.today()
        if week_start < today and (today - week_start).days > 7:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_RANGE",
                    message="Cannot create plans for weeks more than 7 days in the past",
                    details={
                        "provided_date": str(week_start),
                        "current_date": str(today),
                    },
                ).model_dump(),
            )

        # Create user-specific OpenAI service
        openai_service = OpenAIService.create_for_user_sync(UUID(user_id), session)

        # Create weekly plan service with user's OpenAI service
        weekly_plan_service = WeeklyPlanService(openai_service=openai_service)

        # Generate weekly plan
        plan_response = await weekly_plan_service.generate_weekly_plan(
            session=session, user_id=user_id, request=request
        )

        logger.info(
            f"Weekly plan generated: {len(plan_response.task_plans)} tasks planned"
        )
        return plan_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in weekly plan generation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during plan generation",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.get("/weekly-plan/test")
async def test_ai_integration():
    """Test endpoint to verify OpenAI integration."""
    try:
        from taskagent_api.ai.openai_client import OpenAIClient
        from taskagent_api.ai.prompts import get_function_definitions

        # Test OpenAI service initialization
        ai_client = OpenAIClient()

        # Test function definitions
        functions = get_function_definitions()

        return {
            "status": "success",
            "message": "OpenAI integration working",
            "model": ai_client.model,
            "functions_available": len(functions),
            "function_names": [f["name"] for f in functions],
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"OpenAI integration failed: {str(e)}",
            "model": None,
            "functions_available": 0,
        }


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
        from taskagent_api.ai.analysis_cache import analyze_workload_cached

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
        from taskagent_api.ai.analysis_cache import suggest_priorities_cached

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
