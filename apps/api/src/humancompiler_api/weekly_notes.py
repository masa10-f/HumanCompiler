# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly notes: one free-form note per user and week.

A week is an ISO 8601 week: it starts on Monday, as ``date.weekday() == 0``
and the weekly rhythm's weekday 0. "This week" is decided in Asia/Tokyo, as the
daily notes decide "today".

The web router, the agent REST API and the MCP tools all read notes through
this module, so ownership and the empty-note rule are the same everywhere.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from sqlmodel import Session, col, select

from humancompiler_api.models import WeeklyNote
from humancompiler_api.note_markdown_out import note_html_to_markdown

JST = ZoneInfo("Asia/Tokyo")
PREVIEW_LENGTH = 180

# Markup that renders as something even without text (the web viewer's rule in
# components/notes/context-note-panel.tsx ``hasRenderableContent``).
_STRUCTURAL_MARKUP = re.compile(
    r"<(img|hr|iframe|video|audio|canvas|table|thead|tbody|tr|td|th|pre|blockquote)\b"
    r"|data-type=[\"']taskList[\"']"
    r"|type=[\"']checkbox[\"']",
    re.IGNORECASE,
)
_TAG = re.compile(r"<[^>]*>")
_WHITESPACE = re.compile(r"\s+")


def week_start_of(value: date) -> date:
    """The Monday of the ISO week that contains ``value``."""
    return value - timedelta(days=value.weekday())


def week_end_of(week_start: date) -> date:
    """The Sunday of the week that starts on ``week_start``."""
    return week_start + timedelta(days=6)


def current_week_start(now: datetime | None = None) -> date:
    """The Monday of this week in Asia/Tokyo."""
    moment = now if now is not None else datetime.now(JST)
    return week_start_of(moment.astimezone(JST).date())


def normalize_content(content: str, content_type: str) -> str:
    """``""`` for a note with nothing to show, else ``content`` unchanged.

    The editor saves ``<p></p>`` for an empty document. Storing ``""`` instead
    lets lists skip empty notes in SQL.
    """
    if content_type != "html":
        return content if content.strip() else ""
    if _STRUCTURAL_MARKUP.search(content):
        return content
    text = _TAG.sub("", content).replace("&nbsp;", " ")
    return content if text.strip() else ""


def plain_text(note: WeeklyNote) -> str:
    """The note's visible text on one line, for previews."""
    if note.content_type == "html":
        text = BeautifulSoup(note.content, "html.parser").get_text(" ")
    else:
        text = note.content
    return _WHITESPACE.sub(" ", text).strip()


def preview(note: WeeklyNote) -> str:
    text = plain_text(note)
    if len(text) <= PREVIEW_LENGTH:
        return text
    return text[:PREVIEW_LENGTH] + "…"


def content_markdown(note: WeeklyNote) -> str:
    """The note as Markdown, as agents read context notes."""
    if note.content_type == "html":
        return note_html_to_markdown(note.content)
    return note.content


def get_note(
    session: Session,
    user_id: UUID,
    week_start: date,
    *,
    for_update: bool = False,
) -> WeeklyNote | None:
    statement = select(WeeklyNote).where(
        WeeklyNote.user_id == user_id, WeeklyNote.week_start == week_start
    )
    if for_update:
        statement = statement.with_for_update()
    return session.exec(statement).first()


def list_notes(
    session: Session,
    user_id: UUID,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    before: date | None = None,
    limit: int,
) -> tuple[list[WeeklyNote], bool]:
    """Non-empty notes, newest week first, and whether more remain.

    ``date_from`` and ``date_to`` bound ``week_start`` inclusively; ``before``
    keeps weeks that start before it (the cursor of the next page).
    """
    statement = select(WeeklyNote).where(
        WeeklyNote.user_id == user_id, WeeklyNote.content != ""
    )
    if date_from is not None:
        statement = statement.where(WeeklyNote.week_start >= date_from)
    if date_to is not None:
        statement = statement.where(WeeklyNote.week_start <= date_to)
    if before is not None:
        statement = statement.where(WeeklyNote.week_start < before)
    rows = list(
        session.exec(
            statement.order_by(col(WeeklyNote.week_start).desc()).limit(limit + 1)
        ).all()
    )
    return rows[:limit], len(rows) > limit


def week_payload(week_start: date) -> dict[str, Any]:
    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end_of(week_start).isoformat(),
    }
