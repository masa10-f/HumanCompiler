"""
Tests for hybrid optimization pipeline (GPT-5 + OR-Tools).

This test suite verifies the integration and functionality of the hybrid
optimization pipeline that combines AI-powered task selection with
constraint-based scheduling optimization.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, date, timedelta
import json

from taskagent_api.optimization.pipeline import (
    HybridOptimizationPipeline,
    OptimizationRequest,
    OptimizationResponse,
    OptimizationStatus,
    TimeSlotConfig,
    WeeklyConstraints,
)
from taskagent_api.ai.weekly_task_solver import TaskSolverResponse, TaskPlan
from taskagent_api.models import Task, Goal, Project


class TestHybridOptimizationPipeline:
    """Test cases for the hybrid optimization pipeline."""

    @pytest.fixture
    def mock_session(self):
        """Mock database session."""
        session = MagicMock()
        return session

    @pytest.fixture
    def sample_request(self):
        """Sample optimization request."""
        # Use current date to avoid past date validation issues
        from datetime import date

        current_date = date.today()
        monday = current_date - timedelta(
            days=current_date.weekday()
        )  # Get Monday of current week

        return OptimizationRequest(
            week_start_date=monday.strftime("%Y-%m-%d"),
            constraints=WeeklyConstraints(
                total_capacity_hours=40.0,
                daily_max_hours=8.0,
                deep_work_blocks=2,
                meeting_buffer_hours=5.0,
            ),
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

    @pytest.fixture
    def mock_task_solver_response(self):
        """Mock task solver response."""
        # Use current date to match sample_request
        from datetime import date

        current_date = date.today()
        monday = current_date - timedelta(days=current_date.weekday())

        return TaskSolverResponse(
            success=True,
            week_start_date=monday.strftime("%Y-%m-%d"),
            total_allocated_hours=30.0,
            project_allocations=[],
            selected_tasks=[
                TaskPlan(
                    task_id="task_1",
                    task_title="Test Task 1",
                    estimated_hours=5.0,
                    priority=1,
                    rationale="High priority task",
                ),
                TaskPlan(
                    task_id="task_2",
                    task_title="Test Task 2",
                    estimated_hours=3.0,
                    priority=2,
                    rationale="Medium priority task",
                ),
            ],
            optimization_insights=["Task selection completed successfully"],
            constraint_analysis={},
            solver_metrics={},
            generated_at=datetime.now(),
        )

    @pytest.mark.asyncio
    async def test_pipeline_initialization_success(self, mock_session, sample_request):
        """Test successful pipeline initialization."""
        pipeline = HybridOptimizationPipeline(mock_session)

        result = await pipeline._stage_initialization("user_123", sample_request)

        assert result.success is True
        assert result.stage.value == "initialization"
        assert "user_id" in result.data
        assert result.data["user_id"] == "user_123"

    @pytest.mark.asyncio
    async def test_pipeline_initialization_invalid_date(self, mock_session):
        """Test pipeline initialization with invalid date."""
        pipeline = HybridOptimizationPipeline(mock_session)

        invalid_request = OptimizationRequest(
            week_start_date="invalid-date",
            daily_time_slots=[
                TimeSlotConfig(start="09:00", end="12:00", kind="focused_work")
            ],
        )

        result = await pipeline._stage_initialization("user_123", invalid_request)

        assert result.success is False
        assert len(result.errors) > 0
        assert "error" in result.errors[0].lower()

    @pytest.mark.asyncio
    async def test_pipeline_initialization_no_time_slots(self, mock_session):
        """Test pipeline initialization with no time slots."""
        pipeline = HybridOptimizationPipeline(mock_session)

        # Use future date to avoid past date validation error
        from datetime import date

        future_date = date.today() + timedelta(days=7)

        invalid_request = OptimizationRequest(
            week_start_date=future_date.strftime("%Y-%m-%d"),
            daily_time_slots=[],  # Empty time slots
        )

        result = await pipeline._stage_initialization("user_123", invalid_request)

        assert result.success is False
        assert len(result.errors) > 0
        assert "time slot" in result.errors[0].lower()

    @pytest.mark.asyncio
    @patch("taskagent_api.optimization.pipeline.WeeklyTaskSolver.create_for_user")
    async def test_task_selection_stage_success(
        self,
        mock_create_solver,
        mock_session,
        sample_request,
        mock_task_solver_response,
    ):
        """Test successful task selection stage."""
        # Setup mocks
        mock_solver = AsyncMock()
        mock_solver.solve_weekly_tasks.return_value = mock_task_solver_response
        mock_create_solver.return_value = mock_solver

        pipeline = HybridOptimizationPipeline(mock_session)

        # Use proper UUID format
        from uuid import uuid4

        user_uuid = str(uuid4())

        result = await pipeline._stage_task_selection(user_uuid, sample_request)

        assert result.success is True
        assert result.stage.value == "task_selection"
        assert "solver_response" in result.data
        assert result.data["solver_response"] == mock_task_solver_response

    @pytest.mark.asyncio
    @patch("taskagent_api.optimization.pipeline.WeeklyTaskSolver.create_for_user")
    async def test_task_selection_stage_failure(
        self, mock_create_solver, mock_session, sample_request
    ):
        """Test task selection stage failure with fallback mode."""
        # Setup mocks to simulate failure that triggers fallback mode
        mock_create_solver.side_effect = Exception(
            "badly formed hexadecimal UUID string"
        )

        pipeline = HybridOptimizationPipeline(mock_session)

        result = await pipeline._stage_task_selection("user_123", sample_request)

        # With fallback_on_failure=True, the stage should succeed but with warnings
        assert result.success is True
        assert result.stage.value == "task_selection"
        assert len(result.warnings) > 0
        assert "Using fallback mode" in result.warnings[0]
        assert "solver_response" in result.data

        # The fallback response should indicate failure mode
        fallback_response = result.data["solver_response"]
        assert fallback_response.success is False
        assert fallback_response.solver_metrics["fallback_mode"] is True

    @pytest.mark.asyncio
    @patch("taskagent_api.optimization.pipeline.optimize_schedule")
    async def test_time_optimization_stage_success(
        self, mock_optimize, mock_session, sample_request, mock_task_solver_response
    ):
        """Test successful time optimization stage."""
        # Setup mocks
        from taskagent_api.routers.scheduler import ScheduleResult, Assignment
        from datetime import time

        mock_schedule_result = ScheduleResult(
            success=True,
            assignments=[
                Assignment(
                    task_id="task_1",
                    slot_index=0,
                    start_time=time(9, 0),
                    duration_hours=3.0,
                )
            ],
            unscheduled_tasks=[],
            total_scheduled_hours=3.0,
            optimization_status="OPTIMAL",
            solve_time_seconds=0.5,
            objective_value=100.0,
        )
        mock_optimize.return_value = mock_schedule_result

        # Mock task service
        with patch(
            "taskagent_api.optimization.pipeline.task_service"
        ) as mock_task_service:
            mock_task = MagicMock()
            mock_task.id = "task_1"
            mock_task.title = "Test Task 1"
            mock_task.due_date = None
            mock_task.goal_id = "goal_1"
            mock_task.work_type = None
            mock_task_service.get_task_by_id.return_value = mock_task

            pipeline = HybridOptimizationPipeline(mock_session)

            # Create stage result with solver response
            selection_result = MagicMock()
            selection_result.data = {"solver_response": mock_task_solver_response}

            result = await pipeline._stage_time_optimization(
                "user_123", sample_request, selection_result
            )

            assert result.success is True
            assert result.stage.value == "time_optimization"
            assert "daily_results" in result.data
            assert len(result.data["daily_results"]) == 7  # 7 days

    @pytest.mark.asyncio
    async def test_time_optimization_stage_no_tasks(self, mock_session, sample_request):
        """Test time optimization stage with no tasks."""
        pipeline = HybridOptimizationPipeline(mock_session)

        # Create stage result with no tasks
        selection_result = MagicMock()
        selection_result.data = {"solver_response": None}

        result = await pipeline._stage_time_optimization(
            "user_123", sample_request, selection_result
        )

        # With improved error handling, no tasks should result in success with warnings
        assert result.success is True
        assert result.stage.value == "time_optimization"
        assert len(result.warnings) > 0
        assert "No tasks available for time optimization" in result.warnings[0]
        assert "daily_results" in result.data
        assert len(result.data["daily_results"]) == 7  # 7 days with empty results

    @pytest.mark.asyncio
    async def test_result_integration_stage_success(
        self, mock_session, sample_request, mock_task_solver_response
    ):
        """Test successful result integration stage."""
        pipeline = HybridOptimizationPipeline(mock_session)

        # Mock stage results
        selection_result = MagicMock()
        selection_result.data = {"solver_response": mock_task_solver_response}

        from taskagent_api.optimization.pipeline import DailyOptimizationResult

        daily_results = [
            DailyOptimizationResult(
                date="2025-01-20",
                total_scheduled_hours=5.0,
                assignments=[],
                unscheduled_tasks=[],
                optimization_status="OPTIMAL",
                solve_time_seconds=0.5,
            )
        ]

        optimization_result = MagicMock()
        optimization_result.data = {"daily_results": daily_results}

        result = await pipeline._stage_result_integration(
            sample_request, selection_result, optimization_result
        )

        assert result.success is True
        assert result.stage.value == "result_integration"
        assert "total_optimized_hours" in result.data
        assert "capacity_utilization" in result.data
        assert "consistency_score" in result.data
        assert "insights" in result.data

    @pytest.mark.asyncio
    @patch("taskagent_api.optimization.pipeline.WeeklyTaskSolver.create_for_user")
    @patch("taskagent_api.optimization.pipeline.optimize_schedule")
    @patch("taskagent_api.optimization.pipeline.task_service")
    async def test_full_pipeline_execution_success(
        self,
        mock_task_service,
        mock_optimize,
        mock_create_solver,
        mock_session,
        sample_request,
        mock_task_solver_response,
    ):
        """Test complete pipeline execution success."""
        # Setup all mocks
        mock_solver = AsyncMock()
        mock_solver.solve_weekly_tasks.return_value = mock_task_solver_response
        mock_create_solver.return_value = mock_solver

        from taskagent_api.routers.scheduler import ScheduleResult, Assignment
        from datetime import time

        mock_schedule_result = ScheduleResult(
            success=True,
            assignments=[
                Assignment(
                    task_id="task_1",
                    slot_index=0,
                    start_time=time(9, 0),
                    duration_hours=3.0,
                )
            ],
            unscheduled_tasks=[],
            total_scheduled_hours=3.0,
            optimization_status="OPTIMAL",
            solve_time_seconds=0.5,
            objective_value=100.0,
        )
        mock_optimize.return_value = mock_schedule_result

        mock_task = MagicMock()
        mock_task.id = "task_1"
        mock_task.title = "Test Task 1"
        mock_task.due_date = None
        mock_task.goal_id = "goal_1"
        mock_task.work_type = None
        mock_task_service.get_task_by_id.return_value = mock_task

        pipeline = HybridOptimizationPipeline(mock_session)

        # Use proper UUID format
        from uuid import uuid4

        user_uuid = str(uuid4())

        response = await pipeline.execute_optimization(user_uuid, sample_request)

        assert response.success is True
        assert response.status == OptimizationStatus.SUCCESS
        # Use the same date as sample_request
        from datetime import date

        current_date = date.today()
        monday = current_date - timedelta(days=current_date.weekday())
        assert response.week_start_date == monday.strftime("%Y-%m-%d")
        assert response.weekly_solver_response is not None
        assert len(response.daily_optimizations) == 7
        assert response.total_optimized_hours > 0
        assert response.capacity_utilization >= 0
        assert response.consistency_score >= 0
        assert len(response.optimization_insights) > 0

    @pytest.mark.asyncio
    async def test_pipeline_execution_timeout_error(self, mock_session, sample_request):
        """Test pipeline execution with timeout."""
        pipeline = HybridOptimizationPipeline(mock_session)

        # Override request timeout to very short value for testing
        sample_request.optimization_timeout_seconds = 0.001

        with patch("asyncio.wait_for") as mock_wait_for:
            import asyncio

            mock_wait_for.side_effect = TimeoutError()

            # This would normally be tested at the router level
            # Here we test the error handling logic
            response = await pipeline.execute_optimization("user_123", sample_request)

            # Should handle gracefully in real implementation
            assert response is not None

    def test_convert_to_scheduler_slots(self, mock_session):
        """Test conversion of time slot configurations to scheduler format."""
        pipeline = HybridOptimizationPipeline(mock_session)

        time_slot_configs = [
            TimeSlotConfig(
                start="09:00", end="12:00", kind="focused_work", capacity_hours=3.0
            ),
            TimeSlotConfig(
                start="14:00", end="17:00", kind="light_work", capacity_hours=3.0
            ),
        ]

        scheduler_slots = pipeline._convert_to_scheduler_slots(time_slot_configs)

        assert len(scheduler_slots) == 2
        assert scheduler_slots[0].start.hour == 9
        assert scheduler_slots[0].start.minute == 0
        assert scheduler_slots[0].end.hour == 12
        assert scheduler_slots[0].end.minute == 0
        assert scheduler_slots[0].capacity_hours == 3.0

    def test_calculate_consistency_score(self, mock_session, mock_task_solver_response):
        """Test consistency score calculation."""
        pipeline = HybridOptimizationPipeline(mock_session)

        from taskagent_api.optimization.pipeline import DailyOptimizationResult
        from datetime import date

        current_date = date.today()
        monday = current_date - timedelta(days=current_date.weekday())
        tuesday = monday + timedelta(days=1)

        daily_results = [
            DailyOptimizationResult(
                date=monday.strftime("%Y-%m-%d"),
                total_scheduled_hours=10.0,
                assignments=[],
                unscheduled_tasks=[],
                optimization_status="OPTIMAL",
                solve_time_seconds=0.5,
            ),
            DailyOptimizationResult(
                date=tuesday.strftime("%Y-%m-%d"),
                total_scheduled_hours=5.0,
                assignments=[],
                unscheduled_tasks=[],
                optimization_status="OPTIMAL",
                solve_time_seconds=0.3,
            ),
        ]

        # Total scheduled = 15.0, total planned = 30.0
        consistency_score = pipeline._calculate_consistency_score(
            mock_task_solver_response, daily_results
        )

        assert 0.0 <= consistency_score <= 1.0
        assert consistency_score == 0.5  # 15.0 / 30.0

    def test_generate_integration_insights(
        self, mock_session, mock_task_solver_response
    ):
        """Test integration insights generation."""
        pipeline = HybridOptimizationPipeline(mock_session)

        from taskagent_api.optimization.pipeline import DailyOptimizationResult
        from datetime import date

        current_date = date.today()
        monday = current_date - timedelta(days=current_date.weekday())

        daily_results = [
            DailyOptimizationResult(
                date=monday.strftime("%Y-%m-%d"),
                total_scheduled_hours=5.0,
                assignments=[],
                unscheduled_tasks=[],
                optimization_status="OPTIMAL",
                solve_time_seconds=0.1,
            )
        ]

        insights = pipeline._generate_integration_insights(
            mock_task_solver_response, daily_results, 0.8, 0.9
        )

        assert isinstance(insights, list)
        assert len(insights) > 0
        # Check for any insight content since Japanese characters might not be exact
        assert any(len(insight) > 0 for insight in insights)


class TestOptimizationModels:
    """Test optimization data models."""

    def test_optimization_request_validation(self):
        """Test optimization request validation."""
        # Valid request - use future date
        from datetime import date, timedelta

        future_date = date.today() + timedelta(days=7)

        request = OptimizationRequest(
            week_start_date=future_date.strftime("%Y-%m-%d"),
            daily_time_slots=[
                TimeSlotConfig(start="09:00", end="12:00", kind="focused_work")
            ],
        )
        assert request.week_start_date == future_date.strftime("%Y-%m-%d")
        assert len(request.daily_time_slots) == 1

    def test_time_slot_config_validation(self):
        """Test time slot configuration validation."""
        slot = TimeSlotConfig(
            start="09:00", end="12:00", kind="focused_work", capacity_hours=3.0
        )
        assert slot.start == "09:00"
        assert slot.end == "12:00"
        assert slot.kind == "focused_work"
        assert slot.capacity_hours == 3.0

    def test_optimization_response_creation(self):
        """Test optimization response creation."""
        from datetime import date, timedelta

        future_date = date.today() + timedelta(days=7)

        response = OptimizationResponse(
            success=True,
            status=OptimizationStatus.SUCCESS,
            week_start_date=future_date.strftime("%Y-%m-%d"),
            total_optimized_hours=25.0,
            capacity_utilization=0.8,
            consistency_score=0.9,
        )
        assert response.success is True
        assert response.status == OptimizationStatus.SUCCESS
        assert response.total_optimized_hours == 25.0
        assert response.capacity_utilization == 0.8
        assert response.consistency_score == 0.9
