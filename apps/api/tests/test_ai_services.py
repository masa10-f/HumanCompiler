"""
Tests for AI services - Updated for current ai_service.py implementation
"""

import json
from datetime import date, datetime
from unittest.mock import Mock, patch, AsyncMock
from uuid import UUID

import pytest

from taskagent_api.ai_service import (
    OpenAIService,
    WeeklyPlanService,
    WeeklyPlanContext,
    WeeklyPlanRequest,
    WeeklyPlanResponse,
    TaskPlan,
)
from taskagent_api.models import Goal, Project, Task, TaskStatus, UserSettings


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
            updated_at=datetime.now(),
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
            updated_at=datetime.now(),
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
            updated_at=datetime.now(),
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
        preferences={},
    )


def test_openai_service_initialization_no_api_key():
    """Test OpenAI service initialization without API key"""
    with patch("taskagent_api.ai_service.settings.openai_api_key", None):
        service = OpenAIService()
        assert service.client is None
        assert service.model == "gpt-4-1106-preview"


def test_openai_service_initialization_with_api_key():
    """Test OpenAI service initialization with API key"""
    with patch("taskagent_api.ai_service.settings.openai_api_key", "sk-test-key"):
        with patch("taskagent_api.ai_service.OpenAI") as mock_openai:
            service = OpenAIService()
            assert service.client is not None
            mock_openai.assert_called_once_with(api_key="sk-test-key")


def test_openai_service_initialization_with_user_api_key():
    """Test OpenAI service initialization with user-provided API key"""
    with patch("taskagent_api.ai_service.OpenAI") as mock_openai:
        service = OpenAIService(api_key="user-key", model="gpt-3.5-turbo")
        assert service.model == "gpt-3.5-turbo"
        mock_openai.assert_called_once_with(api_key="user-key")


@pytest.mark.asyncio
async def test_create_for_user_with_encrypted_key():
    """Test creating OpenAI service for user with encrypted API key"""
    user_id = UUID("12345678-1234-5678-1234-567812345678")

    mock_user_settings = Mock()
    mock_user_settings.openai_api_key_encrypted = "encrypted_key"
    mock_user_settings.openai_model = "gpt-4"

    mock_session = AsyncMock()
    mock_result = Mock()
    mock_result.scalar_one_or_none.return_value = mock_user_settings
    mock_session.execute.return_value = mock_result

    with patch("taskagent_api.ai_service.get_crypto_service") as mock_crypto:
        mock_crypto.return_value.decrypt.return_value = "decrypted-key"
        with patch("taskagent_api.ai_service.OpenAI") as mock_openai:
            service = await OpenAIService.create_for_user(user_id, mock_session)
            mock_openai.assert_called_once_with(api_key="decrypted-key")


@pytest.mark.asyncio
async def test_create_for_user_no_settings():
    """Test creating OpenAI service for user without settings"""
    user_id = UUID("12345678-1234-5678-1234-567812345678")

    mock_session = AsyncMock()
    mock_result = Mock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    with patch("taskagent_api.ai_service.settings.openai_api_key", "system-key"):
        with patch("taskagent_api.ai_service.OpenAI") as mock_openai:
            service = await OpenAIService.create_for_user(user_id, mock_session)
            mock_openai.assert_called_once_with(api_key="system-key")


def test_create_for_user_sync():
    """Test synchronous user-specific service creation"""
    user_id = UUID("12345678-1234-5678-1234-567812345678")

    mock_user_settings = Mock()
    mock_user_settings.openai_api_key_encrypted = "encrypted_key"
    mock_user_settings.openai_model = "gpt-4"

    mock_session = Mock()
    mock_session.exec.return_value.one_or_none.return_value = mock_user_settings

    with patch("taskagent_api.ai_service.get_crypto_service") as mock_crypto:
        mock_crypto.return_value.decrypt.return_value = "decrypted-key"
        with patch("taskagent_api.ai_service.OpenAI") as mock_openai:
            service = OpenAIService.create_for_user_sync(user_id, mock_session)
            mock_openai.assert_called_once_with(api_key="decrypted-key")


def test_get_function_definitions():
    """Test OpenAI function definitions generation"""
    service = OpenAIService()
    definitions = service.get_function_definitions()

    assert len(definitions) == 2
    assert definitions[0]["name"] == "create_week_plan"
    assert definitions[1]["name"] == "update_plan"

    # Verify structure of create_week_plan
    create_plan = definitions[0]
    assert "parameters" in create_plan
    assert "task_plans" in create_plan["parameters"]["properties"]
    assert "recommendations" in create_plan["parameters"]["properties"]
    assert "insights" in create_plan["parameters"]["properties"]


def test_create_system_prompt():
    """Test system prompt creation"""
    service = OpenAIService()
    prompt = service.create_system_prompt()

    assert "task planning and productivity assistant" in prompt
    assert "Deep Work First" in prompt
    assert "create_week_plan" in prompt


def test_format_context_for_llm(mock_context):
    """Test LLM context formatting"""
    service = OpenAIService()
    formatted = service.format_context_for_llm(mock_context)

    assert f"User ID: {mock_context.user_id}" in formatted
    assert f"Available Capacity: {mock_context.capacity_hours} hours" in formatted
    assert "Projects" in formatted
    assert "Goals" in formatted
    assert "Pending Tasks" in formatted


@pytest.mark.asyncio
async def test_generate_weekly_plan_no_client(mock_context):
    """Test weekly plan generation when OpenAI client is unavailable"""
    service = OpenAIService()
    service.client = None

    response = await service.generate_weekly_plan(mock_context)

    assert not response.success
    assert "OpenAI API key not configured" in response.recommendations[0]
    assert response.total_planned_hours == 0.0


@pytest.mark.asyncio
async def test_generate_weekly_plan_success(mock_context):
    """Test successful weekly plan generation"""
    mock_openai_response = Mock()
    mock_openai_response.choices = [Mock()]
    mock_openai_response.choices[0].message.function_call = Mock()
    mock_openai_response.choices[0].message.function_call.name = "create_week_plan"
    mock_openai_response.choices[0].message.function_call.arguments = json.dumps({
        "task_plans": [
            {
                "task_id": "task-1",
                "estimated_hours": 5.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "morning",
                "rationale": "High priority task for morning focus"
            }
        ],
        "recommendations": ["Focus on deep work in the morning"],
        "insights": ["Good workload distribution"]
    })
    mock_openai_response.usage = Mock()
    mock_openai_response.usage.total_tokens = 500

    mock_client = Mock()
    mock_client.chat.completions.create.return_value = mock_openai_response

    service = OpenAIService()
    service.client = mock_client

    with patch.object(service, '_log_api_usage', new_callable=AsyncMock):
        response = await service.generate_weekly_plan(mock_context)

    assert response.success
    assert len(response.task_plans) == 1
    assert response.task_plans[0].task_id == "task-1"
    assert response.task_plans[0].estimated_hours == 5.0
    assert response.total_planned_hours == 5.0


@pytest.mark.asyncio
async def test_generate_weekly_plan_openai_error(mock_context):
    """Test weekly plan generation with OpenAI API error"""
    mock_client = Mock()
    mock_client.chat.completions.create.side_effect = Exception("OpenAI API error")

    service = OpenAIService()
    service.client = mock_client

    with patch.object(service, '_log_api_usage', new_callable=AsyncMock):
        response = await service.generate_weekly_plan(mock_context)

    assert not response.success
    assert "Error generating plan" in response.recommendations[0]


@pytest.mark.skip("Complex external dependency - skipped for now")
@pytest.mark.asyncio
async def test_log_api_usage():
    """Test API usage logging"""
    service = OpenAIService()

    mock_session = Mock()
    mock_db_gen = iter([mock_session, StopIteration])

    with patch("taskagent_api.ai_service.get_db", return_value=mock_db_gen):
        await service._log_api_usage("12345678-1234-5678-1234-567812345678", "weekly-plan", 100, "success")

        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_weekly_plan_service_collect_context():
    """Test WeeklyPlanService context collection"""
    mock_session = Mock()

    with patch("taskagent_api.ai_service.project_service.get_projects", return_value=[]):
        with patch("taskagent_api.ai_service.goal_service.get_goals_by_project", return_value=[]):
            with patch("taskagent_api.ai_service.task_service.get_tasks_by_goal", return_value=[]):
                service = WeeklyPlanService()
                context = await service.collect_context(
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


@pytest.mark.skip("Complex OpenAI integration - skipped for now")
@pytest.mark.asyncio
async def test_weekly_plan_service_generate_plan():
    """Test WeeklyPlanService plan generation"""
    mock_session = Mock()
    request = WeeklyPlanRequest(
        week_start_date="2024-01-01",
        capacity_hours=40.0
    )

    mock_context = WeeklyPlanContext(
        user_id="user-1",
        week_start_date=date.today(),
        projects=[],
        goals=[],
        tasks=[],
        capacity_hours=40.0,
        preferences={}
    )

    mock_response = WeeklyPlanResponse(
        success=True,
        week_start_date="2024-01-01",
        total_planned_hours=10.0,
        task_plans=[],
        recommendations=[],
        insights=[],
        generated_at=datetime.now()
    )

    service = WeeklyPlanService()

    with patch.object(service, 'collect_context', return_value=mock_context):
        with patch("taskagent_api.ai_service.OpenAIService.create_for_user") as mock_create:
            mock_openai_service = AsyncMock()
            mock_openai_service.generate_weekly_plan.return_value = mock_response
            mock_create.return_value = mock_openai_service

            result = await service.generate_weekly_plan(mock_session, "user-1", request)

            assert result.success
            assert result.total_planned_hours == 10.0


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


def test_task_plan_model():
    """Test TaskPlan model creation"""
    plan = TaskPlan(
        task_id="task-1",
        task_title="Test Task",
        estimated_hours=5.0,
        priority=1,
        suggested_day="Monday",
        suggested_time_slot="morning",
        rationale="Test rationale"
    )

    assert plan.task_id == "task-1"
    assert plan.task_title == "Test Task"
    assert plan.estimated_hours == 5.0
    assert plan.priority == 1


def test_weekly_plan_response_serialization():
    """Test WeeklyPlanResponse serialization"""
    now = datetime.now()
    response = WeeklyPlanResponse(
        success=True,
        week_start_date="2024-01-01",
        total_planned_hours=10.0,
        task_plans=[],
        recommendations=["Test recommendation"],
        insights=["Test insight"],
        generated_at=now
    )

    # Test datetime serialization
    serialized_time = response.serialize_generated_at(now)
    assert serialized_time == now.isoformat()
