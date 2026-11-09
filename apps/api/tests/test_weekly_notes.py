# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly notes: the web API, the agent REST API and the week helpers."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api import weekly_notes
from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentScope, UserSettings, WeeklyNote
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

SUNDAY = date(2026, 11, 1)
BASE = "/api/weekly-notes"
WEEK_START = "/api/user/settings/week-start"


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


def set_week_start(day: str) -> None:
    response = client.put(WEEK_START, json={"week_start_day": day})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("day", "sunday_start", "monday_start"),
    [
        (date(2026, 11, 1), date(2026, 11, 1), date(2026, 10, 26)),  # Sunday
        (date(2026, 11, 2), date(2026, 11, 1), date(2026, 11, 2)),  # Monday
        (date(2026, 11, 7), date(2026, 11, 1), date(2026, 11, 2)),  # Saturday
        (date(2027, 1, 1), date(2026, 12, 27), date(2026, 12, 28)),
    ],
)
def test_week_start_of_follows_the_start_day(day, sunday_start, monday_start):
    assert weekly_notes.week_start_of(day, "sunday") == sunday_start
    assert weekly_notes.week_start_of(day, "monday") == monday_start
    assert weekly_notes.week_end_of(sunday_start) == sunday_start + timedelta(days=6)


@pytest.mark.parametrize(
    ("start_day", "expected"),
    [
        ("sunday", date(2026, 11, 1)),
        ("monday", date(2026, 11, 2)),
        ("tuesday", date(2026, 11, 3)),
        ("wednesday", date(2026, 11, 4)),
        ("thursday", date(2026, 10, 29)),
        ("friday", date(2026, 10, 30)),
        ("saturday", date(2026, 10, 31)),
    ],
)
def test_any_weekday_can_start_the_week(start_day, expected):
    # Wednesday 2026-11-04 is in the week that starts on the last such weekday.
    start = weekly_notes.week_start_of(date(2026, 11, 4), start_day)
    assert start == expected
    assert start <= date(2026, 11, 4) <= weekly_notes.week_end_of(start)


def test_date_shifts_stop_at_the_ends_of_the_calendar():
    assert weekly_notes.shift_days(date.min, -6) == date.min
    assert weekly_notes.shift_days(date.max, 6) == date.max
    assert weekly_notes.shift_days(date(2026, 11, 1), 6) == date(2026, 11, 7)


@pytest.mark.parametrize("day", ["0001-01-01", "0001-01-03", "9999-12-31"])
def test_days_at_the_ends_of_the_calendar_are_not_errors(session: Session, day):
    assert client.get(f"{BASE}/{day}").status_code == 200
    secret = issue_token(session, USER_A, [AgentScope.WEEKLY_NOTES_READ])
    response = client.get(
        "/api/agent/v1/weekly-notes",
        params={"date_from": day},
        headers=bearer(secret),
    )
    assert response.status_code == 200


def test_today_is_decided_in_tokyo():
    # Saturday 15:30 UTC is already Sunday in Tokyo.
    assert weekly_notes.today(datetime(2026, 11, 7, 15, 30, tzinfo=UTC)) == date(
        2026, 11, 8
    )
    assert weekly_notes.today(datetime(2026, 11, 7, 14, 30, tzinfo=UTC)) == date(
        2026, 11, 7
    )


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
    response = client.get(f"{BASE}/{SUNDAY}")

    assert response.status_code == 200
    assert response.json() == {
        "id": None,
        "week_start": "2026-11-01",
        "week_end": "2026-11-07",
        "content": "",
        "content_type": "html",
        "created_at": None,
        "updated_at": None,
    }
    assert stored(session) == []


@pytest.mark.parametrize("day", ["2026-11-01", "2026-11-04", "2026-11-07"])
def test_any_day_reads_its_week(day):
    body = client.get(f"{BASE}/{day}").json()

    assert (body["week_start"], body["week_end"]) == ("2026-11-01", "2026-11-07")


@pytest.mark.parametrize("day", ["2026-11-02", "2026-11-07"])
def test_a_new_note_must_start_on_the_first_day_of_a_week(session: Session, day):
    response = client.put(f"{BASE}/{day}", json={"content": "<p>x</p>"})

    assert response.status_code == 400
    assert "日曜日" in response.json()["detail"]
    assert stored(session) == []


# --- week start preference --------------------------------------------------------


def test_week_starts_on_sunday_by_default(session: Session):
    assert client.get(WEEK_START).json() == {"week_start_day": "sunday"}


def test_monday_start_is_stored_per_user(session: Session):
    set_week_start("monday")

    assert client.get(WEEK_START).json() == {"week_start_day": "monday"}
    settings = session.exec(
        select(UserSettings).where(UserSettings.user_id == USER_A)
    ).one()
    assert settings.week_start_day == "monday"
    body = client.get(f"{BASE}/2026-11-04").json()
    assert (body["week_start"], body["week_end"]) == ("2026-11-02", "2026-11-08")
    assert (
        client.put(f"{BASE}/2026-11-02", json={"content": "<p>x</p>"}).status_code
        == 200
    )
    response = client.put(f"{BASE}/2026-11-08", json={"content": "<p>x</p>"})
    assert response.status_code == 400
    assert "月曜日" in response.json()["detail"]

    # Another user keeps the default.
    app.dependency_overrides[get_current_user_id] = lambda: str(USER_B)
    assert client.get(WEEK_START).json() == {"week_start_day": "sunday"}
    assert client.get(f"{BASE}/2026-11-04").json()["week_start"] == "2026-11-01"


def test_a_mid_week_start_day_works_end_to_end(session: Session):
    set_week_start("wednesday")

    body = client.get(f"{BASE}/2026-11-09").json()  # Monday
    assert (body["week_start"], body["week_end"]) == ("2026-11-04", "2026-11-10")
    assert (
        client.put(f"{BASE}/2026-11-04", json={"content": "<p>x</p>"}).status_code
        == 200
    )
    response = client.put(f"{BASE}/2026-11-11", json={"content": "<p>x</p>"})
    assert response.status_code == 200  # 2026-11-11 is the next Wednesday
    response = client.put(f"{BASE}/2026-11-12", json={"content": "<p>x</p>"})
    assert response.status_code == 400
    assert "水曜日" in response.json()["detail"]


def test_saving_the_week_start_updates_updated_at(session: Session):
    set_week_start("monday")
    first = session.exec(
        select(UserSettings).where(UserSettings.user_id == USER_A)
    ).one()
    first_stamp = first.updated_at

    set_week_start("friday")

    session.expire_all()
    again = session.exec(
        select(UserSettings).where(UserSettings.user_id == USER_A)
    ).one()
    assert again.week_start_day == "friday"
    assert again.updated_at is not None and first_stamp is not None
    assert again.updated_at > first_stamp


def test_a_first_save_that_loses_the_insert_race_updates_the_winners_row(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    # Another request created the row after this one looked and found none.
    session.add(UserSettings(id=uuid4(), user_id=USER_A, week_start_day="sunday"))
    session.commit()
    real_exec = session.exec
    calls = {"n": 0}

    class Missing:
        def one_or_none(self):
            return None

    def exec_missing_once(statement, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return Missing()
        return real_exec(statement, *args, **kwargs)

    monkeypatch.setattr(session, "exec", exec_missing_once)

    weekly_notes.set_week_start_day(session, USER_A, "thursday")

    monkeypatch.setattr(session, "exec", real_exec)
    session.expire_all()
    rows = session.exec(
        select(UserSettings).where(UserSettings.user_id == USER_A)
    ).all()
    assert [row.week_start_day for row in rows] == ["thursday"]


@pytest.mark.parametrize(
    "body", [{"week_start_day": "funday"}, {"week_start_day": 3}, {}]
)
def test_invalid_week_start_is_422(body):
    assert client.put(WEEK_START, json=body).status_code == 422


def test_notes_keep_their_days_after_the_setting_changes(session: Session):
    old = seed_weekly_note(session, USER_A, SUNDAY, "<p>日曜始まりの週</p>")
    set_week_start("monday")

    # A day of the old note's week still opens it, with its own seven days.
    for day in ("2026-11-01", "2026-11-04", "2026-11-07"):
        body = client.get(f"{BASE}/{day}").json()
        assert body["id"] == str(old.id), day
        assert (body["week_start"], body["week_end"]) == ("2026-11-01", "2026-11-07")
    # It can still be edited on its own first day.
    assert (
        client.put(f"{BASE}/2026-11-01", json={"content": "<p>追記</p>"}).status_code
        == 200
    )

    # Weeks without a note follow the new setting.
    body = client.get(f"{BASE}/2026-11-10").json()
    assert (body["id"], body["week_start"]) == (None, "2026-11-09")
    body = client.get(f"{BASE}/2026-10-27").json()
    assert (body["id"], body["week_start"]) == (None, "2026-10-26")


def test_a_note_under_the_current_setting_wins_over_an_older_one(session: Session):
    sunday_note = seed_weekly_note(session, USER_A, SUNDAY, "<p>old</p>")
    set_week_start("monday")
    monday_note = seed_weekly_note(session, USER_A, date(2026, 11, 2), "<p>new</p>")

    assert client.get(f"{BASE}/2026-11-04").json()["id"] == str(monday_note.id)
    # The note that starts on the day asked for comes first.
    assert client.get(f"{BASE}/2026-11-01").json()["id"] == str(sunday_note.id)


def test_first_save_creates_the_note_and_get_reads_it(session: Session):
    response = client.put(f"{BASE}/{SUNDAY}", json={"content": "<p>今週の目標</p>"})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] is not None
    assert body["content"] == "<p>今週の目標</p>"
    assert body["updated_at"].endswith("+00:00")

    again = client.get(f"{BASE}/{SUNDAY}").json()
    assert again["id"] == body["id"]
    assert again["content"] == "<p>今週の目標</p>"
    assert [note.week_start for note in stored(session)] == [SUNDAY]


def test_save_with_current_updated_at_replaces_content(session: Session):
    first = client.put(f"{BASE}/{SUNDAY}", json={"content": "<p>a</p>"}).json()

    response = client.put(
        f"{BASE}/{SUNDAY}",
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
        SUNDAY,
        "<p>agent</p>",
        updated_at=datetime(2026, 11, 3, 9, 0, tzinfo=UTC),
    )

    response = client.put(
        f"{BASE}/{SUNDAY}",
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
        f"{BASE}/{SUNDAY}",
        json={"content": "<p>x</p>", "expected_updated_at": "2026-11-03T08:00:00Z"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["current_updated_at"] is None
    assert stored(session) == []


def test_first_save_expecting_a_new_note_creates_it(session: Session):
    response = client.put(
        f"{BASE}/{SUNDAY}", json={"content": "<p>a</p>", "expect_new": True}
    )

    assert response.status_code == 200
    assert [note.content for note in stored(session)] == ["<p>a</p>"]


def test_first_save_does_not_overwrite_a_note_another_tab_created(session: Session):
    # Tabs A and B opened the empty week; B saved first.
    other_tab = seed_weekly_note(
        session,
        USER_A,
        SUNDAY,
        "<p>B</p>",
        updated_at=datetime(2026, 11, 3, 9, 0, tzinfo=UTC),
    )

    response = client.put(
        f"{BASE}/{SUNDAY}", json={"content": "<p>A</p>", "expect_new": True}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["current_updated_at"] == (
        "2026-11-03T09:00:00+00:00"
    )
    assert stored(session)[0].content == other_tab.content


def test_expect_new_and_expected_updated_at_together_are_422():
    response = client.put(
        f"{BASE}/{SUNDAY}",
        json={
            "content": "<p>x</p>",
            "expect_new": True,
            "expected_updated_at": "2026-11-03T09:00:00Z",
        },
    )

    assert response.status_code == 422


def test_save_without_expected_updated_at_overwrites(session: Session):
    seed_weekly_note(session, USER_A, SUNDAY, "<p>old</p>")

    response = client.put(f"{BASE}/{SUNDAY}", json={"content": "<p>new</p>"})

    assert response.status_code == 200
    assert stored(session)[0].content == "<p>new</p>"


def test_empty_editor_document_is_stored_as_empty(session: Session):
    client.put(f"{BASE}/{SUNDAY}", json={"content": "<p>x</p>"})

    response = client.put(f"{BASE}/{SUNDAY}", json={"content": "<p></p>"})

    assert response.status_code == 200
    assert response.json()["content"] == ""
    assert client.get(BASE).json()["items"] == []


@pytest.mark.parametrize(
    "body",
    [
        {"content": "<p>x</p>", "content_type": "tiptap_json"},
        {"content": "<p>x</p>", "week_start": "2026-11-01"},
        {"content": "x" * 1_000_001},
    ],
)
def test_invalid_bodies_are_422(body):
    assert client.put(f"{BASE}/{SUNDAY}", json=body).status_code == 422


def test_other_users_notes_are_invisible(session: Session):
    seed_weekly_note(session, USER_B, SUNDAY, "<p>secret</p>")

    assert client.get(f"{BASE}/{SUNDAY}").json()["content"] == ""
    assert client.get(BASE).json()["items"] == []

    client.put(f"{BASE}/{SUNDAY}", json={"content": "<p>mine</p>"})
    assert stored(session, USER_B)[0].content == "<p>secret</p>"


def test_list_is_newest_week_first_with_text_previews_and_pages(session: Session):
    for weeks_ago in range(3):
        seed_weekly_note(
            session,
            USER_A,
            SUNDAY - timedelta(weeks=weeks_ago),
            f"<h2>Week {weeks_ago}</h2><p>振り返り<strong>メモ</strong></p>",
        )
    seed_weekly_note(session, USER_A, SUNDAY - timedelta(weeks=3), "")

    first = client.get(BASE, params={"limit": 2}).json()

    assert [item["week_start"] for item in first["items"]] == [
        "2026-11-01",
        "2026-10-25",
    ]
    assert first["items"][0]["week_end"] == "2026-11-07"
    assert first["items"][0]["preview"] == "Week 0 振り返り メモ"
    assert first["next_cursor"] == "2026-10-25"

    second = client.get(
        BASE, params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    assert [item["week_start"] for item in second["items"]] == ["2026-10-18"]
    assert second["next_cursor"] is None


def test_long_preview_is_cut(session: Session):
    seed_weekly_note(session, USER_A, SUNDAY, f"<p>{'あ' * 300}</p>")

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
        SUNDAY - timedelta(weeks=2),
        "<p>old</p>",
        updated_at=datetime(2026, 10, 20, tzinfo=UTC),
    )
    current = seed_weekly_note(
        session,
        USER_A,
        SUNDAY,
        "",
        updated_at=datetime(2026, 11, 3, tzinfo=UTC),
    )
    seed_weekly_note(session, USER_B, SUNDAY, "<p>other</p>")

    everything = client.get("/api/agent/v1/weekly-notes", headers=bearer(secret))

    assert everything.status_code == 200
    items = everything.json()["items"]
    # Ordered by (updated_at, id); empty notes are included for sync.
    assert [item["id"] for item in items] == [str(old.id), str(current.id)]
    assert items[1] == {
        "id": str(current.id),
        "week_start": "2026-11-01",
        "week_end": "2026-11-07",
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
