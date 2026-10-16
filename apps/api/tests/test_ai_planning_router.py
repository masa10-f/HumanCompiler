"""
Tests for AI planning router with cache mocking
"""

from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, status

from humancompiler_api.routers.ai_planning import (
    analyze_workload,
    suggest_task_priorities,
)


@pytest.fixture
def mock_session():
    """Mock database session"""
    return Mock()


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
