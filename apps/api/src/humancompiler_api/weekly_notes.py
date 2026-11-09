# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly notes: one free-form note per user and week.

A week is seven days from its first day, ``week_start``. Each user chooses the
weekday new weeks start on in the settings page (``user_settings.week_start_day``;
Sunday by default, as the web app shows weeks). "Today" is decided in Asia/Tokyo, as
the daily notes decide it.

A note keeps the week it was written for. After the user changes the setting,
older notes keep their own seven days, and only weeks without a note follow
the new setting. ``resolve_week`` finds the note for a day in that order.

The web router, the agent REST API and the MCP tools all read notes through
this module, so ownership and the empty-note rule are the same everywhere.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from humancompiler_api.models import UserSettings, WeeklyNote
from humancompiler_api.note_markdown_out import note_html_to_markdown

WeekStartDay = Literal[
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
]
# In date.weekday() order: 0 = Monday ... 6 = Sunday.
_BY_WEEKDAY: tuple[WeekStartDay, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
_BY_NAME: dict[str, WeekStartDay] = {name: name for name in _BY_WEEKDAY}
DEFAULT_WEEK_START_DAY: WeekStartDay = "sunday"
WEEK_START_LABELS: dict[WeekStartDay, str] = {
    "sunday": "日曜日",
    "monday": "月曜日",
    "tuesday": "火曜日",
    "wednesday": "水曜日",
    "thursday": "木曜日",
    "friday": "金曜日",
    "saturday": "土曜日",
}

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


def shift_days(value: date, days: int) -> date:
    """``value`` moved by ``days``, held at ``date.min`` / ``date.max``.

    Plain date arithmetic raises ``OverflowError`` past year 1 or 9999, which
    would turn a request for such a day into a 500.
    """
    try:
        return value + timedelta(days=days)
    except OverflowError:
        return date.min if days < 0 else date.max


def week_start_of(value: date, start_day: WeekStartDay) -> date:
    """The first day of the week that contains ``value``."""
    offset = (value.weekday() - _BY_WEEKDAY.index(start_day)) % 7
    return shift_days(value, -offset)


def week_end_of(week_start: date) -> date:
    """The last day of the week that starts on ``week_start``."""
    return shift_days(week_start, 6)


def today(now: datetime | None = None) -> date:
    """Today in Asia/Tokyo."""
    moment = now if now is not None else datetime.now(JST)
    return moment.astimezone(JST).date()


def get_week_start_day(session: Session, user_id: UUID) -> WeekStartDay:
    value = session.exec(
        select(UserSettings.week_start_day).where(UserSettings.user_id == user_id)
    ).first()
    return _BY_NAME.get(value or "", DEFAULT_WEEK_START_DAY)


def set_week_start_day(
    session: Session, user_id: UUID, start_day: WeekStartDay
) -> None:
    """Store the setting, creating the settings row if the user has none.

    Two first saves at once (two tabs) both find no row; the one that loses
    the unique ``user_id`` race retries and updates the row the other made.
    """
    for attempt in range(2):
        # The row lock (a no-op on SQLite) serializes saves to an existing row.
        settings = session.exec(
            select(UserSettings)
            .where(UserSettings.user_id == user_id)
            .with_for_update()
        ).one_or_none()
        if settings is None:
            # The id is set here, not by the column's server default, which
            # only PostgreSQL has.
            settings = UserSettings(id=uuid4(), user_id=user_id)
        settings.week_start_day = start_day
        settings.updated_at = datetime.now(UTC)
        session.add(settings)
        try:
            session.commit()
            return
        except IntegrityError:
            session.rollback()
            if attempt:
                raise


def resolve_week(
    session: Session, user_id: UUID, day: date
) -> tuple[date, WeeklyNote | None]:
    """The week that ``day`` belongs to for this user, and its note.

    In order: the note that starts on ``day``; the note of the week that
    contains ``day`` under the current setting; an older note whose seven days
    contain ``day`` (written before the setting changed). Without any, the week
    under the current setting, with no note.
    """
    exact = get_note(session, user_id, day)
    if exact is not None:
        return day, exact
    start = week_start_of(day, get_week_start_day(session, user_id))
    note = get_note(session, user_id, start)
    if note is not None:
        return start, note
    older = session.exec(
        select(WeeklyNote)
        .where(
            WeeklyNote.user_id == user_id,
            WeeklyNote.week_start >= shift_days(day, -6),
            WeeklyNote.week_start <= day,
        )
        .order_by(col(WeeklyNote.week_start).desc())
    ).first()
    if older is not None:
        return older.week_start, older
    return start, None


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

    A week is kept when its seven days overlap ``date_from``..``date_to``;
    ``before`` keeps weeks that start before it (the cursor of the next page).
    """
    statement = select(WeeklyNote).where(
        WeeklyNote.user_id == user_id, WeeklyNote.content != ""
    )
    if date_from is not None:
        statement = statement.where(WeeklyNote.week_start >= shift_days(date_from, -6))
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
