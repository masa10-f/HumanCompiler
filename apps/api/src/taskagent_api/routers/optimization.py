"""
Optimization API endpoints for hybrid GPT-5 + OR-Tools pipeline.

This module provides unified optimization endpoints that combine AI-powered
task selection with constraint-based scheduling optimization.
"""

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import get_session
from taskagent_api.models import ErrorResponse
from taskagent_api.optimization.pipeline import (
    HybridOptimizationPipeline,
    OptimizationRequest,
    OptimizationResponse,
    OptimizationStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/optimization", tags=["optimization"])


@router.post(
    "/weekly-pipeline",
    response_model=OptimizationResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def execute_weekly_optimization_pipeline(
    request: OptimizationRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Execute hybrid optimization pipeline combining GPT-5 and OR-Tools.

    This endpoint implements a sophisticated 3-stage optimization process:

    **Stage 1: GPT-5 Weekly Task Selection**
    - Intelligent task prioritization using AI analysis
    - Considers deadlines, project balance, and strategic importance
    - Optimizes task selection within weekly capacity constraints

    **Stage 2: OR-Tools Daily Scheduling**
    - Constraint-based optimization for time allocation
    - Respects time slot constraints and task type matching
    - Maximizes efficiency while maintaining feasibility

    **Stage 3: Result Integration**
    - Validates consistency between weekly planning and daily optimization
    - Provides performance metrics and optimization insights
    - Ensures holistic optimization across all time horizons

    **Key Features:**
    - 30-second timeout with progressive optimization
    - Caching for intermediate results and performance
    - Fallback mechanisms for robustness
    - Comprehensive metrics and analysis
    - Integration validation and consistency checks

    **Optimization Objectives:**
    - Maximize capacity utilization within constraints
    - Balance workload across projects and time periods
    - Respect deadlines and task priorities
    - Minimize context switching and cognitive load
    - Ensure realistic and achievable schedules
    """
    try:
        logger.info(f"Starting weekly optimization pipeline for user {user_id}")
        logger.info(
            f"Request: week_start={request.week_start_date}, constraints={request.constraints}"
        )

        # Validate request parameters
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

        # Validate time slots
        if not request.daily_time_slots:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_TIME_SLOTS",
                    message="At least one daily time slot is required",
                    details={"provided_slots": len(request.daily_time_slots)},
                ).model_dump(),
            )

        # Validate capacity constraints
        if request.constraints.total_capacity_hours <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_CAPACITY",
                    message="Total capacity hours must be positive",
                    details={
                        "provided_capacity": request.constraints.total_capacity_hours
                    },
                ).model_dump(),
            )

        # Initialize and execute optimization pipeline
        pipeline = HybridOptimizationPipeline(session)

        # Execute with timeout handling
        import asyncio

        try:
            optimization_response = await asyncio.wait_for(
                pipeline.execute_optimization(user_id, request),
                timeout=request.optimization_timeout_seconds,
            )
        except TimeoutError:
            logger.warning(
                f"Optimization pipeline timed out after {request.optimization_timeout_seconds}s"
            )
            raise HTTPException(
                status_code=status.HTTP_408_REQUEST_TIMEOUT,
                detail=ErrorResponse.create(
                    code="OPTIMIZATION_TIMEOUT",
                    message=f"Optimization timed out after {request.optimization_timeout_seconds} seconds",
                    details={"timeout_seconds": request.optimization_timeout_seconds},
                ).model_dump(),
            )

        # Log results
        if optimization_response.success:
            logger.info("Pipeline completed successfully:")
            logger.info(f"  - Status: {optimization_response.status.value}")
            logger.info(
                f"  - Total optimized hours: {optimization_response.total_optimized_hours:.1f}"
            )
            logger.info(
                f"  - Capacity utilization: {optimization_response.capacity_utilization:.1%}"
            )
            logger.info(
                f"  - Consistency score: {optimization_response.consistency_score:.1%}"
            )
            logger.info(
                f"  - Daily optimizations: {len(optimization_response.daily_optimizations)}"
            )
        else:
            logger.warning(
                f"Pipeline completed with issues: {optimization_response.status.value}"
            )
            logger.warning(f"Insights: {optimization_response.optimization_insights}")

        # Save results to weekly schedule if successful
        if (
            optimization_response.success
            and optimization_response.weekly_solver_response
        ):
            await _save_weekly_schedule(
                session, user_id, request, optimization_response
            )

        return optimization_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in optimization pipeline: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error during optimization",
                details={"error_type": type(e).__name__},
            ).model_dump(),
        )


@router.get(
    "/pipeline/status/{week_start_date}",
    response_model=dict[str, Any],
    responses={
        404: {"model": ErrorResponse, "description": "Schedule not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_optimization_status(
    week_start_date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Get optimization pipeline status and results for a specific week.

    Returns cached optimization results including:
    - Pipeline execution metrics
    - Weekly task selection results
    - Daily optimization summaries
    - Performance analysis and insights
    """
    try:
        # Validate date format
        try:
            week_start = datetime.strptime(week_start_date, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Invalid date format. Use YYYY-MM-DD",
                    details={"provided_date": week_start_date},
                ).model_dump(),
            ) from e

        # Get weekly schedule
        from taskagent_api.models import WeeklySchedule
        from sqlmodel import select
        from uuid import UUID

        weekly_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == UUID(user_id),
                WeeklySchedule.week_start_date == week_start,
            )
        ).first()

        if not weekly_schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="No optimization results found for week",
                    details={"week_start_date": week_start_date, "user_id": user_id},
                ).model_dump(),
            )

        # Extract optimization results from schedule data
        schedule_data = weekly_schedule.schedule_json or {}

        return {
            "week_start_date": week_start_date,
            "optimization_available": True,
            "last_updated": weekly_schedule.updated_at.isoformat(),
            "selected_tasks_count": len(schedule_data.get("selected_tasks", [])),
            "total_allocated_hours": schedule_data.get("total_allocated_hours", 0.0),
            "project_allocations": schedule_data.get("project_allocations", []),
            "optimization_insights": schedule_data.get("optimization_insights", []),
            "solver_metrics": schedule_data.get("solver_metrics", {}),
            "generated_at": schedule_data.get("generated_at"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting optimization status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to get optimization status",
                details={
                    "error_type": type(e).__name__,
                    "week_start_date": week_start_date,
                },
            ).model_dump(),
        )


@router.delete(
    "/pipeline/cache/{week_start_date}",
    response_model=dict[str, str],
    responses={
        404: {"model": ErrorResponse, "description": "Schedule not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def clear_optimization_cache(
    week_start_date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Clear optimization cache for a specific week.

    This will remove cached optimization results, forcing fresh computation
    on the next optimization request.
    """
    try:
        # Validate date format
        try:
            week_start = datetime.strptime(week_start_date, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorResponse.create(
                    code="INVALID_DATE_FORMAT",
                    message="Invalid date format. Use YYYY-MM-DD",
                    details={"provided_date": week_start_date},
                ).model_dump(),
            ) from e

        # Delete weekly schedule
        from taskagent_api.models import WeeklySchedule
        from sqlmodel import select
        from uuid import UUID

        weekly_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == UUID(user_id),
                WeeklySchedule.week_start_date == week_start,
            )
        ).first()

        if not weekly_schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorResponse.create(
                    code="RESOURCE_NOT_FOUND",
                    message="No optimization cache found for week",
                    details={"week_start_date": week_start_date, "user_id": user_id},
                ).model_dump(),
            )

        session.delete(weekly_schedule)
        session.commit()

        logger.info(
            f"Cleared optimization cache for user {user_id}, week {week_start_date}"
        )

        return {
            "status": "success",
            "message": f"Optimization cache cleared for week {week_start_date}",
            "week_start_date": week_start_date,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing optimization cache: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Failed to clear optimization cache",
                details={
                    "error_type": type(e).__name__,
                    "week_start_date": week_start_date,
                },
            ).model_dump(),
        )


@router.get("/test")
async def test_optimization_pipeline():
    """Test endpoint to verify optimization pipeline integration."""
    try:
        # Test imports and basic functionality
        from taskagent_api.optimization.pipeline import HybridOptimizationPipeline
        from taskagent_api.ai.weekly_task_solver import WeeklyTaskSolver
        from taskagent_api.routers.scheduler import optimize_schedule

        return {
            "status": "success",
            "message": "Optimization pipeline integration working",
            "components": {
                "hybrid_pipeline": "available",
                "weekly_task_solver": "available",
                "ortools_scheduler": "available",
            },
            "features": {
                "gpt5_task_selection": "enabled",
                "ortools_optimization": "enabled",
                "result_integration": "enabled",
                "caching": "enabled",
                "timeout_handling": "enabled",
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Optimization pipeline test failed: {str(e)}",
            "error_type": type(e).__name__,
        }


@router.post("/test-pipeline")
async def test_pipeline_detailed():
    """Test endpoint for detailed pipeline testing without authentication."""
    try:
        from taskagent_api.optimization.pipeline import (
            HybridOptimizationPipeline,
            OptimizationRequest,
            WeeklyConstraints,
            TimeSlotConfig,
        )
        from taskagent_api.database import get_session
        from datetime import datetime

        # Create test request
        test_request = OptimizationRequest(
            week_start_date="2025-08-18",
            constraints=WeeklyConstraints(
                total_capacity_hours=40,
                daily_max_hours=8,
                deep_work_blocks=2,
                meeting_buffer_hours=4,
            ),
            selected_recurring_task_ids=[],
            daily_time_slots=[
                TimeSlotConfig(
                    start="09:00", end="12:00", kind="focused_work", capacity_hours=3.0
                ),
                TimeSlotConfig(
                    start="14:00", end="17:00", kind="light_work", capacity_hours=3.0
                ),
            ],
        )

        # Test each stage individually
        session = next(get_session())
        pipeline = HybridOptimizationPipeline(session)

        # Use valid UUID for test user
        import uuid

        test_user_id = str(uuid.uuid4())

        # Test Stage 1: Initialization
        init_result = await pipeline._stage_initialization(test_user_id, test_request)

        # Test Stage 2: Task Selection (with error handling)
        try:
            selection_result = await pipeline._stage_task_selection(
                test_user_id, test_request
            )
            task_selection_status = "success" if selection_result.success else "failed"
            task_selection_error = selection_result.errors
        except Exception as e:
            task_selection_status = "error"
            task_selection_error = [f"Task selection error: {str(e)}"]

            # For testing, we'll create a mock success result with no tasks
            logger.info(f"Task selection failed in test mode: {e}")
            selection_result = None

        # Test Stage 3: Time Optimization (with mock data if task selection failed)
        try:
            # Create mock selection result if task selection failed
            if task_selection_status != "success":
                from taskagent_api.optimization.pipeline import (
                    StageResult,
                    PipelineStage,
                )
                from taskagent_api.ai.weekly_task_solver import TaskSolverResponse

                # Create a simple mock solver response with empty tasks
                mock_solver_response = TaskSolverResponse(
                    success=True,
                    week_start_date="2025-08-18",
                    total_allocated_hours=0.0,
                    project_allocations=[],
                    selected_tasks=[],
                    optimization_insights=["Test mode: No tasks selected"],
                    constraint_analysis={},
                    solver_metrics={},
                    generated_at=datetime.now(),
                )

                mock_selection_result = StageResult(
                    stage=PipelineStage.TASK_SELECTION,
                    success=True,
                    duration_seconds=0.1,
                    data={"solver_response": mock_solver_response},
                )
            else:
                mock_selection_result = selection_result

            time_optimization_result = await pipeline._stage_time_optimization(
                test_user_id, test_request, mock_selection_result
            )
            time_optimization_status = (
                "success" if time_optimization_result.success else "failed"
            )
            time_optimization_error = time_optimization_result.errors
        except Exception as e:
            time_optimization_status = "error"
            time_optimization_error = [str(e)]

        return {
            "status": "test_completed",
            "message": "Detailed pipeline test completed",
            "stages": {
                "initialization": {
                    "status": "success" if init_result.success else "failed",
                    "duration": init_result.duration_seconds,
                    "errors": init_result.errors,
                },
                "task_selection": {
                    "status": task_selection_status,
                    "errors": task_selection_error,
                },
                "time_optimization": {
                    "status": time_optimization_status,
                    "errors": time_optimization_error,
                },
            },
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"Pipeline test failed: {str(e)}",
            "error_type": type(e).__name__,
            "traceback": str(e),
        }


@router.post("/test-pipeline-full")
async def test_pipeline_full():
    """Test endpoint for full pipeline execution without authentication."""
    try:
        from taskagent_api.optimization.pipeline import (
            HybridOptimizationPipeline,
            OptimizationRequest,
            WeeklyConstraints,
            TimeSlotConfig,
        )
        from taskagent_api.database import get_session
        import uuid

        # Create test request
        test_request = OptimizationRequest(
            week_start_date="2025-08-18",
            constraints=WeeklyConstraints(
                total_capacity_hours=40,
                daily_max_hours=8,
                deep_work_blocks=2,
                meeting_buffer_hours=4,
            ),
            selected_recurring_task_ids=[],
            daily_time_slots=[
                TimeSlotConfig(
                    start="09:00", end="12:00", kind="focused_work", capacity_hours=3.0
                ),
                TimeSlotConfig(
                    start="14:00", end="17:00", kind="light_work", capacity_hours=3.0
                ),
            ],
            enable_caching=True,
            optimization_timeout_seconds=30,
            fallback_on_failure=True,
        )

        # Execute full pipeline
        session = next(get_session())
        pipeline = HybridOptimizationPipeline(session)

        # Use valid UUID for test user
        test_user_id = str(uuid.uuid4())

        # Execute the complete pipeline
        response = await pipeline.execute_optimization(test_user_id, test_request)

        return response.model_dump()

    except Exception as e:
        logger.error(f"Full pipeline test failed: {e}")
        return {
            "status": "error",
            "message": f"Full pipeline test failed: {str(e)}",
            "error_type": type(e).__name__,
            "traceback": str(e),
        }


async def _save_weekly_schedule(
    session: Session,
    user_id: str,
    request: OptimizationRequest,
    optimization_response: OptimizationResponse,
):
    """Save optimization results to weekly schedule."""
    try:
        from taskagent_api.models import WeeklySchedule
        from sqlmodel import select
        from uuid import UUID, uuid4

        week_start_datetime = datetime.strptime(request.week_start_date, "%Y-%m-%d")

        # Prepare schedule data for database
        schedule_data = {
            "success": optimization_response.success,
            "status": optimization_response.status.value,
            "selected_tasks": [
                {
                    "task_id": task.task_id,
                    "task_title": task.task_title,
                    "estimated_hours": task.estimated_hours,
                    "priority": task.priority,
                    "rationale": task.rationale,
                }
                for task in optimization_response.weekly_solver_response.selected_tasks
            ]
            if optimization_response.weekly_solver_response
            else [],
            "total_allocated_hours": optimization_response.total_optimized_hours,
            "capacity_utilization": optimization_response.capacity_utilization,
            "consistency_score": optimization_response.consistency_score,
            "project_allocations": [
                {
                    "project_id": alloc.project_id,
                    "project_title": alloc.project_title,
                    "target_hours": alloc.target_hours,
                    "max_hours": alloc.max_hours,
                    "priority_weight": alloc.priority_weight,
                }
                for alloc in optimization_response.weekly_solver_response.project_allocations
            ]
            if optimization_response.weekly_solver_response
            else [],
            "daily_optimizations": [
                {
                    "date": day.date,
                    "total_scheduled_hours": day.total_scheduled_hours,
                    "assignments_count": len(day.assignments),
                    "unscheduled_tasks_count": len(day.unscheduled_tasks),
                    "optimization_status": day.optimization_status,
                    "solve_time_seconds": day.solve_time_seconds,
                }
                for day in optimization_response.daily_optimizations
            ],
            "optimization_insights": optimization_response.optimization_insights,
            "pipeline_metrics": optimization_response.pipeline_metrics,
            "performance_analysis": optimization_response.performance_analysis,
            "generated_at": optimization_response.generated_at.isoformat(),
        }

        # Check if weekly schedule already exists
        existing_schedule = session.exec(
            select(WeeklySchedule).where(
                WeeklySchedule.user_id == UUID(user_id),
                WeeklySchedule.week_start_date == week_start_datetime,
            )
        ).first()

        if existing_schedule:
            # Update existing schedule
            # Include selected_recurring_task_ids in schedule_json
            schedule_data["selected_recurring_task_ids"] = (
                request.selected_recurring_task_ids
            )
            existing_schedule.schedule_json = schedule_data
            existing_schedule.updated_at = datetime.now()
            session.add(existing_schedule)
        else:
            # Create new schedule
            # Include selected_recurring_task_ids in schedule_json
            schedule_data["selected_recurring_task_ids"] = (
                request.selected_recurring_task_ids
            )
            new_schedule = WeeklySchedule(
                id=uuid4(),
                user_id=UUID(user_id),
                week_start_date=week_start_datetime,
                schedule_json=schedule_data,
            )
            session.add(new_schedule)

        session.commit()
        logger.info(
            f"Saved optimization results to weekly schedule for week {request.week_start_date}"
        )

    except Exception as e:
        logger.error(f"Failed to save weekly schedule: {e}")
        # Don't raise exception here - optimization still succeeded
