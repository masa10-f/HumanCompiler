# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlmodel import Session

from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentScope, LogUpdate, TaskStatus
from humancompiler_api.services import log_service
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_log,
    seed_note,
    seed_project,
    seed_quick_task,
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
