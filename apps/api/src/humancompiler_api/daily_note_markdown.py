# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Render a daily note (``DailyPlanDocumentV1``) as Markdown for agents.

Blocks are rendered in the note's order, as the editor shows them:

* text: the rich text (Tiptap JSON) through HTML and ``note_html_to_markdown``,
  the same conversion context notes use; the plain ``text`` when there is no
  rich content.
* fixed events and breaks: ``- 09:00〜10:00 title`` with ``[休憩]`` or ``（完了）``.
* /schedule lines: ``- /schedule 09:00〜12:00 title（集中作業）``.
* checklist items: ``- [ ] title`` / ``- [x] title``.

A line that points at a task carries ``(task_id: ...)`` or
``(quick_task_id: ...)`` so an agent can read the task with ``get_task``.
The memo under a line follows it, indented.
"""

from __future__ import annotations

from collections.abc import Mapping
from html import escape
from typing import Any

from humancompiler_api.note_markdown_out import note_html_to_markdown
from humancompiler_api.routers.daily_plans import (
    ChecklistItemBlock,
    DailyPlanDocumentV1,
    ScheduleDirectiveBlock,
    TaskRef,
    TextBlock,
    TimedLineBlock,
)

WORK_TYPE_LABELS = {"light_work": "軽作業", "focused_work": "集中作業", "study": "学習"}

_BLOCK_TAGS = {
    "paragraph": "p",
    "blockquote": "blockquote",
    "bulletList": "ul",
    "listItem": "li",
}
_MARK_TAGS = {"bold": "strong", "italic": "em", "strike": "s", "code": "code"}


def _marks_html(text: str, marks: list[Any]) -> str:
    html = escape(text)
    for mark in marks:
        if not isinstance(mark, Mapping):
            continue
        kind = mark.get("type")
        if kind in _MARK_TAGS:
            tag = _MARK_TAGS[kind]
            html = f"<{tag}>{html}</{tag}>"
        elif kind == "link":
            attrs = mark.get("attrs")
            href = attrs.get("href") if isinstance(attrs, Mapping) else None
            if isinstance(href, str):
                html = f'<a href="{escape(href)}">{html}</a>'
    return html


def tiptap_to_html(node: Any) -> str:
    """HTML for a validated Tiptap node (see ``TextBlock.validate_content``)."""
    if not isinstance(node, Mapping):
        return ""
    kind = node.get("type")
    attrs = node.get("attrs") if isinstance(node.get("attrs"), Mapping) else {}
    children = node.get("content")
    inner = "".join(tiptap_to_html(child) for child in children or [])
    if kind == "text":
        marks = node.get("marks")
        return _marks_html(str(node.get("text") or ""), marks or [])
    if kind == "hardBreak":
        return "<br>"
    if kind == "horizontalRule":
        return "<hr>"
    if kind == "heading":
        level = attrs.get("level")
        level = level if isinstance(level, int) and 1 <= level <= 6 else 2
        return f"<h{level}>{inner}</h{level}>"
    if kind == "orderedList":
        start = attrs.get("start")
        start_attr = (
            f' start="{start}"' if isinstance(start, int) and start != 1 else ""
        )
        return f"<ol{start_attr}>{inner}</ol>"
    if kind == "taskList":
        return f'<ul data-type="taskList">{inner}</ul>'
    if kind == "taskItem":
        checked = "true" if attrs.get("checked") is True else "false"
        return f'<li data-type="taskItem" data-checked="{checked}">{inner}</li>'
    if kind == "codeBlock":
        language = attrs.get("language")
        code_class = (
            f' class="language-{escape(language)}"'
            if isinstance(language, str) and language
            else ""
        )
        return f"<pre><code{code_class}>{inner}</code></pre>"
    tag = _BLOCK_TAGS.get(str(kind))
    return f"<{tag}>{inner}</{tag}>" if tag else inner


def _task_suffix(task_ref: TaskRef | None) -> str:
    if task_ref is None:
        return ""
    key = "task_id" if task_ref.source == "task" else "quick_task_id"
    return f" ({key}: {task_ref.id})"


def _with_memo(line: str, memo: str | None) -> str:
    if not memo or not memo.strip():
        return line
    memo_lines = memo.strip().splitlines()
    indented = "\n".join(f"  {text}" if text else "" for text in memo_lines)
    return f"{line}\n  メモ:\n{indented}"


def _render_block(
    block: TimedLineBlock | ScheduleDirectiveBlock | ChecklistItemBlock | TextBlock,
) -> str:
    if isinstance(block, TextBlock):
        if block.content is not None:
            return note_html_to_markdown(tiptap_to_html(block.content))
        return block.text.strip()
    if isinstance(block, TimedLineBlock):
        kind = "[休憩] " if block.kind == "break" else ""
        done = "（完了）" if block.completed else ""
        line = f"- {block.start}〜{block.end} {kind}{block.title}{done}"
        return _with_memo(line + _task_suffix(block.task_ref), block.note)
    if isinstance(block, ScheduleDirectiveBlock):
        windows = " ".join(f"{w.start}〜{w.end}" for w in block.allowed_windows)
        parts = ["- /schedule", windows, block.title or ""]
        line = " ".join(part for part in parts if part)
        line += f"（{WORK_TYPE_LABELS.get(block.work_type, block.work_type)}）"
        return _with_memo(line + _task_suffix(block.task_ref), block.note)
    mark = "[x]" if block.checked else "[ ]"
    return f"- {mark} {block.title}{_task_suffix(block.task_ref)}"


def daily_note_markdown(document: DailyPlanDocumentV1) -> str:
    """The note as Markdown; consecutive list lines stay one list."""
    parts: list[tuple[bool, str]] = []
    for block in document.blocks:
        text = _render_block(block)
        if text:
            parts.append((not isinstance(block, TextBlock), text))
    output = ""
    previous_is_line = False
    for is_line, text in parts:
        if output:
            output += "\n" if is_line and previous_is_line else "\n\n"
        output += text
        previous_is_line = is_line
    return output


def schedule_payload(plan: Mapping[str, Any] | None) -> list[dict[str, Any]] | None:
    """The generated schedule's assignments, by start time, or None if none."""
    if not plan:
        return None
    assignments = plan.get("assignments")
    if not isinstance(assignments, list):
        return None
    items = []
    for item in assignments:
        if not isinstance(item, Mapping):
            continue
        hours = item.get("duration_hours")
        # Schedules store a quick task as "quick_<id>" (TaskRef.scheduler_id).
        task_id = str(item.get("task_id") or "")
        quick = item.get("source") == "quick_task" or task_id.startswith("quick_")
        task_id = task_id.removeprefix("quick_")
        items.append(
            {
                "start_time": str(item.get("start_time") or ""),
                "duration_minutes": (
                    round(float(hours) * 60) if isinstance(hours, int | float) else 0
                ),
                "title": str(item.get("task_title") or ""),
                "quick_task_id" if quick else "task_id": task_id,
            }
        )
    items.sort(key=lambda entry: entry["start_time"])
    return items
