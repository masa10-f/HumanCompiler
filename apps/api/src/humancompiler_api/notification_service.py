"""
Notification service for checkout escalation (Issue #228)

Handles:
- Scheduling notification jobs via APScheduler
- Sending WebSocket notifications to connected clients
- Sending Web Push notifications for background/offline users
- Managing snooze state and limits
- Detecting and marking unresponsive sessions
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, UTC
from uuid import UUID, uuid4

from fastapi import WebSocket
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from humancompiler_api.models import (
    NotificationLevel,
    NotificationMessage,
    PushSubscription,
    WorkSession,
)

logger = logging.getLogger(__name__)

# Constants
MAX_SNOOZE_COUNT = 2
SNOOZE_DURATION_MINUTES = 5
UNRESPONSIVE_THRESHOLD_MINUTES = 10


class WebSocketConnectionManager:
    """Manages WebSocket connections for real-time notifications"""

    def __init__(self):
        # user_id -> list of WebSocket connections
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        """Accept and register a WebSocket connection for a user"""
        await websocket.accept()
        self.active_connections[user_id].append(websocket)
        logger.info(f"WebSocket connected for user {user_id}")

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        """Remove a WebSocket connection for a user"""
        if websocket in self.active_connections[user_id]:
            self.active_connections[user_id].remove(websocket)
            logger.info(f"WebSocket disconnected for user {user_id}")

    def get_connection_count(self, user_id: str) -> int:
        """Get the number of active connections for a user"""
        return len(self.active_connections.get(user_id, []))

    async def send_to_user(self, user_id: str, message: dict) -> int:
        """
        Send a message to all connections for a user.
        Returns the number of successful sends.
        """
        connections = self.active_connections.get(user_id, [])
        if not connections:
            return 0

        dead_connections = []
        successful_sends = 0

        for connection in connections:
            try:
                await connection.send_json(message)
                successful_sends += 1
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                dead_connections.append(connection)

        # Clean up dead connections
        for conn in dead_connections:
            self.disconnect(conn, user_id)

        return successful_sends

    async def broadcast(self, message: dict) -> int:
        """Broadcast a message to all connected users. Returns total successful sends."""
        total_sends = 0
        for user_id in list(self.active_connections.keys()):
            total_sends += await self.send_to_user(user_id, message)
        return total_sends


# Global connection manager instance
connection_manager = WebSocketConnectionManager()


class NotificationService:
    """Service for managing checkout notifications and escalation"""

    def __init__(self, db_session: Session):
        self.session = db_session

    def create_notification_message(
        self,
        session_id: str,
        level: NotificationLevel,
        task_title: str | None = None,
    ) -> NotificationMessage:
        """Create a notification message for a checkout reminder"""
        titles = {
            NotificationLevel.LIGHT: "チェックアウト5分前",
            NotificationLevel.STRONG: "チェックアウト時刻です",
            NotificationLevel.OVERDUE: "セッション超過中",
        }

        bodies = {
            NotificationLevel.LIGHT: f"まもなくチェックアウト時刻です。{task_title or 'タスク'}の作業を確認してください。",
            NotificationLevel.STRONG: f"チェックアウト時刻になりました。{task_title or 'タスク'}の振り返りを行ってください。",
            NotificationLevel.OVERDUE: "予定時刻を超過しています。すぐにチェックアウトを完了してください。",
        }

        return NotificationMessage(
            id=str(uuid4()),
            type="notification",
            level=level,
            title=titles[level],
            body=bodies[level],
            session_id=session_id,
            action_url="/runner",
        )

    async def send_notification(
        self,
        user_id: UUID,
        session_id: str,
        level: NotificationLevel,
        task_title: str | None = None,
    ) -> dict:
        """
        Send notification via WebSocket and optionally Web Push.
        Returns status of notification delivery.
        """
        result = {
            "websocket_sent": 0,
            "push_sent": 0,
            "level": level.value,
        }

        # Create notification message
        message = self.create_notification_message(session_id, level, task_title)
        message_dict = message.model_dump()
        message_dict["level"] = message_dict["level"].value  # Convert enum to string

        # 1. Send via WebSocket (if connected)
        result["websocket_sent"] = await connection_manager.send_to_user(
            str(user_id), message_dict
        )

        # 2. If no WebSocket connections or strong/overdue notification, also send Web Push
        if result["websocket_sent"] == 0 or level in [
            NotificationLevel.STRONG,
            NotificationLevel.OVERDUE,
        ]:
            result["push_sent"] = await self._send_push_notifications(
                user_id, message_dict
            )

        # 3. Update notification flags in the session
        await self._update_notification_flags(session_id, level)

        logger.info(
            f"Notification sent for session {session_id}: "
            f"WebSocket={result['websocket_sent']}, Push={result['push_sent']}"
        )

        return result

    async def _send_push_notifications(self, user_id: UUID, message: dict) -> int:
        """Send Web Push notifications to all active subscriptions for a user"""
        # Get active push subscriptions
        subscriptions = self.session.exec(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.is_active.is_(True),
            )
        ).all()

        if not subscriptions:
            return 0

        successful_sends = 0

        # Prepare push payload
        push_payload = {
            "title": message.get("title", "チェックアウト通知"),
            "body": message.get("body", ""),
            "level": message.get("level", "light"),
            "session_id": message.get("session_id", ""),
            "action_url": message.get("action_url", "/runner"),
        }

        for subscription in subscriptions:
            try:
                # Web Push sending would go here
                # For MVP, we'll just mark the attempt
                # In production, use pywebpush:
                #
                # from pywebpush import webpush
                # webpush(
                #     subscription_info={
                #         "endpoint": subscription.endpoint,
                #         "keys": {
                #             "p256dh": subscription.p256dh_key,
                #             "auth": subscription.auth_key,
                #         }
                #     },
                #     data=json.dumps(push_payload),
                #     vapid_private_key=settings.vapid_private_key,
                #     vapid_claims={"sub": settings.vapid_email}
                # )

                # For now, just log the attempt
                logger.info(
                    f"Would send push notification to endpoint: {subscription.endpoint[:50]}..."
                )

                # Update subscription success tracking
                subscription.last_successful_push = datetime.now(UTC)
                subscription.failure_count = 0
                self.session.add(subscription)
                successful_sends += 1

            except Exception as e:
                logger.error(f"Failed to send push notification: {e}")
                subscription.failure_count += 1
                if subscription.failure_count >= 3:
                    subscription.is_active = False
                    logger.warning(
                        f"Deactivated subscription due to repeated failures: {subscription.id}"
                    )
                self.session.add(subscription)

        self.session.commit()
        return successful_sends

    async def _update_notification_flags(
        self, session_id: str, level: NotificationLevel
    ) -> None:
        """Update notification sent flags on the work session"""
        work_session = self.session.get(WorkSession, UUID(session_id))
        if not work_session:
            return

        # Map notification level to corresponding flag attribute
        flag_mapping = {
            NotificationLevel.LIGHT: "notification_5min_sent",
            NotificationLevel.STRONG: "notification_checkout_sent",
            NotificationLevel.OVERDUE: "notification_overdue_sent",
        }
        setattr(work_session, flag_mapping[level], True)

        work_session.updated_at = datetime.now(UTC)
        self.session.add(work_session)
        self.session.commit()

    def snooze_session(
        self,
        user_id: UUID,
        snooze_minutes: int = SNOOZE_DURATION_MINUTES,
    ) -> WorkSession:
        """
        Snooze the current session's checkout time.

        Raises ValueError if:
        - No active session found
        - Maximum snooze count reached
        - Session is already overdue (marked unresponsive)
        """
        # Get current active session
        work_session = self.session.exec(
            select(WorkSession).where(
                WorkSession.user_id == user_id,
                WorkSession.ended_at == None,  # noqa: E711
            )
        ).first()

        if not work_session:
            raise ValueError("No active session found")

        if work_session.marked_unresponsive_at is not None:
            raise ValueError("Cannot snooze an unresponsive session")

        if work_session.snooze_count >= MAX_SNOOZE_COUNT:
            raise ValueError(f"Maximum snooze count ({MAX_SNOOZE_COUNT}) reached")

        # Extend planned_checkout_at
        new_checkout = work_session.planned_checkout_at + timedelta(
            minutes=snooze_minutes
        )
        work_session.planned_checkout_at = new_checkout
        work_session.snooze_count += 1
        work_session.last_snooze_at = datetime.now(UTC)
        work_session.updated_at = datetime.now(UTC)

        # Reset notification flags since checkout time changed
        work_session.notification_5min_sent = False
        work_session.notification_checkout_sent = False
        work_session.notification_overdue_sent = False

        self.session.add(work_session)
        self.session.commit()
        self.session.refresh(work_session)

        logger.info(
            f"Session {work_session.id} snoozed. "
            f"New checkout: {new_checkout}, Snooze count: {work_session.snooze_count}"
        )

        return work_session

    def mark_session_unresponsive(self, session_id: UUID) -> WorkSession | None:
        """Mark a session as unresponsive after exceeding the threshold"""
        work_session = self.session.get(WorkSession, session_id)
        if not work_session:
            return None

        if work_session.ended_at is not None:
            return None  # Session already ended

        if work_session.marked_unresponsive_at is not None:
            return work_session  # Already marked

        work_session.marked_unresponsive_at = datetime.now(UTC)
        work_session.updated_at = datetime.now(UTC)

        self.session.add(work_session)
        self.session.commit()
        self.session.refresh(work_session)

        logger.info(f"Session {session_id} marked as unresponsive")

        return work_session

    def get_unresponsive_session(self, user_id: UUID) -> WorkSession | None:
        """Get any unresponsive session for a user that needs checkout"""
        return self.session.exec(
            select(WorkSession).where(
                WorkSession.user_id == user_id,
                WorkSession.ended_at == None,  # noqa: E711
                WorkSession.marked_unresponsive_at != None,  # noqa: E711
            )
        ).first()

    def get_sessions_needing_notification(
        self,
    ) -> list[tuple[WorkSession, NotificationLevel]]:
        """
        Get all active sessions that need notifications.
        Used by the scheduler to check for pending notifications.
        """
        now = datetime.now(UTC)
        five_min_from_now = now + timedelta(minutes=5)
        overdue_threshold = now - timedelta(minutes=UNRESPONSIVE_THRESHOLD_MINUTES)

        results = []

        # Get all active sessions with task eager loaded (fixes N+1 query issue)
        active_sessions = self.session.exec(
            select(WorkSession)
            .where(WorkSession.ended_at == None)  # noqa: E711
            .options(selectinload(WorkSession.task))
        ).all()

        for session in active_sessions:
            checkout_time = session.planned_checkout_at

            # Check for unresponsive (10+ min overdue) - send OVERDUE and mark session
            if checkout_time <= overdue_threshold:
                if not session.notification_overdue_sent:
                    results.append((session, NotificationLevel.OVERDUE))
                continue

            # Check for checkout time notification (STRONG)
            # If checkout time has passed, prioritize STRONG over LIGHT
            if checkout_time <= now and not session.notification_checkout_sent:
                results.append((session, NotificationLevel.STRONG))
                continue

            # Check for 5-min warning (only if checkout time hasn't passed yet)
            if (
                checkout_time <= five_min_from_now
                and checkout_time > now
                and not session.notification_5min_sent
            ):
                results.append((session, NotificationLevel.LIGHT))

        return results

    # Push Subscription Management
    def register_push_subscription(
        self,
        user_id: UUID,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
        user_agent: str | None = None,
        device_type: str | None = None,
    ) -> PushSubscription:
        """Register or update a push subscription for a user"""
        # Check for existing subscription with same endpoint
        existing = self.session.exec(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.endpoint == endpoint,
            )
        ).first()

        if existing:
            # Update existing
            existing.p256dh_key = p256dh_key
            existing.auth_key = auth_key
            existing.user_agent = user_agent
            existing.device_type = device_type
            existing.is_active = True
            existing.failure_count = 0
            existing.updated_at = datetime.now(UTC)
            self.session.add(existing)
            self.session.commit()
            self.session.refresh(existing)
            return existing

        # Create new subscription
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
            user_agent=user_agent,
            device_type=device_type,
        )
        self.session.add(subscription)
        self.session.commit()
        self.session.refresh(subscription)

        logger.info(f"Registered push subscription for user {user_id}")
        return subscription

    def unregister_push_subscription(self, user_id: UUID, endpoint: str) -> bool:
        """Unregister (deactivate) a push subscription"""
        subscription = self.session.exec(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.endpoint == endpoint,
            )
        ).first()

        if subscription:
            subscription.is_active = False
            subscription.updated_at = datetime.now(UTC)
            self.session.add(subscription)
            self.session.commit()
            logger.info(f"Unregistered push subscription for user {user_id}")
            return True

        return False

    def get_user_subscriptions(self, user_id: UUID) -> list[PushSubscription]:
        """Get all active push subscriptions for a user"""
        return list(
            self.session.exec(
                select(PushSubscription).where(
                    PushSubscription.user_id == user_id,
                    PushSubscription.is_active.is_(True),
                )
            ).all()
        )
