"""
Notification Scheduler using APScheduler (Issue #228)

Manages scheduled notification jobs for checkout reminders:
- Polls for sessions needing notifications every 30 seconds
- Sends notifications via WebSocket and Web Push
- Marks sessions as unresponsive when threshold is exceeded

Note: For MVP, we use a polling approach rather than scheduling individual
jobs per session. This is simpler and works well for single-instance deployments.
For multi-instance deployments, consider using a persistent job store (e.g., Redis).
"""

import asyncio
import logging
from datetime import datetime, timedelta, UTC

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from sqlmodel import Session

from humancompiler_api.database import db
from humancompiler_api.notification_service import (
    NotificationService,
    UNRESPONSIVE_THRESHOLD_MINUTES,
)
from humancompiler_api.models import NotificationLevel

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    """Get or create the notification scheduler instance"""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(
            jobstores={"default": MemoryJobStore()},
            job_defaults={
                "coalesce": True,  # Combine missed runs into one
                "max_instances": 1,  # Only one instance of each job at a time
            },
        )
    return _scheduler


async def check_and_send_notifications():
    """
    Check all active sessions and send notifications as needed.
    This runs every 30 seconds to catch sessions needing notifications.
    """
    logger.debug("Running notification check...")

    try:
        with Session(db.get_engine()) as session:
            notification_service = NotificationService(session)

            # Get sessions needing notifications
            sessions_to_notify = (
                notification_service.get_sessions_needing_notification()
            )

            if not sessions_to_notify:
                logger.debug("No sessions need notifications")
                return

            logger.info(
                f"Found {len(sessions_to_notify)} sessions needing notifications"
            )

            for work_session, level in sessions_to_notify:
                try:
                    # Get task title for notification message
                    task_title = None
                    if work_session.task:
                        task_title = work_session.task.title

                    # Send notification
                    await notification_service.send_notification(
                        user_id=work_session.user_id,
                        session_id=str(work_session.id),
                        level=level,
                        task_title=task_title,
                    )

                    # Mark as unresponsive if overdue past threshold
                    if level == NotificationLevel.OVERDUE:
                        now = datetime.now(UTC)
                        overdue_threshold = (
                            work_session.planned_checkout_at
                            + timedelta(minutes=UNRESPONSIVE_THRESHOLD_MINUTES)
                        )
                        if (
                            now >= overdue_threshold
                            and not work_session.marked_unresponsive_at
                        ):
                            notification_service.mark_session_unresponsive(
                                work_session.id
                            )
                            logger.info(
                                f"Session {work_session.id} marked as unresponsive"
                            )

                except Exception as e:
                    logger.error(
                        f"Error sending notification for session {work_session.id}: {e}"
                    )

    except Exception as e:
        logger.error(f"Error in notification check: {e}")


def start_notification_scheduler():
    """Start the notification scheduler"""
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("Notification scheduler is already running")
        return

    # Add the notification check job to run every 30 seconds
    scheduler.add_job(
        check_and_send_notifications,
        "interval",
        seconds=30,
        id="notification_check",
        name="Check and send checkout notifications",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Notification scheduler started (checking every 30 seconds)")


def stop_notification_scheduler():
    """Stop the notification scheduler"""
    scheduler = get_scheduler()

    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Notification scheduler stopped")


def is_scheduler_running() -> bool:
    """Check if the scheduler is running"""
    scheduler = get_scheduler()
    return scheduler.running


def get_scheduler_status() -> dict:
    """Get scheduler status information"""
    scheduler = get_scheduler()

    if not scheduler.running:
        return {
            "status": "stopped",
            "jobs": [],
        }

    jobs = scheduler.get_jobs()
    job_info = []
    for job in jobs:
        job_info.append(
            {
                "id": job.id,
                "name": job.name,
                "next_run_time": job.next_run_time.isoformat()
                if job.next_run_time
                else None,
            }
        )

    return {
        "status": "running",
        "jobs": job_info,
    }
