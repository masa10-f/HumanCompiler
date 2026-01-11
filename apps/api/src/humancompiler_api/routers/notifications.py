"""
Notifications Router for Push Subscription Management (Issue #228)

Provides endpoints for managing Web Push subscriptions:
- Register a new push subscription
- Unregister (deactivate) a push subscription
- List active subscriptions
"""

from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    PushSubscriptionCreate,
    PushSubscriptionResponse,
)
from humancompiler_api.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/push-subscription",
    response_model=PushSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register push subscription",
    description="Register a new Web Push subscription for the authenticated user. If a subscription with the same endpoint already exists, it will be updated.",
)
async def register_push_subscription(
    subscription_data: PushSubscriptionCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> PushSubscriptionResponse:
    """Register or update a push subscription"""
    notification_service = NotificationService(session)

    subscription = notification_service.register_push_subscription(
        user_id=current_user.user_id,
        endpoint=subscription_data.endpoint,
        p256dh_key=subscription_data.keys["p256dh"],
        auth_key=subscription_data.keys["auth"],
        user_agent=subscription_data.user_agent,
        device_type=subscription_data.device_type.value
        if subscription_data.device_type
        else None,
    )

    return PushSubscriptionResponse.model_validate(subscription)


@router.delete(
    "/push-subscription",
    status_code=status.HTTP_200_OK,
    responses={
        404: {"model": ErrorResponse, "description": "Subscription not found"},
    },
    summary="Unregister push subscription",
    description="Unregister (deactivate) a Web Push subscription by its endpoint.",
)
async def unregister_push_subscription(
    endpoint: Annotated[
        str, Query(description="The push subscription endpoint to unregister")
    ],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    """Unregister a push subscription"""
    notification_service = NotificationService(session)

    success = notification_service.unregister_push_subscription(
        user_id=current_user.user_id,
        endpoint=endpoint,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found",
        )

    return {"status": "unsubscribed", "endpoint": endpoint}


@router.get(
    "/push-subscriptions",
    response_model=list[PushSubscriptionResponse],
    summary="List push subscriptions",
    description="Get all active push subscriptions for the authenticated user.",
)
async def list_push_subscriptions(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[PushSubscriptionResponse]:
    """List all active push subscriptions for the user"""
    notification_service = NotificationService(session)

    subscriptions = notification_service.get_user_subscriptions(current_user.user_id)

    return [PushSubscriptionResponse.model_validate(s) for s in subscriptions]
