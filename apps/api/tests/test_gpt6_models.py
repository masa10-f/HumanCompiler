"""Regression coverage for model defaults and GPT-6 API compatibility."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from humancompiler_api.ai.goal_task_drafts import goal_task_draft_service
from humancompiler_api.models import (
    UserSettings,
    UserSettingsCreate,
    UserSettingsUpdate,
)
from humancompiler_api.routers.user_settings import (
    get_available_models,
    get_user_settings,
    update_user_settings,
)


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
