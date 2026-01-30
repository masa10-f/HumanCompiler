"""
Notification Scheduler using APScheduler (Issue #228, #261)

Manages scheduled notification jobs:
- Checkout reminders: Polls every 30 seconds for WebSocket/Web Push
- Task deadline emails: Polls every 5 minutes for email notifications (Issue #261)
- Daily digest emails: Runs daily at configured hour (Issue #261)

Note: For MVP, we use a polling approach rather than scheduling individual
jobs per session. This is simpler and works well for single-instance deployments.
For multi-instance deployments, consider using a persistent job store (e.g., Redis).
"""

import logging
from datetime import datetime, timedelta, UTC

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from humancompiler_api.database import db
from humancompiler_api.notification_service import (
    NotificationService,
    UNRESPONSIVE_THRESHOLD_MINUTES,
)
from humancompiler_api.models import (
    NotificationLevel,
    Task,
    QuickTask,
    User,
    UserSettings,
    EmailNotificationLog,
    EmailNotificationType,
    EmailNotificationStatus,
    TaskStatus,
    Goal,
    Project,
)
from humancompiler_api.email_service import get_email_service
from humancompiler_api.config import settings

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
                    task_title = work_session.task.title if work_session.task else None

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


async def check_and_send_deadline_emails():
    """
    Check tasks with upcoming deadlines and send email notifications.
    This runs every 5 minutes to check for tasks needing deadline reminders.
    (Issue #261)
    """
    logger.debug("Running deadline email check...")

    # Skip if email notifications are globally disabled
    if not settings.email_notifications_enabled:
        logger.debug("Email notifications are globally disabled")
        return

    email_service = get_email_service()
    if not email_service.is_enabled:
        logger.debug("Email service is not enabled")
        return

    try:
        with Session(db.get_engine()) as session:
            now = datetime.now(UTC)

            # Get all users with email notifications enabled
            users_stmt = (
                select(User, UserSettings)
                .join(UserSettings, User.id == UserSettings.user_id)
                .where(UserSettings.email_notifications_enabled == True)  # noqa: E712
            )
            users_with_settings = session.exec(users_stmt).all()

            if not users_with_settings:
                logger.debug("No users have email notifications enabled")
                return

            for user, user_settings in users_with_settings:
                try:
                    await _process_user_deadline_notifications(
                        session, user, user_settings, now, email_service
                    )
                except Exception as e:
                    logger.error(
                        f"Error processing deadline notifications for user {user.id}: {e}"
                    )

    except Exception as e:
        logger.error(f"Error in deadline email check: {e}")


async def _process_user_deadline_notifications(
    session: Session,
    user: User,
    user_settings: UserSettings,
    now: datetime,
    email_service,
) -> None:
    """Process deadline notifications for a single user"""
    reminder_hours = user_settings.email_deadline_reminder_hours
    reminder_threshold = now + timedelta(hours=reminder_hours)

    # Get regular tasks with due dates in the reminder window
    tasks_stmt = (
        select(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == user.id,
            Task.due_date.isnot(None),
            Task.due_date <= reminder_threshold,
            Task.due_date > now,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
        .options(selectinload(Task.goal).selectinload(Goal.project))
    )
    tasks = session.exec(tasks_stmt).all()

    # Get quick tasks with due dates in the reminder window
    quick_tasks_stmt = select(QuickTask).where(
        QuickTask.owner_id == user.id,
        QuickTask.due_date.isnot(None),
        QuickTask.due_date <= reminder_threshold,
        QuickTask.due_date > now,
        QuickTask.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
    )
    quick_tasks = session.exec(quick_tasks_stmt).all()

    # Send deadline reminder emails
    for task in tasks:
        await _send_task_deadline_email(
            session, user, task, now, email_service, is_quick_task=False
        )

    for quick_task in quick_tasks:
        await _send_task_deadline_email(
            session, user, quick_task, now, email_service, is_quick_task=True
        )

    # Check for overdue tasks if enabled
    if user_settings.email_overdue_alerts_enabled:
        await _process_overdue_notifications(session, user, now, email_service)


async def _send_task_deadline_email(
    session: Session,
    user: User,
    task: Task | QuickTask,
    now: datetime,
    email_service,
    is_quick_task: bool,
) -> None:
    """Send a deadline reminder email for a task if not already sent"""
    task_id = task.id
    notification_type = EmailNotificationType.DEADLINE_REMINDER

    # Check if we already sent a notification for this task today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    existing_log_stmt = select(EmailNotificationLog).where(
        EmailNotificationLog.user_id == user.id,
        (
            EmailNotificationLog.quick_task_id == task_id
            if is_quick_task
            else EmailNotificationLog.task_id == task_id
        ),
        EmailNotificationLog.notification_type == notification_type,
        EmailNotificationLog.created_at >= today_start,
        EmailNotificationLog.status == EmailNotificationStatus.SENT,
    )
    existing_log = session.exec(existing_log_stmt).first()

    if existing_log:
        logger.debug(f"Already sent deadline reminder for task {task_id} today")
        return

    # Calculate hours until due
    hours_until_due = int((task.due_date - now).total_seconds() / 3600)

    # Get context info
    project_title = None
    goal_title = None
    if not is_quick_task and hasattr(task, "goal") and task.goal:
        goal_title = task.goal.title
        if task.goal.project:
            project_title = task.goal.project.title

    # Send email
    success = email_service.send_deadline_reminder(
        to_email=user.email,
        task_title=task.title,
        task_id=task_id,
        due_date=task.due_date,
        hours_until_due=hours_until_due,
        project_title=project_title,
        goal_title=goal_title,
    )

    # Log the notification
    log_entry = EmailNotificationLog(
        user_id=user.id,
        task_id=None if is_quick_task else task_id,
        quick_task_id=task_id if is_quick_task else None,
        notification_type=notification_type,
        status=EmailNotificationStatus.SENT if success else EmailNotificationStatus.FAILED,
        sent_at=now if success else None,
        error_message=None if success else "Failed to send email",
    )
    session.add(log_entry)
    session.commit()

    if success:
        logger.info(f"Sent deadline reminder for task {task_id} to {user.email}")


async def _process_overdue_notifications(
    session: Session,
    user: User,
    now: datetime,
    email_service,
) -> None:
    """Process overdue task notifications for a user"""
    # Get overdue regular tasks
    overdue_tasks_stmt = (
        select(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == user.id,
            Task.due_date.isnot(None),
            Task.due_date < now,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
        .options(selectinload(Task.goal).selectinload(Goal.project))
    )
    overdue_tasks = session.exec(overdue_tasks_stmt).all()

    # Get overdue quick tasks
    overdue_quick_tasks_stmt = select(QuickTask).where(
        QuickTask.owner_id == user.id,
        QuickTask.due_date.isnot(None),
        QuickTask.due_date < now,
        QuickTask.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
    )
    overdue_quick_tasks = session.exec(overdue_quick_tasks_stmt).all()

    for task in overdue_tasks:
        await _send_overdue_email(session, user, task, now, email_service, is_quick_task=False)

    for quick_task in overdue_quick_tasks:
        await _send_overdue_email(session, user, quick_task, now, email_service, is_quick_task=True)


async def _send_overdue_email(
    session: Session,
    user: User,
    task: Task | QuickTask,
    now: datetime,
    email_service,
    is_quick_task: bool,
) -> None:
    """Send an overdue alert email for a task if not already sent"""
    task_id = task.id
    notification_type = EmailNotificationType.OVERDUE_ALERT

    # Check if we already sent an overdue notification for this task today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    existing_log_stmt = select(EmailNotificationLog).where(
        EmailNotificationLog.user_id == user.id,
        (
            EmailNotificationLog.quick_task_id == task_id
            if is_quick_task
            else EmailNotificationLog.task_id == task_id
        ),
        EmailNotificationLog.notification_type == notification_type,
        EmailNotificationLog.created_at >= today_start,
        EmailNotificationLog.status == EmailNotificationStatus.SENT,
    )
    existing_log = session.exec(existing_log_stmt).first()

    if existing_log:
        logger.debug(f"Already sent overdue alert for task {task_id} today")
        return

    # Calculate hours overdue
    hours_overdue = int((now - task.due_date).total_seconds() / 3600)

    # Get context info
    project_title = None
    goal_title = None
    if not is_quick_task and hasattr(task, "goal") and task.goal:
        goal_title = task.goal.title
        if task.goal.project:
            project_title = task.goal.project.title

    # Send email
    success = email_service.send_overdue_alert(
        to_email=user.email,
        task_title=task.title,
        task_id=task_id,
        due_date=task.due_date,
        hours_overdue=hours_overdue,
        project_title=project_title,
        goal_title=goal_title,
    )

    # Log the notification
    log_entry = EmailNotificationLog(
        user_id=user.id,
        task_id=None if is_quick_task else task_id,
        quick_task_id=task_id if is_quick_task else None,
        notification_type=notification_type,
        status=EmailNotificationStatus.SENT if success else EmailNotificationStatus.FAILED,
        sent_at=now if success else None,
        error_message=None if success else "Failed to send email",
    )
    session.add(log_entry)
    session.commit()

    if success:
        logger.info(f"Sent overdue alert for task {task_id} to {user.email}")


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

    # Add the deadline email check job to run every 5 minutes (Issue #261)
    scheduler.add_job(
        check_and_send_deadline_emails,
        "interval",
        minutes=5,
        id="deadline_email_check",
        name="Check and send deadline email notifications",
        replace_existing=True,
    )

    scheduler.start()
    logger.info(
        "Notification scheduler started "
        "(checkout notifications: 30s, deadline emails: 5min)"
    )


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
        return {"status": "stopped", "jobs": []}

    job_info = [
        {
            "id": job.id,
            "name": job.name,
            "next_run_time": job.next_run_time.isoformat()
            if job.next_run_time
            else None,
        }
        for job in scheduler.get_jobs()
    ]

    return {"status": "running", "jobs": job_info}
