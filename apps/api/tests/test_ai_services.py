"""
Tests for AI services
"""

import pytest
from datetime import date, datetime
from unittest.mock import Mock, patch

from taskagent_api.ai.models import WeeklyPlanContext, WeeklyPlanRequest
from taskagent_api.ai.openai_client import OpenAIClient
from taskagent_api.ai.context_collector import ContextCollector
from taskagent_api.ai.planning_service import WeeklyPlanService
from taskagent_api.models import Project, Goal, Task, TaskStatus


@pytest.fixture
def mock_projects():
    """Mock project data"""
    return [
        Project(
            id="project-1",
            title="Test Project 1",
            description="Test description",
            owner_id="user-1",
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
    ]


@pytest.fixture
def mock_goals():
    """Mock goal data"""
    return [
        Goal(
            id="goal-1",
            project_id="project-1",
            title="Test Goal 1",
            description="Test goal description",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
    ]


@pytest.fixture
def mock_tasks():
    """Mock task data"""
    return [
        Task(
            id="task-1",
            goal_id="goal-1",
            title="Test Task 1",
            description="Test task description",
            estimate_hours=5.0,
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
    ]


@pytest.fixture
def mock_context(mock_projects, mock_goals, mock_tasks):
    """Mock weekly plan context"""
    return WeeklyPlanContext(
        user_id="user-1",
        week_start_date=date.today(),
        projects=mock_projects,
        goals=mock_goals,
        tasks=mock_tasks,
        capacity_hours=40.0,
        preferences={}
    )


def test_openai_client_unavailable():
    """Test OpenAI client when API key is not configured"""
    with patch('taskagent_api.ai.openai_client.settings.openai_api_key', "your_openai_api_key"):
        client = OpenAIClient()
        assert not client.is_available()


def test_openai_client_available():
    """Test OpenAI client when API key is configured"""
    with patch('taskagent_api.ai.openai_client.settings.openai_api_key', "sk-test-key"):
        client = OpenAIClient()
        assert client.is_available()


@pytest.mark.asyncio
async def test_weekly_plan_unavailable(mock_context):
    """Test weekly plan generation when OpenAI is unavailable"""
    with patch('taskagent_api.ai.openai_client.settings.openai_api_key', "your_openai_api_key"):
        client = OpenAIClient()
        response = await client.generate_weekly_plan(mock_context)
        
        assert not response.success
        assert "OpenAI API key not configured" in response.recommendations[0]


@pytest.mark.asyncio
async def test_context_collector():
    """Test context collection"""
    collector = ContextCollector()
    
    # Mock services
    with patch.object(collector.project_service, 'get_projects', return_value=[]):
        with patch.object(collector.goal_service, 'get_goals_by_project', return_value=[]):
            with patch.object(collector.task_service, 'get_tasks_by_goal', return_value=[]):
                
                mock_session = Mock()
                context = await collector.collect_weekly_plan_context(
                    session=mock_session,
                    user_id="user-1",
                    week_start_date=date.today(),
                    capacity_hours=35.0
                )
                
                assert context.user_id == "user-1"
                assert context.capacity_hours == 35.0
                assert isinstance(context.projects, list)
                assert isinstance(context.goals, list)
                assert isinstance(context.tasks, list)


@pytest.mark.asyncio
async def test_weekly_plan_service():
    """Test weekly plan service integration"""
    service = WeeklyPlanService()
    
    # Mock the context collector
    mock_context = WeeklyPlanContext(
        user_id="user-1",
        week_start_date=date.today(),
        projects=[],
        goals=[],
        tasks=[],
        capacity_hours=40.0,
        preferences={}
    )
    
    with patch.object(service.context_collector, 'collect_weekly_plan_context', return_value=mock_context):
        with patch.object(service.openai_client, 'generate_weekly_plan') as mock_generate:
            mock_generate.return_value = Mock(success=True)
            
            request = WeeklyPlanRequest(
                week_start_date=date.today().strftime('%Y-%m-%d'),
                capacity_hours=40.0
            )
            
            mock_session = Mock()
            result = await service.generate_weekly_plan(mock_session, "user-1", request)
            
            # Verify that the OpenAI client was called
            mock_generate.assert_called_once_with(mock_context)


def test_weekly_plan_request_validation():
    """Test weekly plan request model validation"""
    # Valid request
    request = WeeklyPlanRequest(
        week_start_date="2024-01-01",
        capacity_hours=40.0,
        project_filter=["project-1"]
    )
    
    assert request.week_start_date == "2024-01-01"
    assert request.capacity_hours == 40.0
    assert request.project_filter == ["project-1"]
    
    # Request with defaults
    minimal_request = WeeklyPlanRequest(week_start_date="2024-01-01")
    assert minimal_request.capacity_hours == 40.0
    assert minimal_request.project_filter is None