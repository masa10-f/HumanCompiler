"""
Email notification service using Resend (Issue #261)

Handles:
- Sending task deadline reminder emails
- Daily digest emails (new agent proposals and tasks due soon)
- Email notification logging and tracking
"""

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from html import escape
from uuid import UUID

import resend

from humancompiler_api.config import settings
from humancompiler_api.proposal_service import APP_TIMEZONE

logger = logging.getLogger(__name__)

# Japanese labels for ProposalKind values; unknown kinds show the raw value.
PROPOSAL_KIND_LABELS: dict[str, str] = {
    "goal": "Goal",
    "task": "タスク",
    "quick_task": "クイックタスク",
    "note_append": "ノート追記",
    "contradiction": "矛盾",
    "decision_request": "判断の依頼",
    "experiment": "実験",
}


@dataclass(frozen=True)
class DigestProposal:
    kind: str  # ProposalKind value
    title: str
    project_name: str | None
    agent_name: str


@dataclass(frozen=True)
class DigestTask:
    title: str
    due_date: datetime  # aware UTC
    is_overdue: bool
    context: str | None  # "Project > Goal" for a task, None for a quick task


@dataclass(frozen=True)
class DailyDigest:
    digest_date: date  # JST calendar date
    proposals: list[DigestProposal]  # at most 20
    new_proposal_count: int  # all new pending proposals, may exceed len(proposals)
    pending_count: int  # all pending proposals of the user
    tasks: list[DigestTask]  # at most 20
    task_count: int  # all tasks in the window


def _format_digest_date(value: date) -> str:
    return value.strftime("%Y年%m月%d日")


def daily_digest_subject(digest: DailyDigest) -> str:
    """Plain-text subject line (not HTML-escaped)."""
    if digest.new_proposal_count > 0 and digest.task_count > 0:
        return (
            f"【HumanCompiler】新しい提案 {digest.new_proposal_count} 件と"
            f"期限の近いタスク {digest.task_count} 件"
        )
    if digest.new_proposal_count > 0:
        return f"【HumanCompiler】新しい提案 {digest.new_proposal_count} 件"
    return f"【HumanCompiler】{_format_digest_date(digest.digest_date)} のタスク期限サマリー"


def deadline_reminder_idempotency_key(task_id: UUID, reminder_date: date) -> str:
    """Resend idempotency key: one deadline reminder per task and JST day."""
    return f"deadline-reminder/{task_id}/{reminder_date.isoformat()}"


def daily_digest_idempotency_key(user_id: UUID, digest: DailyDigest) -> str:
    """Resend idempotency key: one daily digest per user and JST day."""
    return f"daily-digest/{user_id}/{digest.digest_date.isoformat()}"


def _jst(value: datetime) -> datetime:
    """Convert to JST; naive values (SQLite read-back) are treated as UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(APP_TIMEZONE)


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
        *,
        reminder_date: date,
    ) -> bool:
        """
        Send a deadline reminder email for a specific task.

        The Resend idempotency key is per task and ``reminder_date``, so a
        retried request for the same day is not delivered twice.

        Args:
            to_email: Recipient email address
            task_title: Title of the task
            task_id: UUID of the task
            due_date: Task due date
            hours_until_due: Hours remaining until deadline
            project_title: Optional project title for context
            goal_title: Optional goal title for context
            reminder_date: JST day the reminder belongs to, for the
                idempotency key

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

            options: resend.Emails.SendOptions = {
                "idempotency_key": deadline_reminder_idempotency_key(
                    task_id, reminder_date
                )
            }
            response = resend.Emails.send(params, options)
            logger.info(f"Deadline reminder sent for task {task_id}: {response}")
            return True

        except Exception as e:
            # Never log the message: it may echo the recipient address.
            logger.error(
                "Failed to send deadline reminder for task %s: %s "
                "(code=%s, error_type=%s)",
                task_id,
                type(e).__name__,
                getattr(e, "code", None),
                getattr(e, "error_type", None),
            )
            return False

    def send_daily_digest(
        self, to_email: str, digest: DailyDigest, user_id: UUID
    ) -> bool:
        """
        Send the daily digest email (new proposals and tasks due soon).

        The caller decides whether a digest is worth sending. The Resend
        idempotency key is per user and JST day, so a retried request for the
        same day is not delivered twice.

        Args:
            to_email: Recipient email address
            digest: Digest contents
            user_id: Recipient's user id, for the idempotency key

        Returns:
            True if email was sent successfully, False otherwise
        """
        if not self.is_enabled:
            logger.warning("Email service is not enabled, skipping daily digest")
            return False

        try:
            params = {
                "from": settings.email_from,
                "to": [to_email],
                "subject": daily_digest_subject(digest),
                "html": self._render_daily_digest_html(digest),
            }
            options: resend.Emails.SendOptions = {
                "idempotency_key": daily_digest_idempotency_key(user_id, digest)
            }
            resend.Emails.send(params, options)
            logger.info(
                "Daily digest sent (%d new proposals, %d tasks)",
                digest.new_proposal_count,
                digest.task_count,
            )
            return True

        except Exception as e:
            # Never log the message: it may echo the recipient address. The
            # Resend code and type (e.g. 409 invalid_idempotent_request) are safe.
            logger.error(
                "Failed to send daily digest: %s (code=%s, error_type=%s)",
                type(e).__name__,
                getattr(e, "code", None),
                getattr(e, "error_type", None),
            )
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

            {f'<p style="color: #6c757d; font-size: 14px; margin-bottom: 15px;">📁 {context_path}</p>' if context_path else ""}

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

    def _render_daily_digest_html(self, digest: DailyDigest) -> str:
        """Render HTML template for daily digest email"""
        base_url = settings.web_base_url
        card_cell = "padding: 10px 12px; border-bottom: 1px solid #e9ecef;"
        head_cell = "padding: 10px 12px; border-bottom: 2px solid #dee2e6;"
        link_style = "color: #667eea; font-weight: bold;"

        def link(path: str, label: str) -> str:
            if not base_url:
                return ""
            href = escape(f"{base_url}{path}", quote=True)
            return (
                f'<p style="margin: 15px 0 0 0;">'
                f'<a href="{href}" style="{link_style}">{escape(label)}</a></p>'
            )

        def more_line(total: int, shown: int) -> str:
            if total <= shown:
                return ""
            return (
                '<p style="margin: 10px 0 0 0; color: #6c757d; font-size: 14px;">'
                f"ほか {total - shown} 件</p>"
            )

        sections = ""

        if digest.new_proposal_count > 0:
            rows = ""
            for proposal in digest.proposals:
                kind_label = PROPOSAL_KIND_LABELS.get(proposal.kind, proposal.kind)
                project = proposal.project_name if proposal.project_name else "—"
                rows += f"""
                    <tr>
                        <td style="{card_cell} white-space: nowrap; color: #6c757d;">{escape(kind_label, quote=True)}</td>
                        <td style="{card_cell}">
                            {escape(proposal.title, quote=True)}
                            <div style="color: #6c757d; font-size: 12px;">提案元: {escape(proposal.agent_name, quote=True)}</div>
                        </td>
                        <td style="{card_cell} color: #6c757d;">{escape(project, quote=True)}</td>
                    </tr>
"""
            sections += f"""
            <h2 style="margin: 0 0 10px 0; color: #495057; font-size: 18px;">新しい提案（{digest.new_proposal_count} 件）</h2>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="{head_cell} text-align: left;">種類</th>
                        <th style="{head_cell} text-align: left;">提案</th>
                        <th style="{head_cell} text-align: left;">プロジェクト</th>
                    </tr>
                </thead>
                <tbody>{rows}
                </tbody>
            </table>
            {more_line(digest.new_proposal_count, len(digest.proposals))}
            <p style="margin: 10px 0 0 0; color: #6c757d; font-size: 14px;">未処理の提案は全部で {digest.pending_count} 件です。</p>
            {link("/inbox", "インボックスを開く")}
"""
        elif digest.pending_count > 0:
            sections += f"""
            <p style="margin: 0; color: #6c757d; font-size: 14px;">新しい提案はありません。未処理の提案は {digest.pending_count} 件です。</p>
            {link("/inbox", "インボックスを開く")}
"""

        if digest.task_count > 0:
            if sections:
                sections += '<hr style="border: none; border-top: 1px solid #e9ecef; margin: 25px 0;">'
            rows = ""
            for task in digest.tasks:
                due_str = _jst(task.due_date).strftime("%m/%d %H:%M")
                context = task.context if task.context else "クイックタスク"
                overdue_badge = (
                    ' <span style="display: inline-block; background: #f8d7da; color: #721c24; font-size: 12px; padding: 1px 6px; border-radius: 4px;">期限切れ</span>'
                    if task.is_overdue
                    else ""
                )
                rows += f"""
                    <tr>
                        <td style="{card_cell}">
                            {escape(task.title, quote=True)}{overdue_badge}
                            <div style="color: #6c757d; font-size: 12px;">{escape(context, quote=True)}</div>
                        </td>
                        <td style="{card_cell} text-align: right; white-space: nowrap; color: #6c757d;">{due_str}</td>
                    </tr>
"""
            sections += f"""
            <h2 style="margin: 0 0 10px 0; color: #495057; font-size: 18px;">期限が近いタスク（{digest.task_count} 件）</h2>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="{head_cell} text-align: left;">タスク</th>
                        <th style="{head_cell} text-align: right;">期限</th>
                    </tr>
                </thead>
                <tbody>{rows}
                </tbody>
            </table>
            {more_line(digest.task_count, len(digest.tasks))}
            {link("/dashboard", "ダッシュボードを開く")}
"""

        date_str = _format_digest_date(digest.digest_date)

        return f"""
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">📋 {date_str} のダイジェスト</h1>
    </div>

    <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
{sections}
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
