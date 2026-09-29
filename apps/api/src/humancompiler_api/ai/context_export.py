# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""Markdown context export for projects and goals.

Collects the notes and work history under a project or goal into a single
Markdown document that can be handed to an AI assistant as context.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Text, cast, func
from sqlmodel import Session, col, or_, select

from humancompiler_api.ai.note_text import load_note_texts
from humancompiler_api.ai.report_generator import TASK_STATUS_LABELS
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    DailyPlanDocument,
    Goal,
    Log,
    Project,
    Task,
    WorkSession,
)
from humancompiler_api.services import goal_service, project_service

JST = ZoneInfo("Asia/Tokyo")

ExportScope = Literal["project", "goal"]

WORK_TYPE_LABELS = {
    "light_work": "軽作業",
    "study": "学習",
    "focused_work": "集中作業",
}
PRIORITY_LABELS = {1: "最高", 2: "高", 3: "中", 4: "低", 5: "最低"}
CHECKOUT_TYPE_LABELS = {
    "manual": "手動",
    "scheduled": "予定通り",
    "overdue": "超過",
    "interrupted": "中断",
}
SESSION_DECISION_LABELS = {
    "continue": "継続",
    "switch": "切替",
    "break": "休憩",
    "complete": "完了",
}
CONTINUE_REASON_LABELS = {
    "good_stopping_point": "キリが良い",
    "waiting_for_blocker": "ブロッカー解消待ち",
    "need_research": "調査が必要",
    "in_flow_state": "集中が乗っている",
    "unexpected_complexity": "想定外の難しさ",
    "time_constraint": "時間の制約",
    "other": "その他",
}
SWITCH_DISPOSITION_LABELS = {
    "complete": "完了",
    "pause": "一時停止して切替",
    "defer": "後回し",
}

# Active work first so the most relevant context leads each section.
_STATUS_ORDER = {"in_progress": 0, "pending": 1, "completed": 2, "cancelled": 3}
_CLOSED_STATUSES = {"completed", "cancelled"}

_ATX_HEADING = re.compile(r"^( {0,3})(#{1,6})(?=\s|$)")
_CODE_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_UNSAFE_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_MAX_FILENAME_BASE_LENGTH = 80
# Most filesystems cap a filename at 255 bytes.
_MAX_FILENAME_BYTES = 255
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class ContextExportOptions:
    """What to include in a context export."""

    include_completed: bool = True
    include_work_sessions: bool = True
    include_daily_plans: bool = True
    # Limits work sessions and daily plan entries; notes and tasks are always
    # exported in full.
    period_days: int | None = None


@dataclass(frozen=True)
class ContextExportResult:
    """A rendered context export."""

    filename: str
    markdown: str
    generated_at: datetime


@dataclass
class _GoalSection:
    goal: Goal
    tasks: list[Task] = field(default_factory=list)
    hidden_task_count: int = 0
    completed_task_count: int = 0
    total_task_count: int = 0
    actual_minutes: int = 0


def demote_headings(text: str, levels: int) -> str:
    """Push ATX headings down ``levels`` levels (capped at 6).

    Notes are rendered under an entity heading, so their own headings must
    nest below it. Lines inside fenced code blocks are left untouched, and a
    fence left open is closed so it cannot swallow the rest of the export.
    """
    lines = []
    fence: str | None = None
    for line in text.splitlines():
        fence_match = _CODE_FENCE.match(line)
        if fence is not None:
            if fence_match:
                marker, rest = fence_match.groups()
                if (
                    marker[0] == fence[0]
                    and len(marker) >= len(fence)
                    and not rest.strip()
                ):
                    fence = None
        elif fence_match:
            marker, info = fence_match.groups()
            # A backtick fence's info string cannot contain backticks, so
            # such a line is plain text rather than an opening fence.
            if marker[0] == "~" or "`" not in info:
                fence = marker
        elif levels > 0:
            heading = _ATX_HEADING.match(line)
            if heading:
                depth = min(len(heading.group(2)) + levels, 6)
                line = heading.group(1) + "#" * depth + line[heading.end() :]
        lines.append(line)
    if fence is not None:
        lines.append(fence)
    return "\n".join(lines)


def build_export_filename(title: str, day: date) -> str:
    """Build a filesystem-safe Markdown filename for an export."""
    suffix = f"_context_{day:%Y%m%d}.md"
    base = _UNSAFE_FILENAME_CHARS.sub("_", title)
    base = re.sub(r"[\s_]+", "_", base).strip("._")
    base = base[:_MAX_FILENAME_BASE_LENGTH]
    # Multi-byte titles can pass the byte limit well before the character
    # limit; truncating the UTF-8 bytes this way never splits a character.
    max_base_bytes = _MAX_FILENAME_BYTES - len(suffix.encode())
    base = base.encode()[:max_base_bytes].decode("utf-8", "ignore").rstrip("._")
    return f"{base or 'export'}{suffix}"


def build_project_context_export(
    session: Session,
    owner_id: UUID,
    project_id: UUID,
    options: ContextExportOptions,
    now: datetime | None = None,
) -> ContextExportResult:
    """Export a project with all of its goals and tasks."""
    project = project_service.get_project(session, project_id, owner_id)
    if project is None:
        raise ResourceNotFoundError("Project", project_id)
    goals = list(session.exec(select(Goal).where(Goal.project_id == project.id)))
    return _ContextExportBuilder(session, owner_id, options, now).build(
        "project", project, goals
    )


def build_goal_context_export(
    session: Session,
    owner_id: UUID,
    goal_id: UUID,
    options: ContextExportOptions,
    now: datetime | None = None,
) -> ContextExportResult:
    """Export a goal and its tasks, with its project as background."""
    goal = goal_service.get_goal(session, goal_id, owner_id)
    project = session.get(Project, goal.project_id) if goal else None
    if goal is None or project is None:
        raise ResourceNotFoundError("Goal", goal_id)
    return _ContextExportBuilder(session, owner_id, options, now).build(
        "goal", project, [goal]
    )


class _ContextExportBuilder:
    def __init__(
        self,
        session: Session,
        owner_id: UUID,
        options: ContextExportOptions,
        now: datetime | None,
    ) -> None:
        self.session = session
        self.owner_id = owner_id
        self.options = options
        self.now = _as_utc(now) if now else datetime.now(UTC)
        self.since = (
            self.now - timedelta(days=options.period_days)
            if options.period_days
            else None
        )

    def build(
        self, scope: ExportScope, project: Project, goals: list[Goal]
    ) -> ContextExportResult:
        goal_ids = [goal.id for goal in goals if goal.id]
        all_tasks = (
            list(self.session.exec(select(Task).where(col(Task.goal_id).in_(goal_ids))))
            if goal_ids
            else []
        )
        actual_minutes = self._load_actual_minutes(
            [task.id for task in all_tasks if task.id]
        )

        sections: list[_GoalSection] = []
        hidden_goal_count = 0
        for goal in sorted(goals, key=_goal_sort_key):
            # The goal being exported is always shown, whatever its status.
            if (
                scope == "project"
                and not self.options.include_completed
                and _value(goal.status) in _CLOSED_STATUSES
            ):
                hidden_goal_count += 1
                continue
            sections.append(self._goal_section(goal, all_tasks, actual_minutes))

        shown_tasks = [task for section in sections for task in section.tasks]
        task_ids = [task.id for task in shown_tasks if task.id]
        project_notes, goal_notes, task_notes = load_note_texts(
            self.session,
            self.owner_id,
            project_ids=[project.id] if project.id else [],
            goal_ids=[section.goal.id for section in sections if section.goal.id],
            task_ids=task_ids,
        )
        work_sessions = (
            self._load_work_sessions(task_ids)
            if self.options.include_work_sessions
            else {}
        )
        daily_plan_entries = (
            self._load_daily_plan_entries(task_ids)
            if self.options.include_daily_plans
            else {}
        )

        title = _one_line(project.title if scope == "project" else goals[0].title)
        blocks = [
            *self._render_preamble(scope, title),
            *self._render_project(
                scope,
                project,
                project_notes.get(project.id) if project.id else None,
                all_tasks,
                actual_minutes,
                len(goals),
                hidden_goal_count,
            ),
        ]
        for section in sections:
            blocks.extend(
                self._render_goal(
                    section,
                    actual_minutes,
                    goal_notes,
                    task_notes,
                    work_sessions,
                    daily_plan_entries,
                )
            )

        return ContextExportResult(
            filename=build_export_filename(title, self.now.astimezone(JST).date()),
            markdown="\n\n".join(blocks) + "\n",
            generated_at=self.now,
        )

    def _goal_section(
        self, goal: Goal, all_tasks: list[Task], actual_minutes: Mapping[UUID, int]
    ) -> _GoalSection:
        goal_tasks = sorted(
            (task for task in all_tasks if task.goal_id == goal.id),
            key=_task_sort_key,
        )
        section = _GoalSection(
            goal=goal,
            total_task_count=len(goal_tasks),
            completed_task_count=sum(
                _value(task.status) == "completed" for task in goal_tasks
            ),
            actual_minutes=sum(
                actual_minutes.get(task.id, 0) for task in goal_tasks if task.id
            ),
        )
        for task in goal_tasks:
            if (
                not self.options.include_completed
                and _value(task.status) in _CLOSED_STATUSES
            ):
                section.hidden_task_count += 1
            else:
                section.tasks.append(task)
        return section

    def _load_actual_minutes(self, task_ids: Sequence[UUID]) -> dict[UUID, int]:
        if not task_ids:
            return {}
        rows = self.session.exec(
            select(Log.task_id, func.sum(Log.actual_minutes))
            .where(col(Log.task_id).in_(task_ids))
            .group_by(col(Log.task_id))
        ).all()
        return {task_id: int(total or 0) for task_id, total in rows}

    def _load_work_sessions(
        self, task_ids: Sequence[UUID]
    ) -> dict[UUID, list[WorkSession]]:
        if not task_ids:
            return {}
        statement = select(WorkSession).where(
            WorkSession.user_id == self.owner_id,
            col(WorkSession.task_id).in_(task_ids),
        )
        if self.since:
            statement = statement.where(col(WorkSession.started_at) >= self.since)
        sessions: dict[UUID, list[WorkSession]] = {}
        for work_session in self.session.exec(
            statement.order_by(col(WorkSession.started_at))
        ):
            sessions.setdefault(work_session.task_id, []).append(work_session)
        return sessions

    def _load_daily_plan_entries(
        self, task_ids: Sequence[UUID]
    ) -> dict[UUID, list[str]]:
        """Collect daily plan lines that reference the given tasks.

        Documents are scanned leniently instead of being validated against the
        current schema, so older or partially malformed documents still export.
        """
        if not task_ids:
            return {}
        wanted = {str(task_id).lower(): task_id for task_id in task_ids}
        # Only fetch documents whose JSON mentions one of the task IDs; the
        # lenient scan below still decides which blocks actually match.
        document_text = cast(DailyPlanDocument.document_json, Text)
        statement = select(
            DailyPlanDocument.date, DailyPlanDocument.document_json
        ).where(
            DailyPlanDocument.user_id == self.owner_id,
            or_(*(document_text.ilike(f"%{task_id}%") for task_id in wanted)),
        )
        if self.since:
            statement = statement.where(
                col(DailyPlanDocument.date) >= self.since.astimezone(JST).date()
            )
        entries: dict[UUID, list[str]] = {}
        for plan_date, document in self.session.exec(
            statement.order_by(col(DailyPlanDocument.date))
        ):
            blocks = document.get("blocks") if isinstance(document, dict) else None
            if not isinstance(blocks, list):
                continue
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                task_ref = block.get("task_ref")
                if not isinstance(task_ref, dict) or task_ref.get("source") != "task":
                    continue
                task_id = wanted.get(str(task_ref.get("id", "")).lower())
                if task_id is None:
                    continue
                entry = _render_daily_plan_block(plan_date, block)
                if entry:
                    entries.setdefault(task_id, []).append(entry)
        return entries

    def _render_preamble(self, scope: ExportScope, title: str) -> list[str]:
        scope_label = "プロジェクト" if scope == "project" else "ゴール"
        if self.since:
            period = (
                f"直近{self.options.period_days}日"
                f"（{self.since.astimezone(JST).date().isoformat()}以降）"
            )
        else:
            period = "全期間"
        included = " ／ ".join(
            f"{label}: {'含む' if enabled else '含まない'}"
            for label, enabled in (
                ("完了・キャンセル済み", self.options.include_completed),
                ("作業セッション", self.options.include_work_sessions),
                ("デイリープラン", self.options.include_daily_plans),
            )
        )
        return [
            f"# AIコンテキスト: {title}",
            "\n".join(
                [
                    f"> HumanCompilerから書き出した{scope_label}「{title}」の"
                    "コンテキスト（ノート・タスク・作業記録）です。",
                    f"> - 出力日時: {self.now.astimezone(JST):%Y-%m-%d %H:%M} (JST)",
                    f"> - 作業記録の対象期間: {period}",
                    f"> - {included}",
                ]
            ),
        ]

    def _render_project(
        self,
        scope: ExportScope,
        project: Project,
        note: str | None,
        all_tasks: list[Task],
        actual_minutes: Mapping[UUID, int],
        goal_count: int,
        hidden_goal_count: int,
    ) -> list[str]:
        facts = [f"ステータス: {_status_label(project.status)}"]
        if project.created_at:
            facts.append(f"作成日: {_jst_date(project.created_at)}")
        if scope == "project":
            completed = sum(_value(task.status) == "completed" for task in all_tasks)
            facts.append(
                f"ゴール: {goal_count}件 ／ タスク: 完了 {completed} / 全 {len(all_tasks)}件"
            )
            total_minutes = sum(actual_minutes.values())
            if total_minutes:
                facts.append(f"実績合計: {_minutes_to_hours(total_minutes)}")
        blocks = [
            f"## プロジェクト: {_one_line(project.title)}",
            _bullets(facts),
        ]
        if project.description and project.description.strip():
            blocks.append(demote_headings(project.description.strip(), 2))
        if hidden_goal_count:
            blocks.append(
                f"※ 完了・キャンセル済みのゴール{hidden_goal_count}件は省略しています。"
            )
        if note:
            blocks.extend(["### プロジェクトノート", demote_headings(note, 3)])
        return blocks

    def _render_goal(
        self,
        section: _GoalSection,
        actual_minutes: Mapping[UUID, int],
        goal_notes: Mapping[UUID, str],
        task_notes: Mapping[UUID, str],
        work_sessions: Mapping[UUID, list[WorkSession]],
        daily_plan_entries: Mapping[UUID, list[str]],
    ) -> list[str]:
        goal = section.goal
        facts = [f"ステータス: {_status_label(goal.status)}"]
        if goal.due_date:
            facts.append(f"期限: {_jst_date(goal.due_date)}")
        effort = f"見積: {_hours(goal.estimate_hours)}"
        if section.actual_minutes:
            effort += f" ／ 実績: {_minutes_to_hours(section.actual_minutes)}"
        facts.append(effort)
        facts.append(
            f"タスク: 完了 {section.completed_task_count} / 全 {section.total_task_count}件"
        )
        blocks = [f"## ゴール: {_one_line(goal.title)}", _bullets(facts)]
        if goal.description and goal.description.strip():
            blocks.append(demote_headings(goal.description.strip(), 2))
        goal_note = goal_notes.get(goal.id) if goal.id else None
        if goal_note:
            blocks.extend(["### ゴールノート", demote_headings(goal_note, 3)])
        if section.hidden_task_count:
            blocks.append(
                f"※ 完了・キャンセル済みのタスク{section.hidden_task_count}件は"
                "省略しています。"
            )
        for task in section.tasks:
            task_id = task.id
            blocks.extend(
                self._render_task(
                    task,
                    actual_minutes,
                    task_notes.get(task_id) if task_id else None,
                    work_sessions.get(task_id, []) if task_id else [],
                    daily_plan_entries.get(task_id, []) if task_id else [],
                )
            )
        return blocks

    def _render_task(
        self,
        task: Task,
        actual_minutes: Mapping[UUID, int],
        note: str | None,
        work_sessions: list[WorkSession],
        daily_plan_entries: list[str],
    ) -> list[str]:
        facts = [
            " ／ ".join(
                [
                    f"ステータス: {_status_label(task.status)}",
                    f"種別: {_label(WORK_TYPE_LABELS, task.work_type) or '-'}",
                    f"優先度: {PRIORITY_LABELS.get(task.priority, task.priority)}",
                ]
            )
        ]
        effort = f"見積: {_hours(task.estimate_hours)}"
        actual = actual_minutes.get(task.id, 0) if task.id else 0
        if actual:
            effort += f" ／ 実績(累計): {_minutes_to_hours(actual)}"
        facts.append(effort)
        if task.due_date:
            facts.append(f"期限: {_jst_date(task.due_date)}")

        blocks = [f"### タスク: {_one_line(task.title)}", _bullets(facts)]
        if task.description and task.description.strip():
            blocks.append(demote_headings(task.description.strip(), 3))
        if task.memo and task.memo.strip():
            blocks.extend(["#### メモ", demote_headings(task.memo.strip(), 4)])
        if note:
            blocks.extend(["#### ノート", demote_headings(note, 4)])
        if work_sessions:
            blocks.extend(
                [
                    f"#### 作業セッション（{len(work_sessions)}件）",
                    "\n".join(_render_work_session(ws) for ws in work_sessions),
                ]
            )
        if daily_plan_entries:
            blocks.extend(
                [
                    f"#### デイリープランの記録（{len(daily_plan_entries)}件）",
                    "\n".join(daily_plan_entries),
                ]
            )
        return blocks


def _render_work_session(work_session: WorkSession) -> str:
    started = _as_utc(work_session.started_at).astimezone(JST)
    if work_session.ended_at:
        ended = _as_utc(work_session.ended_at).astimezone(JST)
        end_text = (
            f"{ended:%H:%M}"
            if ended.date() == started.date()
            else f"{ended:%Y-%m-%d %H:%M}"
        )
        head = (
            f"{started:%Y-%m-%d %H:%M}〜{end_text}"
            f"（実働{_session_minutes(work_session)}分）"
        )
    else:
        head = f"{started:%Y-%m-%d %H:%M}〜（進行中）"

    parts = [head]
    decision = _label(SESSION_DECISION_LABELS, work_session.decision)
    if decision:
        reason = _label(CONTINUE_REASON_LABELS, work_session.continue_reason)
        parts.append(f"判断: {decision}" + (f"（{reason}）" if reason else ""))
    checkout = _label(CHECKOUT_TYPE_LABELS, work_session.checkout_type)
    if checkout:
        parts.append(f"終了: {checkout}")

    lines = [_bullet(" ／ ".join(parts))]
    for label, value in (
        ("予定成果", work_session.planned_outcome),
        ("Keep", work_session.kpt_keep),
        ("Problem", work_session.kpt_problem),
        ("Try", work_session.kpt_try),
        ("中断メモ", work_session.interruption_note),
    ):
        if value and value.strip():
            lines.append(_bullet(f"{label}: {_entry_text(value)}", indent=1))
    disposition = _label(SWITCH_DISPOSITION_LABELS, work_session.switch_disposition)
    if disposition:
        lines.append(_bullet(f"切替時の扱い: {disposition}", indent=1))
    if work_session.remaining_estimate_hours is not None:
        lines.append(
            _bullet(
                f"残り見積: {_hours(work_session.remaining_estimate_hours)}",
                indent=1,
            )
        )
    return "\n".join(lines)


def _render_daily_plan_block(plan_date: date, block: Mapping[str, Any]) -> str | None:
    block_type = block.get("type")
    title = _one_line(str(block.get("title") or ""))
    day = plan_date.isoformat()
    if block_type == "timed_line":
        status = "[完了] " if block.get("completed") else ""
        head = f"{day} {block.get('start', '')}〜{block.get('end', '')} {status}{title}"
    elif block_type == "checklist_item":
        mark = "[x]" if block.get("checked") else "[ ]"
        head = f"{day} {mark} {title}"
    elif block_type == "schedule_directive":
        head = f"{day} [スケジュール指示] {title or '(タイトルなし)'}"
    else:
        return None
    lines = [_bullet(head.rstrip())]
    note = block.get("note")
    if isinstance(note, str) and note.strip():
        lines.append(_bullet(f"メモ: {_entry_text(note)}", indent=1))
    return "\n".join(lines)


def _entry_text(text: str) -> str:
    """Normalize free text shown inside a work session or daily plan entry.

    Entries sit under a level-4 section heading, so headings in the text are
    pushed below it and an unclosed code fence is closed, as for notes.
    """
    return demote_headings(text.strip(), 4)


def _session_minutes(work_session: WorkSession) -> int:
    """Net minutes worked, matching the log written at checkout."""
    if work_session.ended_at is None:
        return 0
    elapsed = _as_utc(work_session.ended_at) - _as_utc(work_session.started_at)
    net_seconds = int(elapsed.total_seconds()) - (
        work_session.total_paused_seconds or 0
    )
    return max(1, max(net_seconds, 0) // 60)


def _bullet(text: str, indent: int = 0) -> str:
    """Render a list item, indenting continuation lines under it."""
    padding = "  " * indent
    first, *rest = text.splitlines() or [""]
    lines = [f"{padding}- {first}"]
    lines.extend(f"{padding}  {line}" if line.strip() else "" for line in rest)
    return "\n".join(lines)


def _bullets(items: Sequence[str]) -> str:
    return "\n".join(_bullet(item) for item in items)


def _goal_sort_key(goal: Goal) -> tuple[int, int, datetime, datetime]:
    return (
        _STATUS_ORDER.get(_value(goal.status), len(_STATUS_ORDER)),
        goal.due_date is None,
        _as_utc(goal.due_date) if goal.due_date else _EPOCH,
        _as_utc(goal.created_at) if goal.created_at else _EPOCH,
    )


def _task_sort_key(task: Task) -> tuple[int, int, datetime]:
    return (
        _STATUS_ORDER.get(_value(task.status), len(_STATUS_ORDER)),
        task.priority,
        _as_utc(task.created_at) if task.created_at else _EPOCH,
    )


def _as_utc(value: datetime) -> datetime:
    """Treat naive datetimes (as returned by SQLite) as UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _jst_date(value: datetime) -> str:
    return _as_utc(value).astimezone(JST).date().isoformat()


def _value(value: Any) -> Any:
    return getattr(value, "value", value)


def _label(labels: Mapping[str, str], value: Any) -> str | None:
    if value is None:
        return None
    raw = _value(value)
    return labels.get(raw, str(raw))


def _status_label(value: Any) -> str:
    return _label(TASK_STATUS_LABELS, value) or "-"


def _hours(value: Decimal | float | int | None) -> str:
    if value is None:
        return "-"
    return f"{float(value):g}h"


def _minutes_to_hours(minutes: int) -> str:
    return f"{round(minutes / 60, 2):g}h"


def _one_line(text: str) -> str:
    return " ".join(text.split())
