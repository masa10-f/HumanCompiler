"""Regression coverage for model defaults and GPT-6 API compatibility."""

import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from humancompiler_api.ai.goal_task_drafts import goal_task_draft_service
from humancompiler_api.ai.models import WeeklyPlanContext
from humancompiler_api.ai.openai_client import OpenAIClient
from humancompiler_api.models import (
    Task,
    UserSettings,
    UserSettingsCreate,
    UserSettingsUpdate,
)
from humancompiler_api.routers.user_settings import (
    get_available_models,
    get_user_settings,
    update_user_settings,
)


@pytest.fixture
def planning_context():
    return WeeklyPlanContext(
        user_id=str(uuid4()),
        week_start_date=date(2026, 9, 21),
        projects=[],
        goals=[],
        tasks=[Task(id=uuid4(), title="Plan this task", estimate_hours=2)],
        weekly_recurring_tasks=[],
        selected_recurring_task_ids=[],
        capacity_hours=40,
        preferences={},
    )


@pytest.mark.parametrize("model", ["gpt-6-sol", "gpt-6-luna"])
@pytest.mark.asyncio
async def test_gpt6_planning_preserves_reasoning_and_filters_unknown_ids(
    model, planning_context
):
    client = OpenAIClient()
    client.model = model
    client.client = Mock()
    plans = [
        {
            "task_id": task_id,
            "estimated_hours": 2,
            "priority": 1,
            "rationale": "Important work",
        }
        for task_id in [str(planning_context.tasks[0].id), str(uuid4())]
    ]
    client.client.responses.create.return_value = SimpleNamespace(
        status="completed",
        output=[
            SimpleNamespace(type="reasoning"),
            SimpleNamespace(
                type="function_call",
                name="create_weekly_plan",
                arguments=json.dumps({"task_plans": plans}),
            ),
        ],
    )

    result = await client.generate_weekly_plan(planning_context)

    assert result.success
    assert [plan.task_id for plan in result.task_plans] == [plans[0]["task_id"]]
    assert result.total_planned_hours == 2
    client.client.chat.completions.create.assert_not_called()
    params = client.client.responses.create.call_args.kwargs
    assert params["model"] == model
    assert params["reasoning"] == {"effort": "high"}
    assert params["max_output_tokens"] == 8000
    assert params["store"] is False
    assert params["tools"][0]["name"] == "create_weekly_plan"
    assert params["tools"][0]["strict"] is False
    assert params["tool_choice"] == {"type": "function", "name": "create_weekly_plan"}
    assert "temperature" not in params


@pytest.mark.parametrize("response_status", ["incomplete", "failed", "completed"])
@pytest.mark.asyncio
async def test_gpt6_planning_rejects_incomplete_or_missing_function_calls(
    planning_context, response_status
):
    client = OpenAIClient()
    client.client = Mock()
    client.client.responses.create.return_value = SimpleNamespace(
        status=response_status, output=[]
    )
    result = await client.generate_weekly_plan(planning_context)
    assert not result.success
    client.client.chat.completions.create.assert_not_called()


@pytest.mark.parametrize("model", ["gpt-6-sol", "gpt-6-luna"])
def test_gpt6_draft_chat_fallback_preserves_reasoning_without_temperature(model):
    client = Mock()
    client.chat.completions.create.return_value = SimpleNamespace(
        choices=[
            SimpleNamespace(
                finish_reason="stop", message=SimpleNamespace(content='{"goals": []}')
            )
        ]
    )
    assert goal_task_draft_service._call_chat_completions_api(
        client, model, "draft"
    ) == {"goals": []}
    params = client.chat.completions.create.call_args.kwargs
    assert params["reasoning_effort"] == "high"
    assert "temperature" not in params
    assert "tools" not in params


@pytest.mark.asyncio
async def test_new_user_defaults_match_model_picker():
    models = await get_available_models()
    session = Mock()
    session.exec.return_value.one_or_none.return_value = None
    settings = await get_user_settings(uuid4(), session)
    assert settings.openai_model == models["default_model"] == "gpt-6-sol"
    assert UserSettings().openai_model == "gpt-6-sol"
    assert UserSettingsCreate(openai_api_key="test-key").openai_model == "gpt-6-sol"
    assert {"gpt-6-sol", "gpt-6-luna"} <= set(models["models"])


@pytest.mark.parametrize("model", ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano"])
@pytest.mark.asyncio
async def test_existing_model_selection_is_preserved_and_can_be_saved(model):
    saved = UserSettings(id=uuid4(), user_id=uuid4(), openai_model=model)
    session = Mock()
    session.exec.return_value.one_or_none.return_value = saved

    models = await get_available_models()
    settings = await get_user_settings(saved.user_id, session)
    assert settings.openai_model == model
    assert model in models["models"]
    session.commit.assert_not_called()

    updated = await update_user_settings(
        saved.user_id, UserSettingsUpdate(openai_model=model), session
    )
    assert updated.openai_model == model
    assert saved.openai_model == model
    session.commit.assert_called_once()
