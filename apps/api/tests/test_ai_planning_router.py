"""
Tests for AI planning router with cache mocking
"""

from datetime import date, datetime
from unittest.mock import Mock, patch, AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException, status

from humancompiler_api.routers.ai_planning import (
    generate_weekly_plan,
    test_ai_integration,
    analyze_workload,
    suggest_task_priorities,
)
from humancompiler_api.ai_service import WeeklyPlanRequest, WeeklyPlanResponse
import datetime as dt


@pytest.fixture
def mock_session():
    """Mock database session"""
    return Mock()


@pytest.fixture
def weekly_plan_request():
    """Mock weekly plan request"""
    future_date = "2025-12-01"
    return WeeklyPlanRequest(
        week_start_date=future_date,
        capacity_hours=40.0,
        project_filter=None,
        preferences={},
    )


@pytest.fixture
def mock_plan_response():
    """Mock weekly plan response"""
    future_date = "2025-12-01"
    return WeeklyPlanResponse(
        success=True,
        week_start_date=future_date,
        total_planned_hours=25.0,
        task_plans=[],
        recommendations=["Focus on deep work in the morning"],
        insights=["Good workload distribution"],
        generated_at=datetime.now(),
    )


# Mock workload analysis tests
@pytest.mark.asyncio
async def test_analyze_workload_success(mock_session):
    """Test successful workload analysis"""
    expected_result = {
        "success": True,
        "analysis": {
            "total_estimated_hours": 8.0,
            "total_tasks": 2,
            "overdue_tasks": 0,
            "urgent_tasks": 0,
            "projects_involved": 1,
            "project_distribution": {"Test Project": 8.0},
        },
        "recommendations": ["Workload appears well-balanced"],
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.analyze_workload_cached",
        return_value=expected_result,
    ):
        result = await analyze_workload(
            None, "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["analysis"]["total_estimated_hours"] == 8.0
        assert result["analysis"]["total_tasks"] == 2
        assert "recommendations" in result


@pytest.mark.asyncio
async def test_analyze_workload_with_project_filter(mock_session):
    """Test workload analysis with specific projects"""
    expected_result = {
        "success": True,
        "analysis": {
            "total_estimated_hours": 5.0,
            "total_tasks": 1,
            "overdue_tasks": 0,
            "urgent_tasks": 0,
            "projects_involved": 1,
            "project_distribution": {"Test Project": 5.0},
        },
        "recommendations": ["Workload appears well-balanced"],
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.analyze_workload_cached",
        return_value=expected_result,
    ):
        result = await analyze_workload(
            ["project-1"], "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["analysis"]["total_estimated_hours"] == 5.0


@pytest.mark.asyncio
async def test_analyze_workload_overload_recommendations(mock_session):
    """Test workload analysis with overload situation"""
    expected_result = {
        "success": True,
        "analysis": {
            "total_estimated_hours": 50.0,
            "total_tasks": 5,
            "overdue_tasks": 0,
            "urgent_tasks": 0,
            "projects_involved": 1,
            "project_distribution": {"Test Project": 50.0},
        },
        "recommendations": [
            "Workload is 50.0 hours - consider prioritizing or deferring some tasks"
        ],
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.analyze_workload_cached",
        return_value=expected_result,
    ):
        result = await analyze_workload(
            None, "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["analysis"]["total_estimated_hours"] == 50.0
        assert any(
            "consider prioritizing or deferring" in rec
            for rec in result["recommendations"]
        )


@pytest.mark.asyncio
async def test_analyze_workload_with_overdue_tasks(mock_session):
    """Test workload analysis with overdue tasks"""
    expected_result = {
        "success": True,
        "analysis": {
            "total_estimated_hours": 5.0,
            "total_tasks": 1,
            "overdue_tasks": 1,
            "urgent_tasks": 0,
            "projects_involved": 1,
            "project_distribution": {"Test Project": 5.0},
        },
        "recommendations": ["1 overdue tasks require immediate attention"],
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.analyze_workload_cached",
        return_value=expected_result,
    ):
        result = await analyze_workload(
            None, "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["analysis"]["overdue_tasks"] == 1
        assert any(
            "overdue tasks require immediate attention" in rec
            for rec in result["recommendations"]
        )


# Mock priority suggestion tests
@pytest.mark.asyncio
async def test_suggest_task_priorities_success(mock_session):
    """Test successful priority suggestions"""
    expected_result = {
        "success": True,
        "total_tasks_analyzed": 2,
        "priority_suggestions": [
            {
                "task_id": "task-1",
                "task_title": "High Priority Task",
                "priority_score": 35,
                "suggested_priority": 1,
                "reasoning": ["Due very soon"],
            },
            {
                "task_id": "task-2",
                "task_title": "Low Priority Task",
                "priority_score": 15,
                "suggested_priority": 3,
                "reasoning": ["Medium complexity"],
            },
        ],
        "methodology": {
            "factors": [
                "Due date urgency (0-40 points)",
                "Effort vs impact ratio (0-30 points)",
                "Goal contribution (0-20 points)",
                "Base priority (0-10 points)",
            ],
            "priority_scale": "1 (highest) to 5 (lowest)",
        },
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.suggest_priorities_cached",
        return_value=expected_result,
    ):
        result = await suggest_task_priorities(
            None, "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["total_tasks_analyzed"] == 2
        assert len(result["priority_suggestions"]) == 2


@pytest.mark.asyncio
async def test_suggest_task_priorities_specific_project(mock_session):
    """Test priority suggestions for specific project"""
    expected_result = {
        "success": True,
        "total_tasks_analyzed": 1,
        "priority_suggestions": [
            {
                "task_id": "task-1",
                "task_title": "Project Task",
                "priority_score": 25,
                "suggested_priority": 2,
                "reasoning": ["Due this week", "Medium complexity"],
            }
        ],
        "methodology": {
            "factors": [
                "Due date urgency (0-40 points)",
                "Effort vs impact ratio (0-30 points)",
                "Goal contribution (0-20 points)",
                "Base priority (0-10 points)",
            ],
            "priority_scale": "1 (highest) to 5 (lowest)",
        },
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.suggest_priorities_cached",
        return_value=expected_result,
    ):
        result = await suggest_task_priorities(
            "project-1", "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["total_tasks_analyzed"] == 1


@pytest.mark.asyncio
async def test_suggest_task_priorities_project_not_found(mock_session):
    """Test priority suggestions when project not found"""
    expected_result = {"success": False, "error": "Project not found"}

    with patch(
        "humancompiler_api.ai.analysis_cache.suggest_priorities_cached",
        return_value=expected_result,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await suggest_task_priorities(
                "nonexistent-project",
                "87654321-4321-8765-4321-876543218765",
                mock_session,
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_suggest_task_priorities_scoring_algorithm(mock_session):
    """Test priority scoring algorithm with different task types"""
    expected_result = {
        "success": True,
        "total_tasks_analyzed": 3,
        "priority_suggestions": [
            {
                "task_id": "overdue-task",
                "task_title": "Overdue Task",
                "priority_score": 75,
                "suggested_priority": 1,
                "reasoning": ["Task is overdue", "Quick win (low effort)"],
            },
            {
                "task_id": "urgent-task",
                "task_title": "Due Tomorrow",
                "priority_score": 50,
                "suggested_priority": 1,
                "reasoning": ["Due very soon", "Medium complexity"],
            },
            {
                "task_id": "normal-task",
                "task_title": "Regular Task",
                "priority_score": 25,
                "suggested_priority": 2,
                "reasoning": ["Medium complexity"],
            },
        ],
        "methodology": {
            "factors": [
                "Due date urgency (0-40 points)",
                "Effort vs impact ratio (0-30 points)",
                "Goal contribution (0-20 points)",
                "Base priority (0-10 points)",
            ],
            "priority_scale": "1 (highest) to 5 (lowest)",
        },
        "generated_at": "2025-01-01T00:00:00",
    }

    with patch(
        "humancompiler_api.ai.analysis_cache.suggest_priorities_cached",
        return_value=expected_result,
    ):
        result = await suggest_task_priorities(
            None, "87654321-4321-8765-4321-876543218765", mock_session
        )

        assert result["success"] is True
        assert result["total_tasks_analyzed"] == 3
        # Verify highest priority task has highest score
        suggestions = result["priority_suggestions"]
        assert suggestions[0]["priority_score"] >= suggestions[1]["priority_score"]
        assert suggestions[1]["priority_score"] >= suggestions[2]["priority_score"]


# Original tests that don't use caching
@pytest.mark.asyncio
async def test_generate_weekly_plan_success(
    weekly_plan_request, mock_plan_response, mock_session
):
    """Test successful weekly plan generation"""
    with patch(
        "humancompiler_api.routers.ai_planning.WeeklyPlanService"
    ) as MockService:
        # Mock the service instance
        mock_service_instance = Mock()
        mock_service_instance.generate_weekly_plan = AsyncMock(
            return_value=mock_plan_response
        )
        MockService.return_value = mock_service_instance

        # Mock OpenAIService
        with patch("humancompiler_api.routers.ai_planning.OpenAIService"):
            result = await generate_weekly_plan(
                weekly_plan_request,
                "87654321-4321-8765-4321-876543218765",
                mock_session,
            )

            assert result.success is True
            assert result.total_planned_hours == 25.0
            assert "Focus on deep work" in result.recommendations[0]


@pytest.mark.asyncio
async def test_generate_weekly_plan_invalid_date():
    """Test weekly plan generation with invalid date"""
    invalid_request = WeeklyPlanRequest(
        week_start_date="invalid-date",
        capacity_hours=40.0,
    )

    with pytest.raises(HTTPException) as exc_info:
        await generate_weekly_plan(
            invalid_request, "87654321-4321-8765-4321-876543218765", Mock()
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_generate_weekly_plan_past_date():
    """Test weekly plan generation with far past date"""
    past_date = "2024-01-01"  # More than 7 days in the past
    past_request = WeeklyPlanRequest(
        week_start_date=past_date,
        capacity_hours=40.0,
    )

    with pytest.raises(HTTPException) as exc_info:
        await generate_weekly_plan(
            past_request, "87654321-4321-8765-4321-876543218765", Mock()
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_test_ai_integration_success():
    """Test AI integration test endpoint success"""
    with patch("humancompiler_api.ai.openai_client.OpenAIClient") as MockOpenAIClient:
        with patch(
            "humancompiler_api.ai.prompts.get_function_definitions"
        ) as MockFunctions:
            mock_client = Mock()
            mock_client.model = "gpt-4-1106-preview"
            MockOpenAIClient.return_value = mock_client

            mock_functions = [{"function": {"name": "test_function"}}]
            MockFunctions.return_value = mock_functions

            result = await test_ai_integration()

            assert result["status"] == "success"
            assert result["model"] == "gpt-4-1106-preview"
            assert result["functions_available"] == 1


@pytest.mark.asyncio
async def test_test_ai_integration_error():
    """Test AI integration test endpoint error"""
    with patch(
        "humancompiler_api.ai.openai_client.OpenAIClient",
        side_effect=Exception("Test error"),
    ):
        result = await test_ai_integration()

        assert result["status"] == "error"
        assert "Test error" in result["message"]
        assert result["model"] is None
        assert result["functions_available"] == 0
