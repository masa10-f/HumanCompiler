# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event
from sqlmodel import Session

from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentScope,
    DailyPlanDocument,
    LogUpdate,
    Schedule,
    TaskStatus,
)
from humancompiler_api.routers.agent_v1 import _calendar_date
from humancompiler_api.services import log_service
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_daily_plan,
    seed_goal,
    seed_log,
    seed_note,
    seed_project,
    seed_quick_task,
    seed_schedule,
    seed_task,
    seed_user,
    seed_work_session,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


@pytest.fixture(autouse=True)
def agent_session(session: Session):
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def _seed_task_for(session: Session, owner_id: UUID):
    return seed_task(session, seed_goal(session, seed_project(session, owner_id)))


def test_list_quick_tasks_returns_only_own_and_filters_by_status(session: Session):
    pending = seed_quick_task(session, USER_A)
    done = seed_quick_task(session, USER_A, status=TaskStatus.COMPLETED)
    seed_quick_task(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.QUICK_TASKS_READ])

    response = client.get("/api/agent/v1/quick-tasks", headers=bearer(secret))

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {
        str(pending.id),
        str(done.id),
    }

    filtered = client.get(
        "/api/agent/v1/quick-tasks",
        headers=bearer(secret),
        params={"status": "completed"},
    )

    assert [item["id"] for item in filtered.json()["items"]] == [str(done.id)]


def test_list_logs_returns_only_own_and_filters_by_task(session: Session):
    task_1 = _seed_task_for(session, USER_A)
    task_2 = _seed_task_for(session, USER_A)
    log_1 = seed_log(session, task_1)
    log_2 = seed_log(session, task_2)
    seed_log(session, _seed_task_for(session, USER_B))
    secret = issue_token(session, USER_A, [AgentScope.LOGS_READ])

    response = client.get("/api/agent/v1/logs", headers=bearer(secret))

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {
        str(log_1.id),
        str(log_2.id),
    }

    filtered = client.get(
        "/api/agent/v1/logs", headers=bearer(secret), params={"task_id": str(task_1.id)}
    )

    assert [item["id"] for item in filtered.json()["items"]] == [str(log_1.id)]


def test_list_work_sessions_returns_only_own_and_filters_by_task(session: Session):
    task_1 = _seed_task_for(session, USER_A)
    task_2 = _seed_task_for(session, USER_A)
    ws_1 = seed_work_session(session, USER_A, task_1)
    ws_2 = seed_work_session(session, USER_A, task_2)
    seed_work_session(session, USER_B, _seed_task_for(session, USER_B))
    secret = issue_token(session, USER_A, [AgentScope.WORK_SESSIONS_READ])

    response = client.get("/api/agent/v1/work-sessions", headers=bearer(secret))

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["id"] for item in items} == {str(ws_1.id), str(ws_2.id)}
    for item in items:
        assert item["task"]["id"] == item["task_id"]

    filtered = client.get(
        "/api/agent/v1/work-sessions",
        headers=bearer(secret),
        params={"task_id": str(task_2.id)},
    )

    assert [item["id"] for item in filtered.json()["items"]] == [str(ws_2.id)]


def test_task_filters_with_other_users_task_return_empty(session: Session):
    others_task = _seed_task_for(session, USER_B)
    seed_log(session, others_task)
    seed_work_session(session, USER_B, others_task)
    secret = issue_token(
        session, USER_A, [AgentScope.LOGS_READ, AgentScope.WORK_SESSIONS_READ]
    )

    for path in ("/api/agent/v1/logs", "/api/agent/v1/work-sessions"):
        response = client.get(
            path, headers=bearer(secret), params={"task_id": str(others_task.id)}
        )
        assert response.status_code == 200
        assert response.json()["items"] == []


def test_edited_log_appears_in_incremental_sync(session: Session):
    task = _seed_task_for(session, USER_A)
    log = seed_log(session, task, updated_at=datetime(2026, 1, 1, tzinfo=UTC))
    secret = issue_token(session, USER_A, [AgentScope.LOGS_READ])
    params = {"updated_since": "2026-01-02T00:00:00Z"}

    before = client.get("/api/agent/v1/logs", headers=bearer(secret), params=params)
    assert before.json()["items"] == []

    log_service.update_log(session, log.id, USER_A, LogUpdate(comment="Edited"))
    session.commit()

    after = client.get("/api/agent/v1/logs", headers=bearer(secret), params=params)
    assert [item["id"] for item in after.json()["items"]] == [str(log.id)]


@pytest.mark.parametrize(
    "path, scope",
    [
        ("/api/agent/v1/quick-tasks", "quick_tasks:read"),
        ("/api/agent/v1/logs", "logs:read"),
        ("/api/agent/v1/work-sessions", "work_sessions:read"),
        ("/api/agent/v1/context-notes", "notes:read"),
    ],
)
def test_record_lists_require_their_scopes(session: Session, path: str, scope: str):
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(path, headers=bearer(secret))

    assert response.status_code == 403
    assert response.json()["detail"] == f"Missing required scope: {scope}"


def test_list_notes_returns_only_own_and_filters_by_parent(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    task = seed_task(session, goal)
    project_note = seed_note(session, USER_A, project=project)
    goal_note = seed_note(session, USER_A, goal=goal)
    task_note = seed_note(session, USER_A, task=task)
    other_project = seed_project(session, USER_B)
    seed_note(session, USER_B, project=other_project)
    secret = issue_token(session, USER_A, [AgentScope.NOTES_READ])

    response = client.get("/api/agent/v1/context-notes", headers=bearer(secret))

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {
        str(project_note.id),
        str(goal_note.id),
        str(task_note.id),
    }

    for key, parent, expected in (
        ("project_id", project, project_note),
        ("goal_id", goal, goal_note),
        ("task_id", task, task_note),
    ):
        filtered = client.get(
            "/api/agent/v1/context-notes",
            headers=bearer(secret),
            params={key: str(parent.id)},
        )
        assert [item["id"] for item in filtered.json()["items"]] == [str(expected.id)]


def test_note_with_foreign_parent_is_not_returned(session: Session):
    others_project = seed_project(session, USER_B)
    others_goal = seed_goal(session, others_project)
    others_task = seed_task(session, others_goal)
    seed_note(session, USER_A, project=others_project)
    seed_note(session, USER_A, goal=others_goal)
    seed_note(session, USER_A, task=others_task)
    secret = issue_token(session, USER_A, [AgentScope.NOTES_READ])

    response = client.get("/api/agent/v1/context-notes", headers=bearer(secret))

    assert response.status_code == 200
    assert response.json()["items"] == []

    filtered = client.get(
        "/api/agent/v1/context-notes",
        headers=bearer(secret),
        params={"project_id": str(others_project.id)},
    )

    assert filtered.json()["items"] == []


def test_note_without_parent_is_returned_to_its_owner_only(session: Session):
    own = seed_note(session, USER_A)
    seed_note(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.NOTES_READ])

    response = client.get("/api/agent/v1/context-notes", headers=bearer(secret))

    assert [item["id"] for item in response.json()["items"]] == [str(own.id)]


def _plan_json(hours: float) -> dict:
    return {
        "success": True,
        "assignments": [],
        "total_scheduled_hours": hours,
        "optimization_status": "OPTIMAL",
        "generated_at": "2026-01-01T00:00:00Z",
    }


def test_daily_plans_always_have_id_and_updated_at(session: Session):
    own = [seed_daily_plan(session, USER_A, date(2026, 3, 1 + i)) for i in range(3)]
    seed_daily_plan(session, USER_B, date(2026, 3, 1))
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    response = client.get("/api/agent/v1/daily-plans", headers=bearer(secret))

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["id"] for item in items} == {str(doc.id) for doc in own}
    assert all(item["updated_at"] is not None for item in items)
    assert {item["date"] for item in items} == {
        "2026-03-01",
        "2026-03-02",
        "2026-03-03",
    }
    assert all(item["revision"] == 1 for item in items)


def test_daily_plans_filter_by_date_range_and_default_limit(session: Session):
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(10):
        seed_daily_plan(
            session,
            USER_A,
            date(2026, 3, 1) + timedelta(days=i),
            updated_at=base + timedelta(minutes=i),
        )
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])
    path = "/api/agent/v1/daily-plans"

    first = client.get(path, headers=bearer(secret))

    assert first.status_code == 200
    assert len(first.json()["items"]) == 7
    assert first.json()["next_cursor"] is not None

    ranged = client.get(
        path,
        headers=bearer(secret),
        params={"date_from": "2026-03-03", "date_to": "2026-03-05"},
    )

    assert [item["date"] for item in ranged.json()["items"]] == [
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
    ]
    assert ranged.json()["next_cursor"] is None
    too_many = client.get(path, headers=bearer(secret), params={"limit": 32})
    assert too_many.status_code == 422


def test_daily_plans_with_reversed_range_are_empty(session: Session):
    seed_daily_plan(session, USER_A, date(2026, 3, 3))
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    response = client.get(
        "/api/agent/v1/daily-plans",
        headers=bearer(secret),
        params={"date_from": "2026-03-05", "date_to": "2026-03-01"},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["next_cursor"] is None


def test_daily_plan_schedule_matches_its_own_date(session: Session):
    first, second = date(2026, 3, 1), date(2026, 3, 2)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    seed_daily_plan(session, USER_A, first, updated_at=base)
    seed_daily_plan(session, USER_A, second, updated_at=base + timedelta(minutes=1))
    plan_json = _plan_json(2.5)
    seed_schedule(session, USER_A, first, plan_json)
    # Another user's schedule on the second day must not leak in.
    seed_schedule(session, USER_B, second, _plan_json(9))
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    response = client.get("/api/agent/v1/daily-plans", headers=bearer(secret))

    by_date = {item["date"]: item for item in response.json()["items"]}
    assert by_date["2026-03-01"]["schedule"] == {
        **plan_json,
        "assignments": [],
        "source": None,
        "source_document_revision": None,
        "source_scheduling_blocks": None,
        "directive_diagnostics": [],
        "unused_minutes": 0,
        "unscheduled_tasks": [],
        "violations": [],
    }
    assert by_date["2026-03-02"]["schedule"] is None


def test_daily_plans_emit_updated_at_with_a_timezone(session: Session):
    seed_daily_plan(session, USER_A, date(2026, 3, 1))
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    def load_updated_at_naive(target: DailyPlanDocument, _context: object) -> None:
        # Some drivers hand back naive datetimes (stored as UTC).
        target.__dict__["updated_at"] = target.updated_at.replace(tzinfo=None)

    event.listen(DailyPlanDocument, "load", load_updated_at_naive)
    try:
        response = client.get("/api/agent/v1/daily-plans", headers=bearer(secret))
    finally:
        event.remove(DailyPlanDocument, "load", load_updated_at_naive)

    updated_at = datetime.fromisoformat(response.json()["items"][0]["updated_at"])
    assert updated_at.tzinfo is not None
    assert updated_at.utcoffset() == timedelta(0)


def test_calendar_date_accepts_date_and_datetime():
    assert _calendar_date(date(2026, 3, 1)) == date(2026, 3, 1)
    assert _calendar_date(datetime(2026, 3, 1)) == date(2026, 3, 1)


def test_daily_plan_schedule_is_found_when_schedule_date_loads_as_date(
    session: Session,
):
    # Production's schedules.date column is DATE, so psycopg2 loads a plain
    # ``date`` even though the model maps DateTime; SQLite returns a datetime.
    day = date(2026, 3, 1)
    seed_daily_plan(session, USER_A, day)
    plan_json = _plan_json(2.5)
    seed_schedule(session, USER_A, day, plan_json)
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])

    def load_date_as_date(target: Schedule, _context: object) -> None:
        target.__dict__["date"] = target.date.date()

    event.listen(Schedule, "load", load_date_as_date)
    try:
        response = client.get("/api/agent/v1/daily-plans", headers=bearer(secret))
    finally:
        event.remove(Schedule, "load", load_date_as_date)

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["schedule"]["total_scheduled_hours"] == 2.5


def test_daily_plan_schedules_are_loaded_in_one_query(session: Session):
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(31):
        day = date(2026, 3, 1) + timedelta(days=i)
        seed_daily_plan(session, USER_A, day, updated_at=base + timedelta(minutes=i))
        seed_schedule(session, USER_A, day, _plan_json(float(i)))
    secret = issue_token(session, USER_A, [AgentScope.DAILY_PLANS_READ])
    path = "/api/agent/v1/daily-plans"
    # Warm up so one-time statements (e.g. token lookup caching) do not count.
    assert client.get(path, headers=bearer(secret)).status_code == 200
    statements: list[str] = []
    session.expire_all()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(path, params={"limit": 31}, headers=bearer(secret))
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert response.status_code == 200
    assert len(response.json()["items"]) == 31
    assert all(item["schedule"] is not None for item in response.json()["items"])
    assert len([s for s in statements if "FROM schedules" in s]) == 1


def test_daily_plans_require_daily_plans_read_scope(session: Session):
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get("/api/agent/v1/daily-plans", headers=bearer(secret))

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing required scope: daily_plans:read"


def test_context_export_returns_markdown_for_own_project_and_goal(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    secret = issue_token(session, USER_A, [AgentScope.CONTEXT_READ])

    project_response = client.get(
        f"/api/agent/v1/context-export/projects/{project.id}", headers=bearer(secret)
    )
    goal_response = client.get(
        f"/api/agent/v1/context-export/goals/{goal.id}", headers=bearer(secret)
    )

    assert project_response.status_code == 200
    project_body = project_response.json()
    assert set(project_body) == {"filename", "markdown", "generated_at"}
    assert project.title in project_body["markdown"]
    assert goal.title in project_body["markdown"]
    assert goal_response.status_code == 200
    assert project.title in goal_response.json()["markdown"]
    assert goal.title in goal_response.json()["markdown"]


def test_context_export_of_other_user_or_missing_is_404(session: Session):
    other_project = seed_project(session, USER_B)
    other_goal = seed_goal(session, other_project)
    secret = issue_token(session, USER_A, [AgentScope.CONTEXT_READ])

    for path in (
        f"projects/{other_project.id}",
        f"goals/{other_goal.id}",
        f"projects/{uuid4()}",
        f"goals/{uuid4()}",
    ):
        response = client.get(
            f"/api/agent/v1/context-export/{path}", headers=bearer(secret)
        )
        assert response.status_code == 404, path


def test_context_export_validates_options(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.CONTEXT_READ])

    response = client.get(
        f"/api/agent/v1/context-export/projects/{project.id}",
        params={"period_days": 0},
        headers=bearer(secret),
    )

    assert response.status_code == 422


def test_context_export_requires_context_read_scope(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    secret = issue_token(
        session,
        USER_A,
        [
            AgentScope.PROJECTS_READ,
            AgentScope.GOALS_READ,
            AgentScope.TASKS_READ,
            AgentScope.NOTES_READ,
        ],
    )

    for path in (f"projects/{project.id}", f"goals/{goal.id}"):
        response = client.get(
            f"/api/agent/v1/context-export/{path}", headers=bearer(secret)
        )
        assert response.status_code == 403, path
        assert response.json()["detail"] == "Missing required scope: context:read"
