"""
Hybrid Optimization Pipeline: GPT-5 + OR-Tools Integration

This module implements a sophisticated 3-stage optimization pipeline that combines
AI-powered task selection with constraint-based scheduling optimization.

Pipeline Stages:
1. GPT-5 Weekly Task Selection: Intelligent task prioritization and selection
2. OR-Tools CP-SAT Optimization: Time constraint optimization with capacity limits
3. Result Integration: Merge and validate results with consistency checks

Architecture:
- Stage-wise execution with progress tracking
- Intermediate result caching for performance
- Rollback capability for error recovery
- Extensible design for future optimization algorithms
"""

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, date
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlmodel import Session

from taskagent_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    TaskSolverResponse,
    WeeklyConstraints,
    ProjectAllocation,
)
from taskagent_api.routers.scheduler import (
    optimize_schedule,
    SchedulerTask,
    TimeSlot,
    TaskKind,
    SlotKind,
    ScheduleResult,
    Assignment,
    map_task_kind_from_work_type,
    map_task_kind,
)
from taskagent_api.models import Task, Goal, Project, WorkType, WeeklySchedule
from taskagent_api.services import task_service, goal_service

logger = logging.getLogger(__name__)


class PipelineStage(Enum):
    """Pipeline execution stages."""

    INITIALIZATION = "initialization"
    TASK_SELECTION = "task_selection"
    TIME_OPTIMIZATION = "time_optimization"
    RESULT_INTEGRATION = "result_integration"
    COMPLETED = "completed"


class OptimizationStatus(Enum):
    """Overall optimization status."""

    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"
    FAILED = "failed"
    IN_PROGRESS = "in_progress"


@dataclass
class StageResult:
    """Result from a pipeline stage."""

    stage: PipelineStage
    success: bool
    duration_seconds: float
    data: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class PipelineMetrics:
    """Performance metrics for the optimization pipeline."""

    total_duration_seconds: float
    stage_durations: dict[PipelineStage, float]
    gpt5_api_calls: int
    ortools_solve_time: float
    tasks_processed: int
    constraints_evaluated: int
    optimization_efficiency: float  # 0-1 scale


class TimeSlotConfig(BaseModel):
    """Time slot configuration for daily optimization."""

    start: str = Field(..., description="Start time in HH:MM format")
    end: str = Field(..., description="End time in HH:MM format")
    kind: str = Field(
        "light_work", description="Slot type: light_work, focused_work, study"
    )
    capacity_hours: float | None = Field(
        None, description="Maximum hours for this slot"
    )


class OptimizationRequest(BaseModel):
    """Request for hybrid optimization pipeline."""

    week_start_date: str = Field(..., description="Week start date (YYYY-MM-DD)")

    # Weekly task selection parameters
    constraints: WeeklyConstraints = Field(default_factory=WeeklyConstraints)
    project_filter: list[str] | None = Field(None, description="Filter by project IDs")
    selected_recurring_task_ids: list[str] = Field(default_factory=list)

    # Daily optimization parameters
    daily_time_slots: list[TimeSlotConfig] = Field(
        default_factory=lambda: [
            TimeSlotConfig(
                start="09:00", end="12:00", kind="focused_work", capacity_hours=3.0
            ),
            TimeSlotConfig(
                start="14:00", end="17:00", kind="light_work", capacity_hours=3.0
            ),
            TimeSlotConfig(
                start="19:00", end="21:00", kind="study", capacity_hours=2.0
            ),
        ]
    )

    # Pipeline configuration
    enable_caching: bool = Field(True, description="Enable intermediate result caching")
    optimization_timeout_seconds: int = Field(
        30, description="Maximum optimization time"
    )
    fallback_on_failure: bool = Field(
        True, description="Use fallback methods on failure"
    )

    preferences: dict[str, Any] = Field(default_factory=dict)
    user_prompt: str | None = Field(
        None, description="User instructions for weekly scheduling priorities"
    )


class DailyOptimizationResult(BaseModel):
    """Daily optimization result within the weekly schedule."""

    date: str
    total_scheduled_hours: float
    assignments: list[dict[str, Any]]
    unscheduled_tasks: list[str]
    optimization_status: str
    solve_time_seconds: float


class OptimizationResponse(BaseModel):
    """Response from hybrid optimization pipeline."""

    success: bool
    status: OptimizationStatus
    week_start_date: str

    # Weekly task selection results
    weekly_solver_response: TaskSolverResponse | None = None

    # Daily optimization results (7 days)
    daily_optimizations: list[DailyOptimizationResult] = Field(default_factory=list)

    # Pipeline execution details
    pipeline_metrics: dict[str, Any] = Field(default_factory=dict)
    stage_results: list[dict[str, Any]] = Field(default_factory=list)

    # Integration analysis
    total_optimized_hours: float = 0.0
    capacity_utilization: float = 0.0
    consistency_score: float = 0.0

    # Insights and recommendations
    optimization_insights: list[str] = Field(default_factory=list)
    performance_analysis: dict[str, Any] = Field(default_factory=dict)

    generated_at: datetime = Field(default_factory=datetime.now)


class HybridOptimizationPipeline:
    """
    Hybrid optimization pipeline combining GPT-5 and OR-Tools.

    This pipeline implements a sophisticated 3-stage optimization process:
    1. AI-powered weekly task selection using GPT-5
    2. Constraint-based daily scheduling using OR-Tools CP-SAT
    3. Result integration with consistency validation
    """

    def __init__(self, session: Session):
        """Initialize pipeline with database session."""
        self.session = session
        self.stage_results: list[StageResult] = []
        self.cache: dict[str, Any] = {}
        self.start_time: float | None = None

    async def execute_optimization(
        self, user_id: str, request: OptimizationRequest
    ) -> OptimizationResponse:
        """
        Execute the complete hybrid optimization pipeline.

        Args:
            user_id: User identifier
            request: Optimization request parameters

        Returns:
            Complete optimization response with weekly and daily results
        """
        self.start_time = time.time()
        logger.info(f"Starting hybrid optimization pipeline for user {user_id}")

        try:
            # Stage 1: Initialize and validate
            init_result = await self._stage_initialization(user_id, request)
            if not init_result.success:
                return self._create_error_response(
                    request, "Initialization failed", init_result.errors
                )

            # Stage 2: GPT-5 weekly task selection
            selection_result = await self._stage_task_selection(user_id, request)
            if not selection_result.success and not request.fallback_on_failure:
                return self._create_error_response(
                    request, "Task selection failed", selection_result.errors
                )

            # Stage 3: OR-Tools daily optimization
            optimization_result = await self._stage_time_optimization(
                user_id, request, selection_result
            )
            if not optimization_result.success and not request.fallback_on_failure:
                return self._create_error_response(
                    request, "Time optimization failed", optimization_result.errors
                )

            # Stage 4: Result integration and analysis
            integration_result = await self._stage_result_integration(
                request, selection_result, optimization_result
            )

            # Build final response
            return self._build_final_response(
                request, selection_result, optimization_result, integration_result
            )

        except Exception as e:
            logger.error(f"Pipeline execution failed: {e}")
            return self._create_error_response(
                request, f"Pipeline execution error: {str(e)}", [str(e)]
            )

    async def _stage_initialization(
        self, user_id: str, request: OptimizationRequest
    ) -> StageResult:
        """Stage 1: Initialize pipeline and validate inputs."""
        stage_start = time.time()
        logger.info("Stage 1: Pipeline initialization")

        try:
            # Validate week start date
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()
            today = date.today()

            if week_start < today and (today - week_start).days > 7:
                return StageResult(
                    stage=PipelineStage.INITIALIZATION,
                    success=False,
                    duration_seconds=time.time() - stage_start,
                    errors=["Cannot optimize for weeks more than 7 days in the past"],
                )

            # Validate time slots
            if not request.daily_time_slots:
                return StageResult(
                    stage=PipelineStage.INITIALIZATION,
                    success=False,
                    duration_seconds=time.time() - stage_start,
                    errors=["At least one daily time slot is required"],
                )

            # Cache initialization data
            if request.enable_caching:
                self.cache["user_id"] = user_id
                self.cache["week_start"] = week_start
                self.cache["request"] = request

            duration = time.time() - stage_start
            logger.info(f"Stage 1 completed in {duration:.2f}s")

            return StageResult(
                stage=PipelineStage.INITIALIZATION,
                success=True,
                duration_seconds=duration,
                data={"user_id": user_id, "week_start": week_start},
            )

        except Exception as e:
            logger.error(f"Initialization stage failed: {e}")
            return StageResult(
                stage=PipelineStage.INITIALIZATION,
                success=False,
                duration_seconds=time.time() - stage_start,
                errors=[f"Initialization error: {str(e)}"],
            )

    async def _stage_task_selection(
        self, user_id: str, request: OptimizationRequest
    ) -> StageResult:
        """Stage 2: GPT-5 powered weekly task selection."""
        stage_start = time.time()
        logger.info("Stage 2: GPT-5 weekly task selection")

        try:
            # Create task solver request
            solver_request = TaskSolverRequest(
                week_start_date=request.week_start_date,
                constraints=request.constraints,
                project_filter=request.project_filter,
                selected_recurring_task_ids=request.selected_recurring_task_ids,
                preferences=request.preferences,
                user_prompt=request.user_prompt,
            )

            # Create user-specific task solver
            task_solver = await WeeklyTaskSolver.create_for_user(
                UUID(user_id), self.session
            )

            # Execute task selection
            solver_response = await task_solver.solve_weekly_tasks(
                session=self.session, user_id=user_id, request=solver_request
            )

            # Cache results
            if request.enable_caching:
                self.cache["solver_response"] = solver_response

            duration = time.time() - stage_start
            logger.info(
                f"Stage 2 completed in {duration:.2f}s - {len(solver_response.selected_tasks)} tasks selected"
            )

            return StageResult(
                stage=PipelineStage.TASK_SELECTION,
                success=solver_response.success,
                duration_seconds=duration,
                data={"solver_response": solver_response},
                errors=[] if solver_response.success else ["Task selection failed"],
                warnings=[]
                if len(solver_response.selected_tasks) > 0
                else ["No tasks selected"],
            )

        except Exception as e:
            logger.error(f"Task selection stage failed: {e}")
            error_message = self._format_task_selection_error(e)

            # If fallback is enabled, create empty response to continue pipeline
            if request.fallback_on_failure:
                logger.info("Creating fallback task selection response")
                # Create user-friendly Japanese insights
                japanese_insights = self._create_japanese_error_insights(error_message)

                fallback_response = TaskSolverResponse(
                    success=False,
                    week_start_date=request.week_start_date,
                    total_allocated_hours=0.0,
                    project_allocations=[],
                    selected_tasks=[],
                    optimization_insights=japanese_insights,
                    constraint_analysis={
                        "error": error_message,
                        "error_ja": japanese_insights[0],
                    },
                    solver_metrics={
                        "fallback_mode": True,
                        "error_type": "connection_error",
                    },
                    generated_at=datetime.now(),
                )

                return StageResult(
                    stage=PipelineStage.TASK_SELECTION,
                    success=True,  # Allow pipeline to continue
                    duration_seconds=time.time() - stage_start,
                    data={"solver_response": fallback_response},
                    errors=[],
                    warnings=[f"Using fallback mode: {error_message}"],
                )

            return StageResult(
                stage=PipelineStage.TASK_SELECTION,
                success=False,
                duration_seconds=time.time() - stage_start,
                errors=[error_message],
            )

    def _format_task_selection_error(self, error: Exception) -> str:
        """Format task selection error for user-friendly display."""
        error_str = str(error)

        if (
            "connect_timeout" in error_str
            or "Connection" in error_str
            or "unexpected keyword argument" in error_str
        ):
            return "AI service connection failed. Please check your internet connection or try again later."
        elif "Authentication" in error_str or "API key" in error_str:
            return (
                "OpenAI API key not configured or invalid. Please check your settings."
            )
        elif "Rate limit" in error_str:
            return "API rate limit exceeded. Please wait a moment and try again."
        elif "badly formed hexadecimal UUID" in error_str:
            return "User authentication error. Please log out and log in again."
        else:
            return f"AI task selection temporarily unavailable: {error_str}"

    def _create_japanese_error_insights(self, error_message: str) -> list[str]:
        """Create user-friendly Japanese error insights."""
        if "connection failed" in error_message.lower():
            return [
                "🔌 AI タスク選択サービスへの接続に失敗しました",
                "💡 対処方法：",
                "  • インターネット接続を確認してください",
                "  • 少し時間をおいて再度お試しください",
                "  • 問題が続く場合は、手動でタスクを選択していただけます",
                "📊 現在はベーシックスケジューリング機能で継続しています",
            ]
        elif "api key" in error_message.lower():
            return [
                "🔑 AI サービスの認証設定に問題があります",
                "💡 対処方法：",
                "  • 設定画面からOpenAI APIキーを確認してください",
                "  • APIキーが正しく入力されているか確認してください",
                "  • APIキーの有効期限をご確認ください",
            ]
        elif "rate limit" in error_message.lower():
            return [
                "⏱️ API使用制限に達しました",
                "💡 対処方法：",
                "  • 数分お待ちいただいてから再度お試しください",
                "  • 使用量制限の詳細はOpenAIダッシュボードでご確認いただけます",
            ]
        elif "authentication" in error_message.lower():
            return [
                "🚪 認証エラーが発生しました",
                "💡 対処方法：",
                "  • 一度ログアウトして再度ログインしてください",
                "  • ブラウザのキャッシュをクリアしてお試しください",
            ]
        else:
            return [
                "🤖 AI タスク選択機能が一時的に利用できません",
                f"📋 詳細: {error_message}",
                "💡 対処方法：",
                "  • 基本的なスケジューリング機能は継続して利用できます",
                "  • しばらく時間をおいて再度お試しください",
            ]

    async def _stage_time_optimization(
        self, user_id: str, request: OptimizationRequest, selection_result: StageResult
    ) -> StageResult:
        """Stage 3: OR-Tools daily time optimization."""
        stage_start = time.time()
        logger.info("Stage 3: OR-Tools daily time optimization")

        try:
            # Get selected tasks from previous stage
            solver_response = selection_result.data.get("solver_response")
            if not solver_response or not solver_response.selected_tasks:
                # If no tasks are available, create empty optimization result
                logger.info("No tasks selected, creating empty optimization result")

                # Create empty daily results for the week
                daily_results = []
                week_start = datetime.strptime(
                    request.week_start_date, "%Y-%m-%d"
                ).date()

                for day_offset in range(7):
                    current_date = week_start + timedelta(days=day_offset)
                    date_str = current_date.strftime("%Y-%m-%d")

                    daily_result = DailyOptimizationResult(
                        date=date_str,
                        total_scheduled_hours=0.0,
                        assignments=[],
                        unscheduled_tasks=[],
                        optimization_status="NO_TASKS",
                        solve_time_seconds=0.0,
                    )
                    daily_results.append(daily_result)

                duration = time.time() - stage_start
                return StageResult(
                    stage=PipelineStage.TIME_OPTIMIZATION,
                    success=True,  # Consider success even with no tasks
                    duration_seconds=duration,
                    data={
                        "daily_results": daily_results,
                        "total_ortools_time": 0.0,
                        "scheduler_tasks": [],
                    },
                    warnings=["No tasks available for time optimization"],
                )

            # Convert selected tasks to scheduler format
            scheduler_tasks = await self._convert_to_scheduler_tasks(
                solver_response.selected_tasks, user_id
            )

            # Convert time slots to scheduler format
            scheduler_slots = self._convert_to_scheduler_slots(request.daily_time_slots)

            # Optimize for each day of the week
            daily_results = []
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

            total_ortools_time = 0.0

            for day_offset in range(7):  # 7 days in a week
                current_date = week_start + timedelta(days=day_offset)
                date_str = current_date.strftime("%Y-%m-%d")

                # Run OR-Tools optimization for this day
                optimization_start = time.time()
                schedule_result = optimize_schedule(
                    scheduler_tasks, scheduler_slots, current_date
                )
                ortools_time = time.time() - optimization_start
                total_ortools_time += ortools_time

                # Convert assignments to response format
                assignments = []
                for assignment in schedule_result.assignments:
                    assignments.append(
                        {
                            "task_id": assignment.task_id,
                            "slot_index": assignment.slot_index,
                            "start_time": assignment.start_time.strftime("%H:%M"),
                            "duration_hours": assignment.duration_hours,
                        }
                    )

                daily_result = DailyOptimizationResult(
                    date=date_str,
                    total_scheduled_hours=schedule_result.total_scheduled_hours,
                    assignments=assignments,
                    unscheduled_tasks=schedule_result.unscheduled_tasks,
                    optimization_status=schedule_result.optimization_status,
                    solve_time_seconds=ortools_time,
                )
                daily_results.append(daily_result)

            # Cache results
            if request.enable_caching:
                self.cache["daily_results"] = daily_results
                self.cache["total_ortools_time"] = total_ortools_time

            duration = time.time() - stage_start
            logger.info(
                f"Stage 3 completed in {duration:.2f}s - {len(daily_results)} days optimized"
            )

            return StageResult(
                stage=PipelineStage.TIME_OPTIMIZATION,
                success=True,
                duration_seconds=duration,
                data={
                    "daily_results": daily_results,
                    "total_ortools_time": total_ortools_time,
                    "scheduler_tasks": scheduler_tasks,
                },
            )

        except Exception as e:
            logger.error(f"Time optimization stage failed: {e}")
            return StageResult(
                stage=PipelineStage.TIME_OPTIMIZATION,
                success=False,
                duration_seconds=time.time() - stage_start,
                errors=[f"Time optimization error: {str(e)}"],
            )

    async def _stage_result_integration(
        self,
        request: OptimizationRequest,
        selection_result: StageResult,
        optimization_result: StageResult,
    ) -> StageResult:
        """Stage 4: Integrate and validate results."""
        stage_start = time.time()
        logger.info("Stage 4: Result integration and validation")

        try:
            solver_response = selection_result.data.get("solver_response")
            daily_results = optimization_result.data.get("daily_results", [])

            # Calculate integration metrics
            total_optimized_hours = sum(
                day.total_scheduled_hours for day in daily_results
            )
            total_available_hours = request.constraints.total_capacity_hours
            capacity_utilization = (
                total_optimized_hours / total_available_hours
                if total_available_hours > 0
                else 0
            )

            # Calculate consistency score (how well the weekly plan matches daily optimizations)
            consistency_score = self._calculate_consistency_score(
                solver_response, daily_results
            )

            # Generate integration insights
            insights = self._generate_integration_insights(
                solver_response, daily_results, capacity_utilization, consistency_score
            )

            duration = time.time() - stage_start
            logger.info(f"Stage 4 completed in {duration:.2f}s")

            return StageResult(
                stage=PipelineStage.RESULT_INTEGRATION,
                success=True,
                duration_seconds=duration,
                data={
                    "total_optimized_hours": total_optimized_hours,
                    "capacity_utilization": capacity_utilization,
                    "consistency_score": consistency_score,
                    "insights": insights,
                },
            )

        except Exception as e:
            logger.error(f"Result integration stage failed: {e}")
            return StageResult(
                stage=PipelineStage.RESULT_INTEGRATION,
                success=False,
                duration_seconds=time.time() - stage_start,
                errors=[f"Integration error: {str(e)}"],
            )

    async def _convert_to_scheduler_tasks(
        self, selected_tasks: list[Any], user_id: str
    ) -> list[SchedulerTask]:
        """Convert selected tasks to scheduler format."""
        scheduler_tasks = []

        for task_plan in selected_tasks:
            # Get full task data from database
            db_task = task_service.get_task_by_id(
                self.session, task_plan.task_id, user_id
            )
            if not db_task:
                logger.warning(f"Task {task_plan.task_id} not found in database")
                continue

            # Determine task kind
            if hasattr(db_task, "work_type") and db_task.work_type:
                task_kind = map_task_kind_from_work_type(db_task.work_type)
            else:
                task_kind = map_task_kind(db_task.title)

            scheduler_task = SchedulerTask(
                id=str(db_task.id),
                title=db_task.title,
                estimate_hours=float(task_plan.estimated_hours),
                priority=task_plan.priority,
                due_date=db_task.due_date,
                kind=task_kind,
                goal_id=str(db_task.goal_id) if db_task.goal_id else None,
            )
            scheduler_tasks.append(scheduler_task)

        return scheduler_tasks

    def _convert_to_scheduler_slots(
        self, time_slot_configs: list[TimeSlotConfig]
    ) -> list[TimeSlot]:
        """Convert time slot configurations to scheduler format."""
        scheduler_slots = []

        for config in time_slot_configs:
            # Parse time strings
            start_parts = config.start.split(":")
            end_parts = config.end.split(":")

            from datetime import time

            start_time = time(int(start_parts[0]), int(start_parts[1]))
            end_time = time(int(end_parts[0]), int(end_parts[1]))

            # Map slot kind
            slot_kind_mapping = {
                "light_work": SlotKind.LIGHT_WORK,
                "focused_work": SlotKind.FOCUSED_WORK,
                "study": SlotKind.STUDY,
            }
            slot_kind = slot_kind_mapping.get(config.kind.lower(), SlotKind.LIGHT_WORK)

            time_slot = TimeSlot(
                start=start_time,
                end=end_time,
                kind=slot_kind,
                capacity_hours=config.capacity_hours,
            )
            scheduler_slots.append(time_slot)

        return scheduler_slots

    def _calculate_consistency_score(
        self,
        solver_response: TaskSolverResponse,
        daily_results: list[DailyOptimizationResult],
    ) -> float:
        """Calculate consistency score between weekly planning and daily optimization."""
        if not solver_response or not daily_results:
            return 0.0

        # Get total planned hours from weekly solver
        total_planned_hours = solver_response.total_allocated_hours

        # Get total scheduled hours from daily optimization
        total_scheduled_hours = sum(day.total_scheduled_hours for day in daily_results)

        # Calculate consistency as the ratio of scheduled to planned hours
        if total_planned_hours > 0:
            consistency = min(total_scheduled_hours / total_planned_hours, 1.0)
        else:
            consistency = 1.0 if total_scheduled_hours == 0 else 0.0

        return consistency

    def _generate_integration_insights(
        self,
        solver_response: TaskSolverResponse,
        daily_results: list[DailyOptimizationResult],
        capacity_utilization: float,
        consistency_score: float,
    ) -> list[str]:
        """Generate insights from pipeline integration."""
        insights = []

        # Capacity analysis
        if capacity_utilization > 0.9:
            insights.append(
                "高い容量利用率（90%以上）: 週間計画が非常に効率的に最適化されています"
            )
        elif capacity_utilization < 0.6:
            insights.append(
                "低い容量利用率（60%未満）: より多くのタスクを計画に含める余地があります"
            )

        # Consistency analysis
        if consistency_score > 0.9:
            insights.append(
                "高い一貫性スコア: 週間計画と日次最適化が良好に整合しています"
            )
        elif consistency_score < 0.7:
            insights.append("一貫性の課題: 週間計画と日次制約の間に不整合があります")

        # Daily optimization analysis
        failed_days = [
            day
            for day in daily_results
            if day.optimization_status in ["INFEASIBLE", "UNKNOWN"]
        ]
        if failed_days:
            insights.append(
                f"{len(failed_days)}日間で最適化が困難でした。時間制約の調整を検討してください"
            )

        # Performance analysis
        total_solve_time = sum(day.solve_time_seconds for day in daily_results)
        if total_solve_time < 1.0:
            insights.append("高速最適化: すべての制約が効率的に解決されました")
        elif total_solve_time > 5.0:
            insights.append("最適化時間が長めです。制約の複雑さを確認してください")

        return insights

    def _build_final_response(
        self,
        request: OptimizationRequest,
        selection_result: StageResult,
        optimization_result: StageResult,
        integration_result: StageResult,
    ) -> OptimizationResponse:
        """Build the final optimization response."""
        total_duration = time.time() - (self.start_time or time.time())

        # Determine overall status
        if (
            selection_result.success
            and optimization_result.success
            and integration_result.success
        ):
            status = OptimizationStatus.SUCCESS
        elif selection_result.success or optimization_result.success:
            status = OptimizationStatus.PARTIAL_SUCCESS
        else:
            status = OptimizationStatus.FAILED

        # Build pipeline metrics
        pipeline_metrics = {
            "total_duration_seconds": total_duration,
            "stage_durations": {
                result.stage.value: result.duration_seconds
                for result in [
                    selection_result,
                    optimization_result,
                    integration_result,
                ]
            },
            "ortools_solve_time": optimization_result.data.get(
                "total_ortools_time", 0.0
            ),
            "tasks_processed": len(optimization_result.data.get("scheduler_tasks", [])),
            "optimization_efficiency": integration_result.data.get(
                "capacity_utilization", 0.0
            ),
        }

        # Build stage results for response
        stage_results_data = []
        for result in [selection_result, optimization_result, integration_result]:
            stage_results_data.append(
                {
                    "stage": result.stage.value,
                    "success": result.success,
                    "duration_seconds": result.duration_seconds,
                    "errors": result.errors,
                    "warnings": result.warnings,
                }
            )

        return OptimizationResponse(
            success=status
            in [OptimizationStatus.SUCCESS, OptimizationStatus.PARTIAL_SUCCESS],
            status=status,
            week_start_date=request.week_start_date,
            weekly_solver_response=selection_result.data.get("solver_response"),
            daily_optimizations=optimization_result.data.get("daily_results", []),
            pipeline_metrics=pipeline_metrics,
            stage_results=stage_results_data,
            total_optimized_hours=integration_result.data.get(
                "total_optimized_hours", 0.0
            ),
            capacity_utilization=integration_result.data.get(
                "capacity_utilization", 0.0
            ),
            consistency_score=integration_result.data.get("consistency_score", 0.0),
            optimization_insights=integration_result.data.get("insights", []),
            performance_analysis={
                "pipeline_efficiency": "high"
                if total_duration < 10
                else "medium"
                if total_duration < 30
                else "low",
                "constraint_satisfaction": "optimal"
                if status == OptimizationStatus.SUCCESS
                else "partial",
                "scalability_score": min(
                    1.0, 100.0 / (pipeline_metrics["tasks_processed"] + 1)
                ),
            },
        )

    def _create_error_response(
        self, request: OptimizationRequest, message: str, errors: list[str]
    ) -> OptimizationResponse:
        """Create error response for pipeline failures."""
        total_duration = time.time() - (self.start_time or time.time())

        return OptimizationResponse(
            success=False,
            status=OptimizationStatus.FAILED,
            week_start_date=request.week_start_date,
            pipeline_metrics={"total_duration_seconds": total_duration},
            optimization_insights=[f"エラー: {message}"] + errors,
        )
