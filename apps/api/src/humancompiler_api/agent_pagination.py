# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Keyset pagination shared by the agent read-only API.

Rows are ordered by ``(updated_at, id)`` ascending. ``updated_since`` is an
inclusive lower bound on ``updated_at``; ``cursor`` is an opaque token that
resumes strictly after the last row of the previous page.
"""

import base64
import binascii
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Generic, TypeVar
from uuid import UUID

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlmodel import Session
from sqlmodel.sql.expression import SelectOfScalar

DEFAULT_LIMIT = 100
MAX_LIMIT = 200

ItemT = TypeVar("ItemT")


def _to_utc(value: datetime) -> datetime:
    """Return an aware UTC datetime; naive values are taken to be UTC.

    SQLite returns naive datetimes while PostgreSQL returns aware ones.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def encode_cursor(updated_at: datetime, row_id: UUID) -> str:
    payload = {"u": _to_utc(updated_at).isoformat(), "i": str(row_id)}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Decode a cursor, raising ``ValueError`` if it is malformed."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise ValueError("Invalid cursor") from exc
    if not isinstance(payload, dict):
        raise ValueError("Invalid cursor")
    raw_at, raw_id = payload.get("u"), payload.get("i")
    if not isinstance(raw_at, str) or not isinstance(raw_id, str):
        raise ValueError("Invalid cursor")
    updated_at = datetime.fromisoformat(raw_at)
    if updated_at.tzinfo is None:
        raise ValueError("Cursor timestamp must include a timezone")
    return updated_at.astimezone(UTC), UUID(raw_id)


@dataclass(frozen=True)
class PageParams:
    """Validated paging parameters; datetimes are aware UTC."""

    updated_since: datetime | None
    after: tuple[datetime, UUID] | None
    limit: int


def page_params(
    default_limit: int = DEFAULT_LIMIT, max_limit: int = MAX_LIMIT
) -> Callable[..., PageParams]:
    """Build a FastAPI dependency that parses ``updated_since``, ``cursor``, ``limit``."""

    def dependency(
        updated_since: Annotated[
            datetime | None,
            Query(
                description=(
                    "ISO 8601 timestamp with a timezone. Only rows with "
                    "updated_at >= this value are returned."
                )
            ),
        ] = None,
        cursor: Annotated[
            str | None,
            Query(description="Opaque token from a previous page's next_cursor."),
        ] = None,
        limit: Annotated[
            int, Query(ge=1, le=max_limit, description="Maximum rows per page.")
        ] = default_limit,
    ) -> PageParams:
        since: datetime | None = None
        if updated_since is not None:
            if updated_since.tzinfo is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "updated_since must include a timezone",
                )
            since = _to_utc(updated_since)
        after: tuple[datetime, UUID] | None = None
        if cursor is not None:
            try:
                after = decode_cursor(cursor)
            except ValueError:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid cursor"
                ) from None
        return PageParams(updated_since=since, after=after, limit=limit)

    return dependency


def paginate(
    session: Session,
    statement: SelectOfScalar[Any],
    model: Any,
    params: PageParams,
) -> tuple[list[Any], str | None]:
    """Run ``statement`` as one keyset page ordered by ``(updated_at, id)``.

    One extra row is read to tell whether another page exists, so a final page
    that is exactly full does not produce a cursor to an empty page.
    """
    if params.updated_since is not None:
        statement = statement.where(model.updated_at >= params.updated_since)
    if params.after is not None:
        after_at, after_id = params.after
        statement = statement.where(
            or_(
                model.updated_at > after_at,
                and_(model.updated_at == after_at, model.id > after_id),
            )
        )
    statement = statement.order_by(model.updated_at, model.id).limit(params.limit + 1)

    rows = list(session.exec(statement).all())
    if len(rows) <= params.limit:
        return rows, None
    rows = rows[: params.limit]
    last = rows[-1]
    return rows, encode_cursor(last.updated_at, last.id)


class AgentPage(BaseModel, Generic[ItemT]):
    """Response envelope for list endpoints."""

    items: list[ItemT]
    next_cursor: str | None = None
