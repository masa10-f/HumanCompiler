"""
Email notification service using Resend (Issue #261)

Handles:
- Sending task deadline reminder emails
- Daily digest emails for upcoming tasks
- Email notification logging and tracking
"""

import logging
from datetime import datetime, UTC
from uuid import UUID

import resend

from humancompiler_api.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending email notifications via Resend"""

    def __init__(self):
        """Initialize the email service with Resend API key"""
        if settings.resend_api_key:
            resend.api_key = settings.resend_api_key
        self._enabled = bool(
            settings.resend_api_key and settings.email_notifications_enabled
        )

    @property
    def is_enabled(self) -> bool:
        """Check if email service is enabled and configured"""
        return self._enabled

    def send_deadline_reminder(
        self,
        to_email: str,
        task_title: str,
        task_id: UUID,
        due_date: datetime,
        hours_until_due: int,
        project_title: str | None = None,
        goal_title: str | None = None,
    ) -> bool:
        """
        Send a deadline reminder email for a specific task.

        Args:
            to_email: Recipient email address
            task_title: Title of the task
            task_id: UUID of the task
            due_date: Task due date
            hours_until_due: Hours remaining until deadline
            project_title: Optional project title for context
            goal_title: Optional goal title for context

        Returns:
            True if email was sent successfully, False otherwise
        """
        if not self.is_enabled:
            logger.warning("Email service is not enabled, skipping deadline reminder")
            return False

        try:
            subject = f"【期限通知】{task_title} - {hours_until_due}時間後に期限"

            # Build context path
            context_parts = []
            if project_title:
                context_parts.append(project_title)
            if goal_title:
                context_parts.append(goal_title)
            context_path = " > ".join(context_parts) if context_parts else ""

            html_content = self._render_deadline_reminder_html(
                task_title=task_title,
                due_date=due_date,
                hours_until_due=hours_until_due,
                context_path=context_path,
            )

            params = {
                "from": settings.email_from,
                "to": [to_email],
                "subject": subject,
                "html": html_content,
            }

            response = resend.Emails.send(params)
            logger.info(
                f"Deadline reminder sent to {to_email} for task {task_id}: {response}"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to send deadline reminder to {to_email}: {e}")
            return False

    def send_daily_digest(
        self,
        to_email: str,
        tasks: list[dict],
        digest_date: datetime,
    ) -> bool:
        """
        Send a daily digest email with upcoming task deadlines.

        Args:
            to_email: Recipient email address
            tasks: List of task dictionaries with title, due_date, priority
            digest_date: Date of the digest

        Returns:
            True if email was sent successfully, False otherwise
        """
        if not self.is_enabled:
            logger.warning("Email service is not enabled, skipping daily digest")
            return False

        if not tasks:
            logger.info(f"No tasks for daily digest to {to_email}")
            return True

        try:
            date_str = digest_date.strftime("%Y年%m月%d日")
            subject = f"【HumanCompiler】{date_str} のタスク期限サマリー"

            html_content = self._render_daily_digest_html(
                tasks=tasks,
                digest_date=digest_date,
            )

            params = {
                "from": settings.email_from,
                "to": [to_email],
                "subject": subject,
                "html": html_content,
            }

            response = resend.Emails.send(params)
            logger.info(
                f"Daily digest sent to {to_email} with {len(tasks)} tasks: {response}"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to send daily digest to {to_email}: {e}")
            return False

    def send_overdue_alert(
        self,
        to_email: str,
        task_title: str,
        task_id: UUID,
        due_date: datetime,
        hours_overdue: int,
        project_title: str | None = None,
        goal_title: str | None = None,
    ) -> bool:
        """
        Send an overdue alert email for a task that has passed its deadline.

        Args:
            to_email: Recipient email address
            task_title: Title of the task
            task_id: UUID of the task
            due_date: Task due date (already passed)
            hours_overdue: Hours past the deadline
            project_title: Optional project title for context
            goal_title: Optional goal title for context

        Returns:
            True if email was sent successfully, False otherwise
        """
        if not self.is_enabled:
            logger.warning("Email service is not enabled, skipping overdue alert")
            return False

        try:
            subject = f"【期限超過】{task_title} - {hours_overdue}時間経過"

            # Build context path
            context_parts = []
            if project_title:
                context_parts.append(project_title)
            if goal_title:
                context_parts.append(goal_title)
            context_path = " > ".join(context_parts) if context_parts else ""

            html_content = self._render_overdue_alert_html(
                task_title=task_title,
                due_date=due_date,
                hours_overdue=hours_overdue,
                context_path=context_path,
            )

            params = {
                "from": settings.email_from,
                "to": [to_email],
                "subject": subject,
                "html": html_content,
            }

            response = resend.Emails.send(params)
            logger.info(
                f"Overdue alert sent to {to_email} for task {task_id}: {response}"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to send overdue alert to {to_email}: {e}")
            return False

    def _render_deadline_reminder_html(
        self,
        task_title: str,
        due_date: datetime,
        hours_until_due: int,
        context_path: str,
    ) -> str:
        """Render HTML template for deadline reminder email"""
        due_date_str = due_date.strftime("%Y年%m月%d日 %H:%M")

        return f"""
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">⏰ タスク期限のお知らせ</h1>
    </div>

    <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin-top: 0; color: #495057; font-size: 20px;">{task_title}</h2>

            {f'<p style="color: #6c757d; font-size: 14px; margin-bottom: 15px;">📁 {context_path}</p>' if context_path else ''}

            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #856404;">
                    期限まであと <span style="font-size: 24px;">{hours_until_due}</span> 時間
                </p>
                <p style="margin: 5px 0 0 0; color: #856404;">
                    期限: {due_date_str}
                </p>
            </div>
        </div>

        <p style="color: #6c757d; font-size: 14px; margin-top: 20px; text-align: center;">
            このメールは HumanCompiler から自動送信されています。
        </p>
    </div>
</body>
</html>
"""

    def _render_daily_digest_html(
        self,
        tasks: list[dict],
        digest_date: datetime,
    ) -> str:
        """Render HTML template for daily digest email"""
        date_str = digest_date.strftime("%Y年%m月%d日")

        # Build task list HTML
        task_items = ""
        for task in tasks:
            due_date = task.get("due_date")
            if isinstance(due_date, datetime):
                due_str = due_date.strftime("%m/%d %H:%M")
            else:
                due_str = str(due_date) if due_date else "未設定"

            priority = task.get("priority", 3)
            priority_color = {1: "#dc3545", 2: "#fd7e14", 3: "#ffc107", 4: "#20c997", 5: "#6c757d"}.get(priority, "#6c757d")

            task_items += f"""
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #e9ecef;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: {priority_color}; margin-right: 8px;"></span>
                    {task.get('title', 'Untitled')}
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: right; color: #6c757d;">
                    {due_str}
                </td>
            </tr>
"""

        return f"""
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">📋 {date_str} のタスクサマリー</h1>
    </div>

    <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="margin-top: 0; color: #495057;">
                本日期限のタスクが <strong>{len(tasks)}件</strong> あります。
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">タスク</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">期限</th>
                    </tr>
                </thead>
                <tbody>
                    {task_items}
                </tbody>
            </table>
        </div>

        <p style="color: #6c757d; font-size: 14px; margin-top: 20px; text-align: center;">
            このメールは HumanCompiler から自動送信されています。
        </p>
    </div>
</body>
</html>
"""

    def _render_overdue_alert_html(
        self,
        task_title: str,
        due_date: datetime,
        hours_overdue: int,
        context_path: str,
    ) -> str:
        """Render HTML template for overdue alert email"""
        due_date_str = due_date.strftime("%Y年%m月%d日 %H:%M")

        return f"""
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🚨 タスク期限超過のお知らせ</h1>
    </div>

    <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin-top: 0; color: #495057; font-size: 20px;">{task_title}</h2>

            {f'<p style="color: #6c757d; font-size: 14px; margin-bottom: 15px;">📁 {context_path}</p>' if context_path else ''}

            <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #721c24;">
                    期限を <span style="font-size: 24px;">{hours_overdue}</span> 時間超過しています
                </p>
                <p style="margin: 5px 0 0 0; color: #721c24;">
                    期限: {due_date_str}
                </p>
            </div>
        </div>

        <p style="color: #6c757d; font-size: 14px; margin-top: 20px; text-align: center;">
            このメールは HumanCompiler から自動送信されています。
        </p>
    </div>
</body>
</html>
"""


# Global email service instance
_email_service: EmailService | None = None


def get_email_service() -> EmailService:
    """Get or create the email service instance"""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
