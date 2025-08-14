"""
AI-powered planning API endpoints using OpenAI Assistants API.
"""

import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session
from uuid import UUID

from taskagent_api.ai import WeeklyPlanRequest, WeeklyPlanResponse
from taskagent_api.ai.planning_service import WeeklyPlanService
from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    TaskSolverResponse,
)
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

        # Create user-specific OpenAI client (not OpenAIService)
        from taskagent_api.ai.openai_client import OpenAIClient
        from taskagent_api.models import UserSettings
        from sqlmodel import select

        # Get user settings
        result = session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

        openai_client = None
        if user_settings and user_settings.openai_api_key_encrypted:
            # Decrypt API key (try-catch for test environments)
            try:
                from taskagent_api.crypto import get_crypto_service

                api_key = get_crypto_service().decrypt(
                    user_settings.openai_api_key_encrypted
                )
                if api_key:
                    openai_client = OpenAIClient(
                        api_key=api_key, model=user_settings.openai_model
                    )
            except Exception as e:
                logger.warning(f"Failed to decrypt API key: {e}")
                # Continue without user-specific API key

        if not openai_client:
            # Fall back to system API key or no client
            openai_client = OpenAIClient()

        # Create weekly plan service with user's OpenAI client
        weekly_plan_service = WeeklyPlanService(openai_service=openai_client)

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


@router.post(
    "/weekly-task-solver",
    response_model=TaskSolverResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def solve_weekly_tasks(
    request: TaskSolverRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Advanced AI-powered weekly task solver using GPT-5.

    This endpoint provides intelligent task selection and allocation optimization:
    1. Analyzes project priorities and deadline constraints
    2. Optimizes time allocation across multiple projects
    3. Selects optimal tasks considering capacity and constraints
    4. Provides strategic insights on workload optimization

    The solver considers:
    - Project allocation strategies and time budgets
    - Deadline urgency and business impact
    - Weekly capacity and daily time constraints
    - Deep work scheduling and energy management
    - Task dependencies and context switching costs
    """
    try:
        logger.info(
            f"Starting weekly task solving for user {user_id} starting {request.week_start_date}"
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

        # Create user-specific task solver
        task_solver = await WeeklyTaskSolver.create_for_user(UUID(user_id), session)

        # Solve weekly tasks
        solver_response = await task_solver.solve_weekly_tasks(
            session=session, user_id=user_id, request=request
        )

        # Save weekly schedule to database
        from taskagent_api.models import WeeklySchedule
        from uuid import uuid4

        # Prepare schedule data
        schedule_data = {
            "success": solver_response.success,
            "selected_tasks": [
                {
                    "task_id": task.task_id,
                    "task_title": task.task_title,
                    "estimated_hours": task.estimated_hours,
                    "priority": task.priority,
                    "rationale": task.rationale,
                }
                for task in solver_response.selected_tasks
            ],
            "total_allocated_hours": solver_response.total_allocated_hours,
            "project_allocations": [
                {
                    "project_id": alloc.project_id,
                    "project_title": alloc.project_title,
                    "target_hours": alloc.target_hours,
                    "max_hours": alloc.max_hours,
                    "priority_weight": alloc.priority_weight,
                }
                for alloc in solver_response.project_allocations
            ],
            "optimization_insights": solver_response.optimization_insights,
            "constraint_analysis": solver_response.constraint_analysis,
            "solver_metrics": solver_response.solver_metrics,
            "generated_at": solver_response.generated_at.isoformat(),
        }

        week_start_datetime = datetime.strptime(request.week_start_date, "%Y-%m-%d")

        # Check if weekly schedule already exists
        from sqlmodel import select

        existing_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == UUID(user_id),
                WeeklySchedule.week_start_date == week_start_datetime,
            )
        ).first()

        if existing_schedule:
            # Update existing schedule
            existing_schedule.schedule_json = schedule_data
            existing_schedule.selected_recurring_task_ids = [
                UUID(task_id) for task_id in request.selected_recurring_task_ids
            ]
            existing_schedule.updated_at = datetime.now()
            session.add(existing_schedule)
        else:
            # Create new schedule
            new_schedule = WeeklySchedule(
                id=uuid4(),
                user_id=UUID(user_id),
                week_start_date=week_start_datetime,
                schedule_json=schedule_data,
                selected_recurring_task_ids=[
                    UUID(task_id) for task_id in request.selected_recurring_task_ids
                ],
            )
            session.add(new_schedule)

        session.commit()
        logger.info(f"Saved weekly schedule for week {request.week_start_date}")

        logger.info(
            f"Weekly task solving completed: {len(solver_response.selected_tasks)} tasks selected"
        )
        return solver_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in weekly task solver: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during task solving",
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
            "function_names": [f["function"]["name"] for f in functions],
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"OpenAI integration failed: {str(e)}",
            "model": None,
            "functions_available": 0,
        }


@router.get("/diagnose")
async def diagnose_ai_setup(
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """Diagnose AI setup and configuration for debugging"""
    try:
        from taskagent_api.ai.openai_client import OpenAIClient
        from taskagent_api.models import UserSettings
        from sqlmodel import select

        # Get user settings
        result = session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

        # Create user-specific client
        client = await OpenAIClient.create_for_user(UUID(user_id), session)

        return {
            "status": "success",
            "user_id": user_id,
            "has_user_settings": user_settings is not None,
            "has_api_key": bool(
                user_settings and user_settings.openai_api_key_encrypted
            ),
            "configured_model": user_settings.openai_model if user_settings else "N/A",
            "client_available": client.is_available(),
            "client_model": client.model,
            "ai_features_enabled": user_settings.ai_features_enabled
            if user_settings
            else False,
        }
    except Exception as e:
        logger.error(f"Error in AI diagnosis: {e}")
        return {
            "status": "error",
            "message": f"Diagnosis failed: {str(e)}",
            "error_type": type(e).__name__,
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
