"""
Tests for AI planning router
"""

from datetime import date, datetime
from unittest.mock import Mock, patch, AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException, status

from taskagent_api.routers.ai_planning import (
    generate_weekly_plan,
    test_ai_integration,
    analyze_workload,
    suggest_task_priorities,
)
from taskagent_api.ai_service import WeeklyPlanRequest, WeeklyPlanResponse
import datetime as dt


@pytest.fixture
def mock_session():
    """Mock database session"""
    return Mock()


@pytest.fixture
def weekly_plan_request():
    """Mock weekly plan request"""
    return WeeklyPlanRequest(
        week_start_date="2024-01-01",
        capacity_hours=40.0,
        project_filter=None,
        preferences={}
    )


@pytest.fixture
def mock_plan_response():
    """Mock weekly plan response"""
    return WeeklyPlanResponse(
        success=True,
        week_start_date="2024-01-01",
        total_planned_hours=25.0,
        task_plans=[],
        recommendations=["Focus on deep work in the morning"],
        insights=["Good workload distribution"],
        generated_at=datetime.now()
    )


@pytest.mark.asyncio
async def test_generate_weekly_plan_success(weekly_plan_request, mock_plan_response, mock_session):
    """Test successful weekly plan generation"""
    with patch("taskagent_api.routers.ai_planning.OpenAIService.create_for_user_sync") as mock_openai:
        with patch("taskagent_api.routers.ai_planning.WeeklyPlanService") as mock_service_class:
            mock_service = AsyncMock()
            mock_service.generate_weekly_plan.return_value = mock_plan_response
            mock_service_class.return_value = mock_service

            result = await generate_weekly_plan(weekly_plan_request, "test-user-id", mock_session)

            assert result == mock_plan_response
            assert result.success is True


@pytest.mark.asyncio
async def test_generate_weekly_plan_invalid_date_format(mock_session):
    """Test weekly plan generation with invalid date format"""
    request = WeeklyPlanRequest(
        week_start_date="invalid-date",
        capacity_hours=40.0
    )

    with pytest.raises(HTTPException) as exc_info:
        await generate_weekly_plan(request, "test-user-id", mock_session)

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "INVALID_DATE_FORMAT" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_generate_weekly_plan_past_date(mock_session):
    """Test weekly plan generation with date too far in past"""
    # Create a date more than 7 days in the past
    past_date = (date.today().replace(day=1) - dt.timedelta(days=10)).strftime("%Y-%m-%d")

    request = WeeklyPlanRequest(
        week_start_date=past_date,
        capacity_hours=40.0
    )

    with pytest.raises(HTTPException) as exc_info:
        await generate_weekly_plan(request, "test-user-id", mock_session)

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "INVALID_DATE_RANGE" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_generate_weekly_plan_service_error(weekly_plan_request, mock_session):
    """Test weekly plan generation with service error"""
    with patch("taskagent_api.routers.ai_planning.OpenAIService.create_for_user_sync", side_effect=Exception("Service error")):
        with pytest.raises(HTTPException) as exc_info:
            await generate_weekly_plan(weekly_plan_request, "test-user-id", mock_session)

        assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert "INTERNAL_SERVER_ERROR" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_generate_weekly_plan_current_week_allowed(mock_session):
    """Test that current week planning is allowed"""
    # Use today's date
    today_request = WeeklyPlanRequest(
        week_start_date=date.today().strftime("%Y-%m-%d"),
        capacity_hours=40.0
    )

    with patch("taskagent_api.routers.ai_planning.OpenAIService.create_for_user_sync"):
        with patch("taskagent_api.routers.ai_planning.WeeklyPlanService") as mock_service_class:
            mock_service = AsyncMock()
            mock_response = WeeklyPlanResponse(
                success=True,
                week_start_date=date.today().strftime("%Y-%m-%d"),
                total_planned_hours=20.0,
                task_plans=[],
                recommendations=[],
                insights=[],
                generated_at=datetime.now()
            )
            mock_service.generate_weekly_plan.return_value = mock_response
            mock_service_class.return_value = mock_service

            result = await generate_weekly_plan(today_request, "test-user-id", mock_session)

            assert result.success is True


@pytest.mark.asyncio
async def test_test_ai_integration_success():
    """Test AI integration test endpoint success"""
    mock_client = Mock()
    mock_client.model = "gpt-4-1106-preview"

    mock_functions = [
        {"name": "create_week_plan"},
        {"name": "update_plan"}
    ]

    with patch("taskagent_api.ai.openai_client.OpenAIClient", return_value=mock_client):
        with patch("taskagent_api.ai.prompts.get_function_definitions", return_value=mock_functions):
            result = await test_ai_integration()

            assert result["status"] == "success"
            assert result["model"] == "gpt-4-1106-preview"
            assert result["functions_available"] == 2
            assert result["function_names"] == ["create_week_plan", "update_plan"]


@pytest.mark.asyncio
async def test_test_ai_integration_error():
    """Test AI integration test endpoint error"""
    with patch("taskagent_api.ai.openai_client.OpenAIClient", side_effect=Exception("AI error")):
        result = await test_ai_integration()

        assert result["status"] == "error"
        assert "AI error" in result["message"]
        assert result["model"] is None
        assert result["functions_available"] == 0


@pytest.mark.asyncio
async def test_analyze_workload_success(mock_session):
    """Test successful workload analysis"""
    mock_projects = [Mock(id="project-1", title="Test Project")]
    mock_goals = [Mock(id="goal-1", project_id="project-1")]
    mock_tasks = [
        Mock(id="task-1", goal_id="goal-1", estimate_hours=5.0, status="pending", due_date=None),
        Mock(id="task-2", goal_id="goal-1", estimate_hours=3.0, status="in_progress", due_date=None)
    ]

    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", return_value=mock_projects):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await analyze_workload(None, "test-user-id", mock_session)

                assert result["success"] is True
                assert result["analysis"]["total_estimated_hours"] == 8.0
                assert result["analysis"]["total_tasks"] == 2
                assert "recommendations" in result


@pytest.mark.asyncio
async def test_analyze_workload_with_project_filter(mock_session):
    """Test workload analysis with specific projects"""
    mock_project = Mock(id="project-1", title="Test Project")
    mock_goals = [Mock(id="goal-1", project_id="project-1")]
    mock_tasks = [Mock(id="task-1", goal_id="goal-1", estimate_hours=5.0, status="pending", due_date=None)]

    with patch("taskagent_api.routers.ai_planning.project_service.get_project", return_value=mock_project):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await analyze_workload(["project-1"], "test-user-id", mock_session)

                assert result["success"] is True
                assert result["analysis"]["total_estimated_hours"] == 5.0


@pytest.mark.asyncio
async def test_analyze_workload_overload_recommendations(mock_session):
    """Test workload analysis with overload situation"""
    mock_projects = [Mock(id="project-1", title="Test Project")]
    mock_goals = [Mock(id="goal-1", project_id="project-1")]
    # Create tasks that exceed 40 hours
    mock_tasks = [
        Mock(id=f"task-{i}", goal_id="goal-1", estimate_hours=10.0, status="pending", due_date=None)
        for i in range(5)  # 50 hours total
    ]

    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", return_value=mock_projects):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await analyze_workload(None, "test-user-id", mock_session)

                assert result["success"] is True
                assert result["analysis"]["total_estimated_hours"] == 50.0
                # Should contain overload recommendation
                assert any("consider prioritizing or deferring" in rec for rec in result["recommendations"])


@pytest.mark.asyncio
async def test_analyze_workload_with_overdue_tasks(mock_session):
    """Test workload analysis with overdue tasks"""
    mock_projects = [Mock(id="project-1", title="Test Project")]
    mock_goals = [Mock(id="goal-1", project_id="project-1")]

    # Create overdue task
    yesterday = datetime.now() - dt.timedelta(days=1)
    mock_tasks = [
        Mock(id="task-1", goal_id="goal-1", estimate_hours=5.0, status="pending", 
             due_date=yesterday)
    ]

    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", return_value=mock_projects):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await analyze_workload(None, "test-user-id", mock_session)

                assert result["success"] is True
                assert result["analysis"]["overdue_tasks"] == 1
                assert any("overdue tasks require immediate attention" in rec for rec in result["recommendations"])


@pytest.mark.asyncio
async def test_analyze_workload_error(mock_session):
    """Test workload analysis error handling"""
    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", side_effect=Exception("DB error")):
        with pytest.raises(HTTPException) as exc_info:
            await analyze_workload(None, "test-user-id", mock_session)

        assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


@pytest.mark.asyncio
async def test_suggest_task_priorities_success(mock_session):
    """Test successful task priority suggestions"""
    mock_projects = [Mock(id="project-1", title="Test Project")]
    mock_goals = [Mock(id="goal-1", project_id="project-1")]
    mock_tasks = [
        Mock(id="task-1", goal_id="goal-1", title="Urgent Task", estimate_hours=2.0, 
             status="pending", due_date=datetime.now() + dt.timedelta(days=1)),
        Mock(id="task-2", goal_id="goal-1", title="Regular Task", estimate_hours=5.0, 
             status="pending", due_date=None)
    ]

    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", return_value=mock_projects):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await suggest_task_priorities(None, "test-user-id", mock_session)

                assert result["success"] is True
                assert result["total_tasks_analyzed"] == 2
                assert len(result["priority_suggestions"]) == 2
                assert "methodology" in result


@pytest.mark.asyncio
async def test_suggest_task_priorities_specific_project(mock_session):
    """Test task priority suggestions for specific project"""
    mock_project = Mock(id="project-1", title="Test Project")
    mock_goals = [Mock(id="goal-1", project_id="project-1")]
    mock_tasks = [
        Mock(id="task-1", goal_id="goal-1", title="Test Task", estimate_hours=3.0, 
             status="pending", due_date=None)
    ]

    with patch("taskagent_api.routers.ai_planning.project_service.get_project", return_value=mock_project):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await suggest_task_priorities("project-1", "test-user-id", mock_session)

                assert result["success"] is True
                assert result["total_tasks_analyzed"] == 1


@pytest.mark.asyncio
async def test_suggest_task_priorities_project_not_found(mock_session):
    """Test task priority suggestions when project not found"""
    with patch("taskagent_api.routers.ai_planning.project_service.get_project", return_value=None):
        with pytest.raises(HTTPException) as exc_info:
            await suggest_task_priorities("nonexistent-project", "test-user-id", mock_session)

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "RESOURCE_NOT_FOUND" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_suggest_task_priorities_scoring_algorithm(mock_session):
    """Test task priority scoring algorithm"""
    mock_projects = [Mock(id="project-1", title="Test Project")]
    mock_goals = [Mock(id="goal-1", project_id="project-1")]

    # Create tasks with different characteristics
    overdue_task = Mock(
        id="overdue", goal_id="goal-1", title="Overdue Task", estimate_hours=2.0,
        status="pending", due_date=datetime.now() - dt.timedelta(days=1)
    )

    urgent_task = Mock(
        id="urgent", goal_id="goal-1", title="Urgent Task", estimate_hours=1.0,
        status="pending", due_date=datetime.now() + dt.timedelta(days=1)
    )

    regular_task = Mock(
        id="regular", goal_id="goal-1", title="Regular Task", estimate_hours=8.0,
        status="pending", due_date=None
    )

    mock_tasks = [overdue_task, urgent_task, regular_task]

    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", return_value=mock_projects):
        with patch("taskagent_api.routers.ai_planning.goal_service.get_goals_by_project", return_value=mock_goals):
            with patch("taskagent_api.routers.ai_planning.task_service.get_tasks_by_goal", return_value=mock_tasks):
                result = await suggest_task_priorities(None, "test-user-id", mock_session)

                suggestions = result["priority_suggestions"]
                # Overdue task should have highest score
                assert suggestions[0]["task_id"] == "overdue"
                assert suggestions[0]["priority_score"] > suggestions[1]["priority_score"]


@pytest.mark.asyncio
async def test_suggest_task_priorities_error(mock_session):
    """Test task priority suggestions error handling"""
    with patch("taskagent_api.routers.ai_planning.project_service.get_projects", side_effect=Exception("DB error")):
        with pytest.raises(HTTPException) as exc_info:
            await suggest_task_priorities(None, "test-user-id", mock_session)

        assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


def test_priority_conversion_algorithm():
    """Test priority score to 1-5 scale conversion"""
    # Test the algorithm: min(5, max(1, 6 - (score // 15)))

    # High score (90) should give priority 1
    high_score = 90
    priority = min(5, max(1, 6 - (high_score // 15)))
    assert priority == 1

    # Medium score (45) should give priority 3
    medium_score = 45
    priority = min(5, max(1, 6 - (medium_score // 15)))
    assert priority == 3

    # Low score (0) should give priority 5
    low_score = 0
    priority = min(5, max(1, 6 - (low_score // 15)))
    assert priority == 5
