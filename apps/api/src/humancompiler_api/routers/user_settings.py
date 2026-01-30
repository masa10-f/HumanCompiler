"""User settings API routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session, select

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.crypto import get_crypto_service
from humancompiler_api.database import get_session
from humancompiler_api.exceptions import NotFoundError, ValidationError
from humancompiler_api.models import (
    UserSettings,
    UserSettingsCreate,
    UserSettingsResponse,
    UserSettingsUpdate,
    EmailNotificationSettingsUpdate,
)

router = APIRouter(prefix="/api/user", tags=["user-settings"])


AVAILABLE_MODELS = {
    "gpt-5": {
        "name": "GPT-5",
        "description": "フラッグシップモデル - 高度推論・エージェント・コーディング",
        "max_context": "400k tokens",
        "max_output": "128k tokens",
        "modalities": ["text", "image_input"],
    },
    "gpt-5-mini": {
        "name": "GPT-5 mini",
        "description": "低コスト・高速 - 明確なタスクに最適",
        "max_context": "400k tokens",
        "max_output": "128k tokens",
        "modalities": ["text", "image_input"],
    },
    "gpt-5-nano": {
        "name": "GPT-5 nano",
        "description": "最小コスト・最速 - 要約・分類など",
        "max_context": "400k tokens",
        "max_output": "128k tokens",
        "modalities": ["text", "image_input"],
    },
    "gpt-4o": {
        "name": "GPT-4o",
        "description": "汎用マルチモーダル - 実績のあるモデル",
        "max_context": "128k tokens",
        "max_output": "4k tokens",
        "modalities": ["text", "image_input"],
    },
    "gpt-4o-mini": {
        "name": "GPT-4o mini",
        "description": "省コスト運用 - 軽量タスク向け",
        "max_context": "128k tokens",
        "max_output": "4k tokens",
        "modalities": ["text"],
    },
}


async def validate_openai_api_key(api_key: str) -> bool:
    """Validate OpenAI API key by making a test request.

    Args:
        api_key: The API key to validate

    Returns:
        True if valid, False otherwise
    """
    import openai
    import logging

    # Configure logging to avoid leaking API key in logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)

    try:
        client = openai.OpenAI(
            api_key=api_key,
            timeout=10.0,  # Add timeout to prevent hanging
        )
        # Make a lightweight API call to validate the key
        client.chat.completions.create(
            model="gpt-3.5-turbo",  # Use a lightweight model for validation
            messages=[{"role": "system", "content": "ping"}],  # Minimal input
            max_completion_tokens=1,  # Limit response size
        )
        return True
    except openai.AuthenticationError:
        # Invalid API key
        return False
    except openai.RateLimitError:
        # API key is valid but rate limited - still consider valid
        return True
    except Exception:
        # Network or other errors - consider invalid for safety
        return False


def validate_model_choice(model: str) -> bool:
    """Validate that the selected model is available."""
    return model in AVAILABLE_MODELS


@router.get("/models")
async def get_available_models() -> dict:
    """Get list of available OpenAI models with their specifications."""
    return {"success": True, "models": AVAILABLE_MODELS, "default_model": "gpt-5"}


@router.get("/settings", response_model=UserSettingsResponse)
async def get_user_settings(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> UserSettingsResponse:
    """Get current user's settings."""
    # Get user settings
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).one_or_none()

    if not settings:
        # Return default settings if not found
        from datetime import datetime, UTC

        default_timestamp = datetime.now(UTC)
        return UserSettingsResponse(
            id=UUID("00000000-0000-0000-0000-000000000000"),
            user_id=user_id,
            openai_model="gpt-5",
            ai_features_enabled=False,
            has_api_key=False,
            created_at=default_timestamp,
            updated_at=default_timestamp,
            # Email notification defaults
            email_notifications_enabled=False,
            email_deadline_reminder_hours=24,
            email_overdue_alerts_enabled=True,
            email_daily_digest_enabled=False,
            email_daily_digest_hour=9,
        )

    # Convert to response model
    return UserSettingsResponse(
        id=settings.id,
        user_id=settings.user_id,
        openai_model=settings.openai_model,
        ai_features_enabled=settings.ai_features_enabled,
        has_api_key=bool(settings.openai_api_key_encrypted),
        created_at=settings.created_at,
        updated_at=settings.updated_at,
        # Email notification settings
        email_notifications_enabled=settings.email_notifications_enabled,
        email_deadline_reminder_hours=settings.email_deadline_reminder_hours,
        email_overdue_alerts_enabled=settings.email_overdue_alerts_enabled,
        email_daily_digest_enabled=settings.email_daily_digest_enabled,
        email_daily_digest_hour=settings.email_daily_digest_hour,
    )


@router.post(
    "/settings",
    response_model=UserSettingsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user_settings(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    settings_data: UserSettingsCreate,
    session: Annotated[Session, Depends(get_session)],
) -> UserSettingsResponse:
    """Create or update user settings."""
    # Validate OpenAI model selection
    if not validate_model_choice(settings_data.openai_model):
        available_models = list(AVAILABLE_MODELS.keys())
        raise ValidationError(
            f"Invalid model '{settings_data.openai_model}'. Available models: {', '.join(available_models)}"
        )

    # Validate OpenAI API key
    if not await validate_openai_api_key(settings_data.openai_api_key):
        raise ValidationError("Invalid OpenAI API key")

    # Check if settings already exist
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    existing_settings = session.exec(statement).one_or_none()

    if existing_settings:
        # Update existing settings
        existing_settings.openai_api_key_encrypted = get_crypto_service().encrypt(
            settings_data.openai_api_key
        )
        existing_settings.openai_model = settings_data.openai_model
        existing_settings.ai_features_enabled = True
        session.commit()
        session.refresh(existing_settings)
        settings = existing_settings
    else:
        # Create new settings
        settings = UserSettings(
            user_id=user_id,
            openai_api_key_encrypted=get_crypto_service().encrypt(
                settings_data.openai_api_key
            ),
            openai_model=settings_data.openai_model,
            ai_features_enabled=True,
        )
        session.add(settings)
        session.commit()
        session.refresh(settings)

    return UserSettingsResponse(
        id=settings.id,
        user_id=settings.user_id,
        openai_model=settings.openai_model,
        ai_features_enabled=settings.ai_features_enabled,
        has_api_key=True,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
        # Email notification settings
        email_notifications_enabled=settings.email_notifications_enabled,
        email_deadline_reminder_hours=settings.email_deadline_reminder_hours,
        email_overdue_alerts_enabled=settings.email_overdue_alerts_enabled,
        email_daily_digest_enabled=settings.email_daily_digest_enabled,
        email_daily_digest_hour=settings.email_daily_digest_hour,
    )


@router.put("/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    settings_data: UserSettingsUpdate,
    session: Annotated[Session, Depends(get_session)],
) -> UserSettingsResponse:
    """Update user settings."""
    # Get existing settings
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).one_or_none()

    if not settings:
        raise NotFoundError("User settings not found")

    # Validate model selection if provided
    if settings_data.openai_model is not None:
        if not validate_model_choice(settings_data.openai_model):
            available_models = list(AVAILABLE_MODELS.keys())
            raise ValidationError(
                f"Invalid model '{settings_data.openai_model}'. Available models: {', '.join(available_models)}"
            )

    # Update fields if provided
    if settings_data.openai_api_key is not None:
        # Validate new API key
        if not await validate_openai_api_key(settings_data.openai_api_key):
            raise ValidationError("Invalid OpenAI API key")
        settings.openai_api_key_encrypted = get_crypto_service().encrypt(
            settings_data.openai_api_key
        )
        settings.ai_features_enabled = True

    if settings_data.openai_model is not None:
        settings.openai_model = settings_data.openai_model

    session.commit()
    session.refresh(settings)

    return UserSettingsResponse(
        id=settings.id,
        user_id=settings.user_id,
        openai_model=settings.openai_model,
        ai_features_enabled=settings.ai_features_enabled,
        has_api_key=bool(settings.openai_api_key_encrypted),
        created_at=settings.created_at,
        updated_at=settings.updated_at,
        # Email notification settings
        email_notifications_enabled=settings.email_notifications_enabled,
        email_deadline_reminder_hours=settings.email_deadline_reminder_hours,
        email_overdue_alerts_enabled=settings.email_overdue_alerts_enabled,
        email_daily_digest_enabled=settings.email_daily_digest_enabled,
        email_daily_digest_hour=settings.email_daily_digest_hour,
    )


@router.delete("/settings/openai-key", status_code=status.HTTP_204_NO_CONTENT)
async def delete_openai_key(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Delete user's OpenAI API key."""
    # Get existing settings
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).one_or_none()

    if not settings:
        raise NotFoundError("User settings not found")

    # Remove API key and disable AI features
    settings.openai_api_key_encrypted = None
    settings.ai_features_enabled = False

    session.commit()


@router.put("/settings/email-notifications", response_model=UserSettingsResponse)
async def update_email_notification_settings(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    settings_data: EmailNotificationSettingsUpdate,
    session: Annotated[Session, Depends(get_session)],
) -> UserSettingsResponse:
    """Update email notification settings (Issue #261)."""
    # Get existing settings
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).one_or_none()

    if not settings:
        # Create new settings with default values
        settings = UserSettings(user_id=user_id)
        session.add(settings)

    # Update email notification fields if provided
    if settings_data.email_notifications_enabled is not None:
        settings.email_notifications_enabled = settings_data.email_notifications_enabled

    if settings_data.email_deadline_reminder_hours is not None:
        settings.email_deadline_reminder_hours = settings_data.email_deadline_reminder_hours

    if settings_data.email_overdue_alerts_enabled is not None:
        settings.email_overdue_alerts_enabled = settings_data.email_overdue_alerts_enabled

    if settings_data.email_daily_digest_enabled is not None:
        settings.email_daily_digest_enabled = settings_data.email_daily_digest_enabled

    if settings_data.email_daily_digest_hour is not None:
        settings.email_daily_digest_hour = settings_data.email_daily_digest_hour

    session.commit()
    session.refresh(settings)

    return UserSettingsResponse(
        id=settings.id,
        user_id=settings.user_id,
        openai_model=settings.openai_model,
        ai_features_enabled=settings.ai_features_enabled,
        has_api_key=bool(settings.openai_api_key_encrypted),
        created_at=settings.created_at,
        updated_at=settings.updated_at,
        # Email notification settings
        email_notifications_enabled=settings.email_notifications_enabled,
        email_deadline_reminder_hours=settings.email_deadline_reminder_hours,
        email_overdue_alerts_enabled=settings.email_overdue_alerts_enabled,
        email_daily_digest_enabled=settings.email_daily_digest_enabled,
        email_daily_digest_hour=settings.email_daily_digest_hour,
    )
