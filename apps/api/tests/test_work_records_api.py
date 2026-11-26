# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""GET /api/work-sessions/records: time logs and Runner sessions as one list."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.main import app
from humancompiler_api.models import Log, Task, WorkSession
from humancompiler_api.routers import work_sessions
from tests.agent_api_helpers import (
    client,
    seed_goal,
    seed_project,
    seed_task,
    seed_user,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
NOON = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def web_session(session: Session):
    seed_user(session, USER_A)
    seed_user(session, USER_B)

    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(USER_A), email="web-user@example.com")

    app.dependency_overrides[work_sessions.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    yield
    app.dependency_overrides.pop(work_sessions.get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def make_task(session: Session, owner: UUID = USER_A, title: str = "Task") -> Task:
    task = seed_task(session, seed_goal(session, seed_project(session, owner)))
    task.title = title
    session.add(task)
    session.commit()
    return task


def add_session(
    session: Session,
    task: Task,
    ended_at: datetime | None,
    *,
    user: UUID = USER_A,
    started_at: datetime | None = None,
    **fields,
) -> WorkSession:
    start = started_at or (ended_at or NOON) - timedelta(minutes=30)
    work_session = WorkSession(
        id=uuid4(),
        user_id=user,
        task_id=task.id,
        planned_checkout_at=start + timedelta(hours=1),
        started_at=start,
        ended_at=ended_at,
        created_at=start,
        updated_at=ended_at or start,
        **fields,
    )
    session.add(work_session)
    session.commit()
    return work_session


def add_log(
    session: Session,
    task: Task,
    created_at: datetime,
    *,
    work_session: WorkSession | None = None,
    minutes: int = 30,
    comment: str | None = None,
) -> Log:
    log = Log(
        id=uuid4(),
        task_id=task.id,
        actual_minutes=minutes,
        comment=comment,
        work_session_id=work_session.id if work_session else None,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(log)
    session.commit()
    return log


def records(**params) -> list[dict]:
    response = client.get("/api/work-sessions/records", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_runner_checkout_is_one_record(session: Session):
    task = make_task(session, title="Write the report")
    work_session = add_session(session, task, NOON, kpt_keep="Kept focus")
    log = add_log(session, task, NOON, work_session=work_session, minutes=45)

    (record,) = records()

    assert record["log"]["id"] == str(log.id)
    assert record["log"]["actual_minutes"] == 45
    assert record["log"]["work_session_id"] == str(work_session.id)
    assert record["session"]["id"] == str(work_session.id)
    assert record["session"]["kpt_keep"] == "Kept focus"
    assert record["task_id"] == str(task.id)
    assert record["task_title"] == "Write the report"
    assert record["goal_id"] == str(task.goal_id)
    assert record["project_id"] == str(task.goal.project_id)
    assert datetime.fromisoformat(record["at"]) == NOON


def test_a_time_entered_by_hand_is_a_record_without_a_session(session: Session):
    task = make_task(session)
    log = add_log(session, task, NOON, comment="Read the papers")

    (record,) = records()

    assert record["log"]["id"] == str(log.id)
    assert record["log"]["comment"] == "Read the papers"
    assert record["session"] is None


def test_a_session_without_a_log_is_a_record_of_its_own(session: Session):
    task = make_task(session)
    running = add_session(session, task, None, started_at=NOON)
    orphan = add_session(session, task, NOON - timedelta(hours=3))

    running_record, orphan_record = records()

    # A running session is placed by its start, an ended one by its end.
    assert running_record["session"]["id"] == str(running.id)
    assert running_record["log"] is None
    assert datetime.fromisoformat(running_record["at"]) == NOON
    assert orphan_record["session"]["id"] == str(orphan.id)
    assert orphan_record["log"] is None
    assert datetime.fromisoformat(orphan_record["at"]) == NOON - timedelta(hours=3)


def test_records_of_both_kinds_are_in_one_order_newest_first(session: Session):
    first_task = make_task(session, title="First")
    second_task = make_task(session, title="Second")
    old_session = add_session(session, first_task, NOON - timedelta(hours=4))
    old_log = add_log(
        session, first_task, NOON - timedelta(hours=4), work_session=old_session
    )
    manual = add_log(session, second_task, NOON - timedelta(hours=2))
    orphan = add_session(session, second_task, NOON - timedelta(hours=1))
    newest = add_log(session, first_task, NOON)

    listed = records()

    assert [
        (record["log"] or {}).get("id") or record["session"]["id"] for record in listed
    ] == [str(newest.id), str(orphan.id), str(manual.id), str(old_log.id)]
    assert [record["task_title"] for record in listed] == [
        "First",
        "Second",
        "Second",
        "First",
    ]


def test_skip_and_limit_page_through_both_kinds_together(session: Session):
    task = make_task(session)
    stamps = [NOON - timedelta(hours=index) for index in range(6)]
    # Logs and sessions alternate in time: log, session, log, session, ...
    expected = []
    for index, stamp in enumerate(stamps):
        if index % 2 == 0:
            expected.append(str(add_log(session, task, stamp).id))
        else:
            expected.append(str(add_session(session, task, stamp).id))

    def ids(listed: list[dict]) -> list[str]:
        return [
            record["log"]["id"] if record["log"] else record["session"]["id"]
            for record in listed
        ]

    assert ids(records(limit=4)) == expected[:4]
    assert ids(records(skip=2, limit=3)) == expected[2:5]
    assert ids(records(skip=5, limit=3)) == expected[5:]
    assert records(skip=6) == []


def test_other_users_work_is_not_listed(session: Session):
    mine = make_task(session, title="Mine")
    theirs = make_task(session, owner=USER_B, title="Theirs")
    add_log(session, mine, NOON)
    their_session = add_session(session, theirs, NOON, user=USER_B)
    add_log(session, theirs, NOON, work_session=their_session)
    add_session(session, theirs, NOON - timedelta(hours=1), user=USER_B)

    listed = records()

    assert [record["task_title"] for record in listed] == ["Mine"]


def test_limit_is_bounded():
    assert client.get("/api/work-sessions/records?limit=0").status_code == 422
    assert client.get("/api/work-sessions/records?limit=101").status_code == 422
