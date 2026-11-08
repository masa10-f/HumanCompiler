# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly note endpoints for the web app.

One note per week, addressed by the week's Monday (``YYYY-MM-DD``). Reading a
week that has no note returns an empty note without creating a row; the first
save creates it.

Saves carry the ``updated_at`` the editor last read as ``expected_updated_at``,
as context notes do. A note changed since gives 409
``{message, current_updated_at}`` and writes nothing; leaving it out
overwrites (the editor's "overwrite" button).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from humancompiler_api import weekly_notes
from humancompiler_api.agent_write_service import (
    STALE_MESSAGE,
    check_expected_updated_at,
)
from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.models import WeeklyNote

router = APIRouter(prefix="/weekly-notes", tags=["weekly-notes"])

# The editor's HTML; generous, but bounded so one request cannot store megabytes.
MAX_CONTENT_LENGTH = 1_000_000
WEEK_START_DETAIL = "週の開始日（月曜日）を YYYY-MM-DD で指定してください"


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; they are UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class WeeklyNoteResponse(BaseModel):
    """A week's note. ``id`` and the timestamps are null until the first save."""

    id: UUID | None = None
    week_start: date
    week_end: date
    content: str = ""
    content_type: str = "html"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer("created_at", "updated_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        return _as_utc(value).isoformat() if value is not None else None


class WeeklyNoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(max_length=MAX_CONTENT_LENGTH)
    content_type: Literal["html", "markdown"] = "html"
    expected_updated_at: datetime | None = None


class WeeklyNoteSummary(BaseModel):
    week_start: date
    week_end: date
    updated_at: datetime
    preview: str

    @field_serializer("updated_at")
    def serialize_updated_at(self, value: datetime) -> str:
        return _as_utc(value).isoformat()


class WeeklyNoteListResponse(BaseModel):
    items: list[WeeklyNoteSummary]
    # Pass as ``before`` to read the next (older) page.
    next_cursor: date | None = None


def _week_start(value: date) -> date:
    if value.weekday() != 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, WEEK_START_DETAIL)
    return value


def _response(week_start: date, note: WeeklyNote | None) -> WeeklyNoteResponse:
    week_end = weekly_notes.week_end_of(week_start)
    if note is None:
        return WeeklyNoteResponse(week_start=week_start, week_end=week_end)
    return WeeklyNoteResponse(
        id=note.id,
        week_start=week_start,
        week_end=week_end,
        content=note.content,
        content_type=note.content_type,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _conflict(current: WeeklyNote | None) -> HTTPException:
    current_updated_at = (
        _as_utc(current.updated_at).isoformat() if current is not None else None
    )
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"message": STALE_MESSAGE, "current_updated_at": current_updated_at},
    )


@router.get("", response_model=WeeklyNoteListResponse)
async def list_weekly_notes(
    before: Annotated[
        date | None, Query(description="Only weeks that start before this date.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> WeeklyNoteListResponse:
    """Non-empty weekly notes, newest week first."""
    rows, has_more = weekly_notes.list_notes(
        session, UUID(str(user_id)), before=before, limit=limit
    )
    items = [
        WeeklyNoteSummary(
            week_start=row.week_start,
            week_end=weekly_notes.week_end_of(row.week_start),
            updated_at=row.updated_at,
            preview=weekly_notes.preview(row),
        )
        for row in rows
    ]
    return WeeklyNoteListResponse(
        items=items, next_cursor=items[-1].week_start if has_more else None
    )


@router.get("/{week_start}", response_model=WeeklyNoteResponse)
async def get_weekly_note(
    week_start: date,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> WeeklyNoteResponse:
    start = _week_start(week_start)
    return _response(start, weekly_notes.get_note(session, UUID(str(user_id)), start))


@router.put(
    "/{week_start}",
    response_model=WeeklyNoteResponse,
    responses={409: {"description": "The note changed since expected_updated_at"}},
)
async def update_weekly_note(
    week_start: date,
    request: WeeklyNoteUpdate,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> WeeklyNoteResponse:
    start = _week_start(week_start)
    owner_id = UUID(str(user_id))
    content = weekly_notes.normalize_content(request.content, request.content_type)
    try:
        # The row lock (a no-op on SQLite) keeps another save from landing
        # between the revision check and this write.
        note = weekly_notes.get_note(session, owner_id, start, for_update=True)
        if note is None:
            # The editor read a saved note that is gone (its user was reset).
            if request.expected_updated_at is not None:
                raise _conflict(None)
            note = WeeklyNote(user_id=owner_id, week_start=start)
        elif request.expected_updated_at is not None:
            check_expected_updated_at(note.updated_at, request.expected_updated_at)
        note.content = content
        note.content_type = request.content_type
        note.updated_at = datetime.now(UTC)
        session.add(note)
        session.commit()
    except IntegrityError as exc:
        # Another request created this week's note first.
        session.rollback()
        raise _conflict(weekly_notes.get_note(session, owner_id, start)) from exc
    except Exception:
        session.rollback()
        raise
    session.refresh(note)
    return _response(start, note)
