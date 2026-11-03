"""
Notification Scheduler using APScheduler (Issue #228, #261)

Manages scheduled notification jobs:
- Checkout reminders: Polls every 30 seconds for WebSocket/Web Push
- Task deadline emails: Polls every 5 minutes for email notifications (Issue #261)
- Daily digest emails: Polls every 10 minutes and sends each user's digest
  once a day after their hour (Asia/Tokyo)
- Agent audit log retention: Runs daily and purges rows older than 90 days

Note: For MVP, we use a polling approach rather than scheduling individual
jobs per session. This is simpler and works well for single-instance deployments.
For multi-instance deployments, consider using a persistent job store (e.g., Redis).
"""

import logging
from datetime import datetime, timedelta, UTC
from uuid import UUID, uuid4

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from humancompiler_api import agent_audit
from humancompiler_api.daily_digest import jst_day_start, run_daily_digest
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
from humancompiler_api.proposal_service import APP_TIMEZONE

logger = logging.getLogger(__name__)

# A task's deadline reminder is retried on later runs after a failed send, at
# most this many times per JST day.
MAX_FAILURES_PER_DAY = 3

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

            # Plain values: commits and rollbacks below expire the ORM objects,
            # and reloading one outside the per-user try could end the run.
            targets = [
                (user.id, user.email, user_settings.email_deadline_reminder_hours)
                for user, user_settings in users_with_settings
            ]

            for user_id, to_email, reminder_hours in targets:
                try:
                    await _process_user_deadline_notifications(
                        session, user_id, to_email, reminder_hours, now, email_service
                    )
                except Exception as e:
                    # Discard this user's failed transaction so the shared
                    # session stays usable for the next user.
                    session.rollback()
                    logger.error(
                        f"Error processing deadline notifications for user {user_id}: {e}"
                    )

    except Exception as e:
        logger.error(f"Error in deadline email check: {e}")


async def send_daily_digest_emails():
    """Send each user's daily digest once a day after their chosen hour."""
    logger.debug("Running daily digest email check...")

    try:
        with Session(db.get_engine()) as session:
            sent_count = run_daily_digest(
                session, datetime.now(UTC), get_email_service()
            )
            if sent_count > 0:
                logger.info("Sent %s daily digest emails", sent_count)
    except Exception:
        logger.exception("Error in daily digest email check")


async def generate_due_triage_suggestions():
    """
    Generate due capacity triage suggestions.

    This job intentionally never applies cancellations. It only creates review
    batches for users who opted into automatic suggestion generation.
    """
    logger.debug("Running capacity triage suggestion check...")

    try:
        from humancompiler_api.triage import triage_service

        with Session(db.get_engine()) as session:
            generated_count = triage_service.generate_due_scheduled_runs(session)
            if generated_count:
                logger.info("Generated %s scheduled triage runs", generated_count)
    except Exception as e:
        logger.error(f"Error in capacity triage suggestion check: {e}")


async def purge_expired_agent_audit_logs():
    """Delete agent audit logs past their retention period."""
    logger.debug("Running agent audit log retention...")

    try:
        with agent_audit.session_factory() as session:
            deleted_count = agent_audit.purge_expired_audit_logs(session)
            if deleted_count:
                logger.info("Purged %s expired agent audit logs", deleted_count)
    except Exception:
        logger.exception("Error in agent audit log retention")


async def _process_user_deadline_notifications(
    session: Session,
    user_id: UUID,
    to_email: str,
    reminder_hours: int,
    now: datetime,
    email_service,
) -> None:
    """Process deadline notifications for a single user"""
    reminder_threshold = now + timedelta(hours=reminder_hours)

    # Get regular tasks with due dates in the reminder window
    tasks_stmt = (
        select(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(
            Project.owner_id == user_id,
            Task.due_date.isnot(None),
            Task.due_date <= reminder_threshold,  # type: ignore[operator]
            Task.due_date > now,  # type: ignore[operator]
            Task.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
        .options(selectinload(Task.goal).selectinload(Goal.project))
    )
    tasks = session.exec(tasks_stmt).all()

    # Get quick tasks with due dates in the reminder window
    quick_tasks_stmt = select(QuickTask).where(
        QuickTask.owner_id == user_id,
        QuickTask.due_date.isnot(None),
        QuickTask.due_date <= reminder_threshold,  # type: ignore[operator]
        QuickTask.due_date > now,  # type: ignore[operator]
        QuickTask.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
    )
    quick_tasks = session.exec(quick_tasks_stmt).all()

    # Send deadline reminder emails
    for task in tasks:
        await _send_task_deadline_email(
            session, user_id, to_email, task, now, email_service, is_quick_task=False
        )

    for quick_task in quick_tasks:
        await _send_task_deadline_email(
            session,
            user_id,
            to_email,
            quick_task,
            now,
            email_service,
            is_quick_task=True,
        )


def _handled_today(
    session: Session,
    user_id: UUID,
    task_id: UUID,
    is_quick_task: bool,
    notification_type: EmailNotificationType,
    today_start: datetime,
) -> bool:
    """True when today's logs for this task hold a sent or pending email, or
    ``MAX_FAILURES_PER_DAY`` failed ones.

    A ``pending`` row is a reservation made before sending. One left behind by
    a failed update or a crash blocks the rest of the day: missing one email is
    acceptable, mailing the user on every run is not.
    """
    task_match = (
        EmailNotificationLog.quick_task_id == task_id
        if is_quick_task
        else EmailNotificationLog.task_id == task_id
    )
    rows = session.exec(
        select(EmailNotificationLog.status, func.count())
        .where(
            EmailNotificationLog.user_id == user_id,
            task_match,
            EmailNotificationLog.notification_type == notification_type,
            col(EmailNotificationLog.created_at) >= today_start,
        )
        .group_by(EmailNotificationLog.status)
    ).all()
    counts = {status: count for status, count in rows}
    return (
        counts.get(EmailNotificationStatus.SENT, 0) > 0
        or counts.get(EmailNotificationStatus.PENDING, 0) > 0
        or counts.get(EmailNotificationStatus.FAILED, 0) >= MAX_FAILURES_PER_DAY
    )


def _reserve_log(
    session: Session,
    user_id: UUID,
    task_id: UUID,
    is_quick_task: bool,
    notification_type: EmailNotificationType,
    now: datetime,
) -> EmailNotificationLog:
    """Commit a ``pending`` log row for this task before its email is sent."""
    log_entry = EmailNotificationLog(
        id=uuid4(),
        user_id=user_id,
        task_id=None if is_quick_task else task_id,
        quick_task_id=task_id if is_quick_task else None,
        notification_type=notification_type,
        status=EmailNotificationStatus.PENDING,
        sent_at=None,
        error_message=None,
        created_at=now,
    )
    session.add(log_entry)
    session.commit()
    return log_entry


def _record_outcome(
    session: Session, log_entry: EmailNotificationLog, success: bool, now: datetime
) -> None:
    """Mark a reserved log row ``sent`` or ``failed`` and commit."""
    if success:
        log_entry.status = EmailNotificationStatus.SENT
        log_entry.sent_at = now
    else:
        log_entry.status = EmailNotificationStatus.FAILED
        log_entry.error_message = "Failed to send email"
    session.add(log_entry)
    session.commit()


async def _send_task_deadline_email(
    session: Session,
    user_id: UUID,
    to_email: str,
    task: Task | QuickTask,
    now: datetime,
    email_service,
    is_quick_task: bool,
) -> None:
    """Send a deadline reminder email for a task if not already sent"""
    # Guard: ensure due_date is not None (should be filtered by query, but for type safety)
    if task.due_date is None:
        return

    task_id = task.id
    notification_type = EmailNotificationType.DEADLINE_REMINDER

    # Skip a task already sent, being sent, or failing too often today. The
    # day is the JST day, as promised on the settings page; the Resend
    # idempotency key uses the same date.
    today_start = jst_day_start(now)
    reminder_date = today_start.astimezone(APP_TIMEZONE).date()
    if _handled_today(
        session, user_id, task_id, is_quick_task, notification_type, today_start
    ):
        logger.debug(f"Already handled deadline reminder for task {task_id} today")
        return

    # Calculate hours until due (due_date is guaranteed non-None by guard clause)
    hours_until_due = int((task.due_date - now).total_seconds() / 3600)

    # Get context info
    project_title = None
    goal_title = None
    if not is_quick_task and hasattr(task, "goal") and task.goal:
        goal_title = task.goal.title
        if task.goal.project:
            project_title = task.goal.project.title

    # Plain values: the commits below expire the ORM objects.
    task_title = task.title
    due_date = task.due_date

    # Reserve today's row before sending (see _handled_today).
    log_entry = _reserve_log(
        session, user_id, task_id, is_quick_task, notification_type, now
    )

    success = email_service.send_deadline_reminder(
        to_email=to_email,
        task_title=task_title,
        task_id=task_id,
        due_date=due_date,
        hours_until_due=hours_until_due,
        project_title=project_title,
        goal_title=goal_title,
        reminder_date=reminder_date,
    )

    _record_outcome(session, log_entry, success, now)

    if success:
        logger.info(f"Sent deadline reminder for task {task_id} to user {user_id}")
    else:
        logger.warning(f"Failed to send deadline reminder for task {task_id}")


def start_notification_scheduler() -> bool:
    """Start the notification scheduler. Returns whether it is running."""
    if not settings.notification_scheduler_enabled:
        logger.info(
            "Notification scheduler disabled (NOTIFICATION_SCHEDULER_ENABLED=false)"
        )
        return False

    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("Notification scheduler is already running")
        return True

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

    # Poll every 10 minutes; run_daily_digest sends each user's digest once a
    # day, on the first run after their hour.
    scheduler.add_job(
        send_daily_digest_emails,
        "interval",
        minutes=10,
        id="daily_digest_email",
        name="Send daily digest emails",
        replace_existing=True,
    )

    # Add capacity triage suggestion generation to run hourly. This only creates
    # review runs; it never applies cancellation decisions automatically.
    scheduler.add_job(
        generate_due_triage_suggestions,
        "interval",
        hours=1,
        id="capacity_triage_suggestion_check",
        name="Generate due capacity triage suggestions",
        replace_existing=True,
    )

    # Purge agent audit logs past their 90-day retention once a day. The job
    # store is in memory, so every deploy resets the interval; run the first
    # purge shortly after boot (but outside startup) so frequent deploys cannot
    # starve it. APScheduler's 1s default misfire grace would drop a late run.
    scheduler.add_job(
        purge_expired_agent_audit_logs,
        "interval",
        days=1,
        next_run_time=datetime.now(UTC) + timedelta(minutes=1),
        misfire_grace_time=3600,
        id="agent_audit_log_retention",
        name="Purge expired agent audit logs",
        replace_existing=True,
    )

    scheduler.start()
    logger.info(
        "Notification scheduler started "
        "(checkout notifications: 30s, deadline emails: 5min, daily digest: 10min, "
        "triage suggestions: 1h, agent audit log retention: 1d)"
    )
    return True


def stop_notification_scheduler() -> bool:
    """Stop the notification scheduler. Returns whether it was running."""
    scheduler = get_scheduler()

    if not scheduler.running:
        return False

    scheduler.shutdown(wait=False)
    logger.info("Notification scheduler stopped")
    return True


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
