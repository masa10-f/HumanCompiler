# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import base64
import json
from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.agent_pagination import (
    PageParams,
    decode_cursor,
    encode_cursor,
    page_params,
    paginate,
)
from humancompiler_api.models import Project

OWNER_ID = UUID("12345678-1234-1234-1234-123456789012")
BASE = datetime(2026, 1, 1, tzinfo=UTC)


def _b64(payload: Any) -> str:
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


BAD_CURSORS = [
    "",
    "!!!",
    _b64([]),
    _b64({"u": "2026-01-01T00:00:00+00:00"}),
    _b64({"u": "2026-01-01T00:00:00+00:00", "i": "nope"}),
    _b64({"u": "2026-01-01T00:00:00", "i": str(uuid4())}),
    _b64("[" * 20_000),
    _b64({"u": "0001-01-01T00:00:00+05:00", "i": str(uuid4())}),
    _b64({"u": "9999-12-31T23:59:59-05:00", "i": str(uuid4())}),
]


def test_cursor_round_trips():
    row_id = uuid4()
    updated_at = datetime(2026, 3, 4, 5, 6, 7, 891011, tzinfo=UTC)

    assert decode_cursor(encode_cursor(updated_at, row_id)) == (updated_at, row_id)

    decoded_at, decoded_id = decode_cursor(
        encode_cursor(updated_at.replace(tzinfo=None), row_id)
    )
    assert decoded_at == updated_at
    assert decoded_at.utcoffset() == timedelta(0)
    assert decoded_id == row_id


def test_cursor_normalizes_offset_to_utc():
    row_id = uuid4()
    jst = timezone(timedelta(hours=9))
    decoded_at, _ = decode_cursor(
        encode_cursor(datetime(2026, 1, 1, 9, tzinfo=jst), row_id)
    )
    assert decoded_at == BASE
    assert decoded_at.utcoffset() == timedelta(0)


@pytest.mark.parametrize("cursor", BAD_CURSORS)
def test_decode_cursor_rejects_garbage(cursor):
    with pytest.raises(ValueError):
        decode_cursor(cursor)


def _insert_projects(session: Session, stamps: list[datetime]) -> None:
    for i, stamp in enumerate(stamps):
        session.add(
            Project(
                id=uuid4(),
                owner_id=OWNER_ID,
                title=f"p{i}",
                created_at=stamp,
                updated_at=stamp,
            )
        )
    session.commit()


def _walk(
    session: Session, limit: int, updated_since: datetime | None = None
) -> list[list[Project]]:
    pages: list[list[Project]] = []
    after = None
    while True:
        rows, next_cursor = paginate(
            session,
            select(Project),
            Project,
            PageParams(updated_since=updated_since, after=after, limit=limit),
        )
        pages.append(rows)
        if next_cursor is None:
            return pages
        after = decode_cursor(next_cursor)
        assert len(pages) < 20


def test_pages_follow_updated_at_then_id_without_gaps_or_duplicates(session):
    same = BASE + timedelta(hours=2)
    _insert_projects(
        session,
        [
            BASE,
            same,
            same,
            same,
            BASE + timedelta(hours=1),
            BASE + timedelta(hours=3),
        ],
    )

    pages = _walk(session, limit=2)

    ids = [row.id for page in pages for row in page]
    assert len(ids) == 6
    assert len(set(ids)) == 6
    all_rows = session.exec(select(Project)).all()
    expected = [
        row.id
        for row in sorted(
            all_rows, key=lambda r: (r.updated_at.replace(tzinfo=None), r.id)
        )
    ]
    assert ids == expected
    assert [len(p) for p in pages] == [2, 2, 2]


def test_last_page_exactly_full_has_null_cursor(session):
    _insert_projects(session, [BASE + timedelta(minutes=i) for i in range(4)])

    first, first_cursor = paginate(
        session,
        select(Project),
        Project,
        PageParams(updated_since=None, after=None, limit=2),
    )
    assert len(first) == 2
    assert first_cursor is not None

    second, second_cursor = paginate(
        session,
        select(Project),
        Project,
        PageParams(updated_since=None, after=decode_cursor(first_cursor), limit=2),
    )
    assert len(second) == 2
    assert second_cursor is None


def test_updated_since_is_inclusive_and_offset_aware(session):
    _insert_projects(session, [BASE])

    def fetch(since: datetime) -> list[Project]:
        rows, _ = paginate(
            session,
            select(Project),
            Project,
            PageParams(updated_since=since, after=None, limit=10),
        )
        return rows

    jst = timezone(timedelta(hours=9))
    assert len(fetch(datetime(2026, 1, 1, 9, tzinfo=jst))) == 1
    assert fetch(datetime(2026, 1, 1, 0, 0, 0, 1, tzinfo=UTC)) == []


def build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/default")
    def default(
        params: Annotated[PageParams, Depends(page_params())],
    ) -> dict[str, Any]:
        return {
            "limit": params.limit,
            "updated_since": params.updated_since.isoformat()
            if params.updated_since
            else None,
            "after": params.after[1].hex if params.after else None,
        }

    @app.get("/custom")
    def custom(
        params: Annotated[PageParams, Depends(page_params(7, 31))],
    ) -> dict[str, int]:
        return {"limit": params.limit}

    return app


def test_page_params_normalizes_updated_since_to_utc():
    client = TestClient(build_app())
    response = client.get(
        "/default", params={"updated_since": "2026-01-01T09:00:00+09:00"}
    )
    assert response.status_code == 200
    assert response.json()["updated_since"] == "2026-01-01T00:00:00+00:00"


def test_page_params_rejects_naive_updated_since_with_422():
    client = TestClient(build_app())
    response = client.get("/default", params={"updated_since": "2026-01-01T00:00:00"})
    assert response.status_code == 422
    assert response.json()["detail"] == "updated_since must include a timezone"


@pytest.mark.parametrize(
    "updated_since", ["0001-01-01T00:00:00+05:00", "9999-12-31T23:59:59-05:00"]
)
def test_page_params_rejects_out_of_range_updated_since_with_422(updated_since):
    client = TestClient(build_app(), raise_server_exceptions=False)
    response = client.get("/default", params={"updated_since": updated_since})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("cursor", BAD_CURSORS)
def test_page_params_rejects_bad_cursor_with_422(cursor):
    client = TestClient(build_app(), raise_server_exceptions=False)
    response = client.get("/default", params={"cursor": cursor})
    assert response.status_code == 422


def test_page_params_accepts_valid_cursor():
    row_id = uuid4()
    client = TestClient(build_app())
    response = client.get("/default", params={"cursor": encode_cursor(BASE, row_id)})
    assert response.status_code == 200
    assert response.json()["after"] == row_id.hex


def test_page_params_limit_bounds():
    client = TestClient(build_app())
    assert client.get("/default").json()["limit"] == 100
    assert client.get("/default", params={"limit": 0}).status_code == 422
    assert client.get("/default", params={"limit": 201}).status_code == 422
    assert client.get("/default", params={"limit": 200}).status_code == 200

    assert client.get("/custom").json()["limit"] == 7
    assert client.get("/custom", params={"limit": 31}).status_code == 200
    assert client.get("/custom", params={"limit": 32}).status_code == 422
