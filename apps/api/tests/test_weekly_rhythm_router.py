# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly rhythm (weekday template) API."""

from collections.abc import Iterator
from datetime import time
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    Project,
    ProjectStatus,
    TriageCapacitySettings,
    User,
    WeeklyRhythmBlock,
)

client = TestClient(app)


@pytest.fixture
def owner(session: Session) -> Iterator[dict]:
    user = User(id=uuid4(), email="rhythm@example.com")
    other = User(id=uuid4(), email="rhythm-other@example.com")
    phd = Project(
        id=uuid4(), owner_id=user.id, title="PhD", status=ProjectStatus.IN_PROGRESS
    )
    side = Project(
        id=uuid4(), owner_id=user.id, title="副業", status=ProjectStatus.IN_PROGRESS
    )
    life = Project(
        id=uuid4(), owner_id=user.id, title="Life", status=ProjectStatus.IN_PROGRESS
    )
    foreign = Project(
        id=uuid4(),
        owner_id=other.id,
        title="Other",
        status=ProjectStatus.IN_PROGRESS,
    )
    session.add_all([user, other, phd, side, life, foreign])
    session.commit()

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user_id] = lambda: user.id
    try:
        yield {
            "user": user,
            "phd": phd,
            "side": side,
            "life": life,
            "foreign": foreign,
        }
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_current_user_id, None)


def schedule(weekday, start, end, project=None, **extra):
    return {
        "weekday": weekday,
        "start": start,
        "end": end,
        "kind": "schedule",
        "project_id": str(project.id) if project else None,
        **extra,
    }


def experiment_day(weekday, data):
    """The proposed Mon-Wed day: PhD 8h, side job 2h, Life 0.5h."""
    return [
        schedule(weekday, "07:00", "08:00", data["phd"], work_type="focused_work"),
        schedule(weekday, "08:00", "09:00", data["phd"], work_type="study"),
        schedule(
            weekday,
            "09:00",
            "16:00",
            data["phd"],
            work_type="focused_work",
            title="実験",
            locked=True,
        ),
        {
            "weekday": weekday,
            "start": "12:00",
            "end": "13:00",
            "kind": "break",
            "title": "昼食",
        },
        schedule(weekday, "16:00", "18:00", data["side"], title="連絡対応"),
        schedule(weekday, "18:00", "18:30", data["life"], locked=True),
    ]


def test_empty_template(owner):
    response = client.get("/api/weekly-rhythm")

    assert response.status_code == 200
    body = response.json()
    assert body["blocks"] == []
    assert body["summary"]["total_schedule_minutes"] == 0
    assert body["summary"]["triage_allocation"] is None
    assert [day["weekday"] for day in body["summary"]["days"]] == list(range(7))


def test_replace_template_sorts_blocks_and_sums_projects(owner):
    blocks = experiment_day(2, owner) + experiment_day(0, owner)

    response = client.put("/api/weekly-rhythm", json={"blocks": blocks})

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(b["weekday"], b["start"]) for b in body["blocks"]][:3] == [
        (0, "07:00"),
        (0, "08:00"),
        (0, "09:00"),
    ]
    monday = body["summary"]["days"][0]
    # The 1h lunch break inside the 09:00-16:00 experiment line is not task time.
    assert monday == {
        "weekday": 0,
        "schedule_minutes": 630,
        "event_minutes": 0,
        "break_minutes": 60,
    }
    projects = {row["project_title"]: row for row in body["summary"]["projects"]}
    assert projects["PhD"]["minutes"] == 2 * 8 * 60
    assert projects["PhD"]["locked_minutes"] == 2 * 6 * 60
    assert projects["副業"]["minutes"] == 2 * 120
    assert projects["Life"]["locked_minutes"] == 2 * 30
    assert body["summary"]["total_schedule_minutes"] == 2 * 630


def test_replace_clears_previous_template(owner, session):
    client.put("/api/weekly-rhythm", json={"blocks": experiment_day(0, owner)})

    response = client.put("/api/weekly-rhythm", json={"blocks": []})

    assert response.status_code == 200
    assert response.json()["blocks"] == []
    assert session.exec(select(WeeklyRhythmBlock)).all() == []


def test_triage_allocation_uses_largest_remainder(owner):
    data = owner
    blocks = []
    for weekday in (0, 1, 2):
        blocks += experiment_day(weekday, data)
    for weekday in (3, 4):
        blocks += [
            schedule(weekday, "07:00", "12:00", data["phd"]),
            schedule(weekday, "13:00", "18:00", data["side"]),
            schedule(weekday, "18:00", "18:30", data["life"]),
        ]
    blocks += [
        schedule(5, "09:00", "12:30", data["phd"]),
        schedule(5, "18:00", "18:30", data["life"]),
        schedule(6, "09:00", "11:30", data["phd"]),
        schedule(6, "18:00", "18:30", data["life"]),
    ]

    body = client.put("/api/weekly-rhythm", json={"blocks": blocks}).json()

    # 40h / 16h / 3.5h of 59.5h.
    allocation = body["summary"]["triage_allocation"]
    assert body["summary"]["total_schedule_minutes"] == 3570
    assert allocation["effective_capacity_hours"] == 59.5
    assert allocation["project_allocations"] == {
        str(data["phd"].id): 67,
        str(data["side"].id): 27,
        str(data["life"].id): 6,
    }
    assert allocation["inbox_allocation_percent"] == 0


def test_lines_without_project_count_as_inbox(owner):
    blocks = [
        schedule(0, "09:00", "12:00", owner["phd"]),
        schedule(0, "13:00", "14:00", None),
    ]

    body = client.put("/api/weekly-rhythm", json={"blocks": blocks}).json()

    allocation = body["summary"]["triage_allocation"]
    assert allocation["project_allocations"] == {str(owner["phd"].id): 75}
    assert allocation["inbox_allocation_percent"] == 25
    assert body["summary"]["projects"][-1]["project_id"] is None


@pytest.mark.parametrize(
    ("block", "message"),
    [
        (
            {"weekday": 0, "start": "10:00", "end": "09:00"},
            "start must be before end",
        ),
        ({"weekday": 7, "start": "09:00", "end": "10:00"}, "less than or equal"),
        ({"weekday": 0, "start": "9:00", "end": "10:00"}, "HH:MM"),
        (
            {"weekday": 0, "start": "09:00", "end": "10:00", "kind": "event"},
            "need a title",
        ),
    ],
)
def test_rejects_invalid_blocks(owner, block, message):
    response = client.put("/api/weekly-rhythm", json={"blocks": [block]})

    assert response.status_code == 422
    assert message in response.text


def test_title_length_is_checked_after_trimming(owner):
    title = "実" * 200
    blocks = [
        {"weekday": 0, "start": "09:00", "end": "10:00", "title": f"  {title}  "},
        {"weekday": 0, "start": "10:00", "end": "11:00", "title": "   "},
    ]

    response = client.put("/api/weekly-rhythm", json={"blocks": blocks})

    assert response.status_code == 200, response.text
    assert [b["title"] for b in response.json()["blocks"]] == [title, None]


def test_rejects_titles_over_200_characters(owner):
    block = {"weekday": 0, "start": "09:00", "end": "10:00", "title": "a" * 201}

    response = client.put("/api/weekly-rhythm", json={"blocks": [block]})

    assert response.status_code == 422


def test_rejects_project_on_fixed_event(owner):
    block = {
        "weekday": 0,
        "start": "09:00",
        "end": "10:00",
        "kind": "event",
        "title": "会議",
        "project_id": str(owner["phd"].id),
    }

    response = client.put("/api/weekly-rhythm", json={"blocks": [block]})

    assert response.status_code == 422


def test_rejects_overlapping_schedule_lines(owner):
    blocks = [
        schedule(1, "09:00", "12:00", owner["phd"]),
        schedule(1, "11:00", "13:00", owner["side"]),
    ]

    response = client.put("/api/weekly-rhythm", json={"blocks": blocks})

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "火曜の予定枠 09:00-12:00 と 11:00-13:00 が重なっています"
    )


def test_adjacent_lines_and_events_inside_lines_are_allowed(owner):
    blocks = [
        schedule(1, "09:00", "12:00", owner["phd"]),
        schedule(1, "12:00", "13:00", owner["side"]),
        {
            "weekday": 1,
            "start": "10:00",
            "end": "10:30",
            "kind": "event",
            "title": "定例",
        },
    ]

    response = client.put("/api/weekly-rhythm", json={"blocks": blocks})

    assert response.status_code == 200
    assert response.json()["summary"]["days"][1]["schedule_minutes"] == 210


def test_rejects_projects_of_other_users(owner, session):
    client.put("/api/weekly-rhythm", json={"blocks": experiment_day(0, owner)})

    response = client.put(
        "/api/weekly-rhythm",
        json={"blocks": [schedule(0, "09:00", "10:00", owner["foreign"])]},
    )

    assert response.status_code == 400
    assert "プロジェクトが見つかりません" in response.json()["detail"]
    # The previous template is kept.
    assert len(session.exec(select(WeeklyRhythmBlock)).all()) == 6


def test_templates_are_per_user(owner, session):
    session.add(
        WeeklyRhythmBlock(
            user_id=owner["foreign"].owner_id,
            weekday=0,
            start_time=time(9),
            end_time=time(10),
            kind="schedule",
        )
    )
    session.commit()

    client.put("/api/weekly-rhythm", json={"blocks": []})

    assert response_blocks() == []
    assert len(session.exec(select(WeeklyRhythmBlock)).all()) == 1


def response_blocks():
    return client.get("/api/weekly-rhythm").json()["blocks"]


def test_apply_to_triage_keeps_buffer_and_other_settings(owner, session):
    session.add(
        TriageCapacitySettings(
            user_id=owner["user"].id,
            weekly_capacity_hours=Decimal("40.00"),
            meeting_buffer_hours=Decimal("2.50"),
            cadence_days=14,
            auto_generate_enabled=True,
            work_type_caps_json={"focused_work": 20},
            project_allocations_json={str(owner["life"].id): 100},
        )
    )
    session.commit()
    client.put(
        "/api/weekly-rhythm",
        json={
            "blocks": [
                schedule(0, "09:00", "15:00", owner["phd"]),
                schedule(0, "15:00", "17:00", owner["side"]),
            ]
        },
    )

    response = client.post("/api/weekly-rhythm/apply-to-triage")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["weekly_capacity_hours"] == 10.5
    assert body["meeting_buffer_hours"] == 2.5
    assert body["project_allocations"] == {
        str(owner["phd"].id): 75,
        str(owner["side"].id): 25,
    }
    assert body["inbox_allocation_percent"] == 0
    assert body["cadence_days"] == 14
    assert body["auto_generate_enabled"] is True
    assert body["work_type_caps"] == {"focused_work": 20.0}


def test_apply_to_triage_needs_schedule_lines(owner):
    client.put(
        "/api/weekly-rhythm",
        json={
            "blocks": [
                {
                    "weekday": 0,
                    "start": "12:00",
                    "end": "13:00",
                    "kind": "break",
                    "title": "昼食",
                }
            ]
        },
    )

    response = client.post("/api/weekly-rhythm/apply-to-triage")

    assert response.status_code == 400
    assert response.json()["detail"] == "週のリズムに予定枠がありません"


def test_apply_to_triage_rejects_projects_not_in_progress(owner, session):
    client.put(
        "/api/weekly-rhythm",
        json={"blocks": [schedule(0, "09:00", "10:00", owner["side"])]},
    )
    owner["side"].status = ProjectStatus.PAUSED
    session.add(owner["side"])
    session.commit()

    response = client.post("/api/weekly-rhythm/apply-to-triage")

    assert response.status_code == 400
    assert "副業" in response.json()["detail"]
