"""User settings API routes."""

from typing import Annotated
from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlmodel import Session, select

from taskagent_api.auth import get_current_user_id
from taskagent_api.crypto import get_crypto_service
from taskagent_api.database import get_session
from taskagent_api.exceptions import NotFoundError, ValidationError
from taskagent_api.models import (
    UserSettings,
    UserSettingsCreate,
    UserSettingsResponse,
    UserSettingsUpdate,
    User,
    ApiUsageLog,
)

router = APIRouter(prefix="/api/user", tags=["user-settings"])


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


@router.get("/usage")
async def get_api_usage(
    user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """Get user's API usage statistics."""
    # Query aggregated usage data
    statement = select(
        func.sum(ApiUsageLog.tokens_used).label("total_tokens"),
        func.sum(ApiUsageLog.cost_usd).label("total_cost"),
        func.count(ApiUsageLog.id).label("request_count"),
    ).where(ApiUsageLog.user_id == user_id)

    result = session.exec(statement)
    row = result.one()

    return {
        "total_tokens": int(row.total_tokens or 0),
        "total_cost": float(row.total_cost or 0),
        "request_count": int(row.request_count or 0),
    }
