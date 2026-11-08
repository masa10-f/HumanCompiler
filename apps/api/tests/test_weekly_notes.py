# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly notes: the web API, the agent REST API and the week helpers."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlmodel import Session, select

from humancompiler_api import weekly_notes
from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentScope, WeeklyNote
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_user,
    seed_weekly_note,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

MONDAY = date(2026, 11, 2)
BASE = "/api/weekly-notes"


@pytest.fixture(autouse=True)
def weekly_env(session: Session) -> Iterator[None]:
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    app.dependency_overrides[get_current_user_id] = lambda: str(USER_A)
    yield
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user_id, None)


def stored(session: Session, user_id: UUID = USER_A) -> list[WeeklyNote]:
    session.expire_all()
    return list(
        session.exec(select(WeeklyNote).where(WeeklyNote.user_id == user_id)).all()
    )


# --- week helpers -----------------------------------------------------------------


def test_week_start_is_the_monday_of_the_iso_week():
    assert weekly_notes.week_start_of(date(2026, 11, 2)) == MONDAY
    assert weekly_notes.week_start_of(date(2026, 11, 8)) == MONDAY  # Sunday
    assert weekly_notes.week_start_of(date(2026, 11, 9)) == date(2026, 11, 9)
    assert weekly_notes.week_end_of(MONDAY) == date(2026, 11, 8)


def test_current_week_is_decided_in_tokyo():
    # Sunday 23:30 UTC is already Monday in Tokyo.
    late_sunday_utc = datetime(2026, 11, 8, 23, 30, tzinfo=UTC)
    assert weekly_notes.current_week_start(late_sunday_utc) == date(2026, 11, 9)
    assert weekly_notes.current_week_start(
        late_sunday_utc - timedelta(hours=15)
    ) == date(2026, 11, 2)


@pytest.mark.parametrize(
    ("content", "expected_empty"),
    [
        ("", True),
        ("<p></p>", True),
        ("<p>&nbsp; </p>", True),
        ("<p>Plan</p>", False),
        ("<hr>", False),
        ('<ul data-type="taskList"><li data-type="taskItem"></li></ul>', False),
    ],
)
def test_normalize_content_empties_notes_without_anything_to_show(
    content, expected_empty
):
    result = weekly_notes.normalize_content(content, "html")
    assert (result == "") is expected_empty
    if not expected_empty:
        assert result == content


# --- web API ----------------------------------------------------------------------


def test_get_week_without_note_is_empty_and_creates_nothing(session: Session):
    response = client.get(f"{BASE}/{MONDAY}")

    assert response.status_code == 200
    assert response.json() == {
        "id": None,
        "week_start": "2026-11-02",
        "week_end": "2026-11-08",
        "content": "",
        "content_type": "html",
        "created_at": None,
        "updated_at": None,
    }
    assert stored(session) == []


@pytest.mark.parametrize("day", ["2026-11-03", "2026-11-08"])
def test_week_must_be_addressed_by_its_monday(day):
    assert client.get(f"{BASE}/{day}").status_code == 400
    response = client.put(f"{BASE}/{day}", json={"content": "<p>x</p>"})
    assert response.status_code == 400
    assert "月曜日" in response.json()["detail"]


def test_first_save_creates_the_note_and_get_reads_it(session: Session):
    response = client.put(f"{BASE}/{MONDAY}", json={"content": "<p>今週の目標</p>"})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] is not None
    assert body["content"] == "<p>今週の目標</p>"
    assert body["updated_at"].endswith("+00:00")

    again = client.get(f"{BASE}/{MONDAY}").json()
    assert again["id"] == body["id"]
    assert again["content"] == "<p>今週の目標</p>"
    assert [note.week_start for note in stored(session)] == [MONDAY]


def test_save_with_current_updated_at_replaces_content(session: Session):
    first = client.put(f"{BASE}/{MONDAY}", json={"content": "<p>a</p>"}).json()

    response = client.put(
        f"{BASE}/{MONDAY}",
        json={"content": "<p>b</p>", "expected_updated_at": first["updated_at"]},
    )

    assert response.status_code == 200
    assert response.json()["content"] == "<p>b</p>"
    assert response.json()["id"] == first["id"]
    assert len(stored(session)) == 1


def test_stale_save_is_409_and_writes_nothing(session: Session):
    note = seed_weekly_note(
        session,
        USER_A,
        MONDAY,
        "<p>agent</p>",
        updated_at=datetime(2026, 11, 3, 9, 0, tzinfo=UTC),
    )

    response = client.put(
        f"{BASE}/{MONDAY}",
        json={
            "content": "<p>mine</p>",
            "expected_updated_at": "2026-11-03T08:00:00+00:00",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["current_updated_at"] == (
        "2026-11-03T09:00:00+00:00"
    )
    assert stored(session)[0].content == note.content


def test_save_expecting_a_note_that_is_missing_is_409(session: Session):
    response = client.put(
        f"{BASE}/{MONDAY}",
        json={"content": "<p>x</p>", "expected_updated_at": "2026-11-03T08:00:00Z"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["current_updated_at"] is None
    assert stored(session) == []


def test_save_without_expected_updated_at_overwrites(session: Session):
    seed_weekly_note(session, USER_A, MONDAY, "<p>old</p>")

    response = client.put(f"{BASE}/{MONDAY}", json={"content": "<p>new</p>"})

    assert response.status_code == 200
    assert stored(session)[0].content == "<p>new</p>"


def test_empty_editor_document_is_stored_as_empty(session: Session):
    client.put(f"{BASE}/{MONDAY}", json={"content": "<p>x</p>"})

    response = client.put(f"{BASE}/{MONDAY}", json={"content": "<p></p>"})

    assert response.status_code == 200
    assert response.json()["content"] == ""
    assert client.get(BASE).json()["items"] == []


@pytest.mark.parametrize(
    "body",
    [
        {"content": "<p>x</p>", "content_type": "tiptap_json"},
        {"content": "<p>x</p>", "week_start": "2026-11-02"},
        {"content": "x" * 1_000_001},
    ],
)
def test_invalid_bodies_are_422(body):
    assert client.put(f"{BASE}/{MONDAY}", json=body).status_code == 422


def test_other_users_notes_are_invisible(session: Session):
    seed_weekly_note(session, USER_B, MONDAY, "<p>secret</p>")

    assert client.get(f"{BASE}/{MONDAY}").json()["content"] == ""
    assert client.get(BASE).json()["items"] == []

    client.put(f"{BASE}/{MONDAY}", json={"content": "<p>mine</p>"})
    assert stored(session, USER_B)[0].content == "<p>secret</p>"


def test_list_is_newest_week_first_with_text_previews_and_pages(session: Session):
    for weeks_ago in range(3):
        seed_weekly_note(
            session,
            USER_A,
            MONDAY - timedelta(weeks=weeks_ago),
            f"<h2>Week {weeks_ago}</h2><p>振り返り<strong>メモ</strong></p>",
        )
    seed_weekly_note(session, USER_A, MONDAY - timedelta(weeks=3), "")

    first = client.get(BASE, params={"limit": 2}).json()

    assert [item["week_start"] for item in first["items"]] == [
        "2026-11-02",
        "2026-10-26",
    ]
    assert first["items"][0]["week_end"] == "2026-11-08"
    assert first["items"][0]["preview"] == "Week 0 振り返り メモ"
    assert first["next_cursor"] == "2026-10-26"

    second = client.get(
        BASE, params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    assert [item["week_start"] for item in second["items"]] == ["2026-10-19"]
    assert second["next_cursor"] is None


def test_long_preview_is_cut(session: Session):
    seed_weekly_note(session, USER_A, MONDAY, f"<p>{'あ' * 300}</p>")

    preview = client.get(BASE).json()["items"][0]["preview"]

    assert preview == "あ" * weekly_notes.PREVIEW_LENGTH + "…"


# --- agent REST API -----------------------------------------------------------------


def test_agent_list_needs_weekly_notes_read(session: Session):
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    response = client.get("/api/agent/v1/weekly-notes", headers=bearer(secret))

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing required scope: weekly_notes:read"


def test_agent_list_returns_own_notes_with_week_range(session: Session):
    secret = issue_token(session, USER_A, [AgentScope.WEEKLY_NOTES_READ])
    old = seed_weekly_note(
        session,
        USER_A,
        MONDAY - timedelta(weeks=2),
        "<p>old</p>",
        updated_at=datetime(2026, 10, 20, tzinfo=UTC),
    )
    current = seed_weekly_note(
        session,
        USER_A,
        MONDAY,
        "",
        updated_at=datetime(2026, 11, 3, tzinfo=UTC),
    )
    seed_weekly_note(session, USER_B, MONDAY, "<p>other</p>")

    everything = client.get("/api/agent/v1/weekly-notes", headers=bearer(secret))

    assert everything.status_code == 200
    items = everything.json()["items"]
    # Ordered by (updated_at, id); empty notes are included for sync.
    assert [item["id"] for item in items] == [str(old.id), str(current.id)]
    assert items[1] == {
        "id": str(current.id),
        "week_start": "2026-11-02",
        "week_end": "2026-11-08",
        "content": "",
        "content_type": "html",
        "created_at": "2026-11-03T00:00:00+00:00",
        "updated_at": "2026-11-03T00:00:00+00:00",
    }

    # A mid-week date_from includes the week that contains it.
    ranged = client.get(
        "/api/agent/v1/weekly-notes",
        params={"date_from": "2026-11-05", "date_to": "2026-11-30"},
        headers=bearer(secret),
    )
    assert [item["id"] for item in ranged.json()["items"]] == [str(current.id)]
