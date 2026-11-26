# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""A project, goal or task has two notes: its overview and its log."""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.main import app
from humancompiler_api.models import AgentScope, ContextNote, Task
from humancompiler_api.routers import notes
from humancompiler_api.safe_migration import notes_with_former_task_text
from humancompiler_api.services import TaskService
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_note,
    seed_project,
    seed_task,
    seed_user,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
STORED_AT = datetime(2026, 1, 1, 9, 30, tzinfo=UTC)

ItemFactory = Callable[[Session], tuple[str, str, UUID]]


@pytest.fixture(autouse=True)
def web_session(session: Session):
    seed_user(session, USER_A)
    use_session(session)

    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(USER_A), email="web-user@example.com")

    app.dependency_overrides[notes.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    yield
    app.dependency_overrides.pop(notes.get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def project_item(session: Session) -> tuple[str, str, UUID]:
    project = seed_project(session, USER_A)
    return "projects", "project_id", project.id


def goal_item(session: Session) -> tuple[str, str, UUID]:
    goal = seed_goal(session, seed_project(session, USER_A))
    return "goals", "goal_id", goal.id


def task_item(session: Session) -> tuple[str, str, UUID]:
    task = seed_task(session, seed_goal(session, seed_project(session, USER_A)))
    return "tasks", "task_id", task.id


KINDS = pytest.mark.parametrize(
    "make_item",
    [project_item, goal_item, task_item],
    ids=["projects", "goals", "tasks"],
)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


@KINDS
def test_overview_and_log_are_read_and_saved_apart(
    session: Session, make_item: ItemFactory
) -> None:
    kind, column, item_id = make_item(session)
    url = f"/api/notes/{kind}/{item_id}"

    overview = client.get(url).json()
    assert (overview["section"], overview["log"]) == ("overview", None)

    saved = client.put(
        f"{url}?section=log",
        json={"content": "<p>Did <strong>this</strong></p>", "content_type": "html"},
    )
    assert saved.status_code == 200, saved.text
    log = saved.json()
    assert (log["section"], log["content"], log["log"]) == (
        "log",
        "<p>Did <strong>this</strong></p>",
        None,
    )
    assert log["id"] != overview["id"]
    assert log[column] == str(item_id)

    # The overview is untouched, and says how much its item's log holds.
    again = client.get(url).json()
    assert (again["id"], again["content"]) == (overview["id"], "")
    assert again["updated_at"] == overview["updated_at"]
    assert again["log"] == {
        "updated_at": log["updated_at"],
        "characters": len("Did this"),
    }
    assert client.get(f"{url}?section=log").json()["id"] == log["id"]
    assert client.get(f"{url}?section=overview").json()["id"] == overview["id"]

    # An emptied log is no log to speak of.
    client.put(f"{url}?section=log", json={"content": "<p></p>"})
    assert client.get(url).json()["log"] is None
    rows = session.exec(select(ContextNote)).all()
    assert sorted(row.section for row in rows) == ["log", "overview"]


def test_each_section_has_its_own_optimistic_lock(session: Session) -> None:
    project = seed_project(session, USER_A)
    seed_note(session, USER_A, project=project, updated_at=STORED_AT)
    url = f"/api/notes/projects/{project.id}"
    log = client.put(f"{url}?section=log", json={"content": "<p>one</p>"}).json()

    # The overview's updated_at does not unlock the log.
    stale = client.put(
        f"{url}?section=log",
        json={"content": "<p>two</p>", "expected_updated_at": STORED_AT.isoformat()},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_updated_at"] == log["updated_at"]

    fresh = client.put(
        f"{url}?section=log",
        json={"content": "<p>two</p>", "expected_updated_at": log["updated_at"]},
    )
    assert fresh.status_code == 200, fresh.text
    # Nor did saving the log move the overview on.
    overview = client.put(
        url, json={"content": "x", "expected_updated_at": STORED_AT.isoformat()}
    )
    assert overview.status_code == 200, overview.text


def test_unknown_section_is_rejected(session: Session) -> None:
    project = seed_project(session, USER_A)

    response = client.get(f"/api/notes/projects/{project.id}?section=journal")

    assert response.status_code == 422
    assert session.exec(select(ContextNote)).all() == []


def test_a_tasks_log_is_not_part_of_what_the_task_answers_with(
    session: Session,
) -> None:
    task = seed_task(session, seed_goal(session, seed_project(session, USER_A)))
    url = f"/api/notes/tasks/{task.id}"
    client.put(url, json={"content": "<p>Write the intro</p>", "content_type": "html"})
    session.expire_all()
    before = session.get(Task, task.id).updated_at  # type: ignore[union-attr]

    saved = client.put(
        f"{url}?section=log",
        json={"content": "<p>Drafted on Monday</p>", "content_type": "html"},
    )

    assert saved.status_code == 200, saved.text
    session.expire_all()
    stored = session.get(Task, task.id)
    assert stored is not None
    # The excerpt is the overview's opening, and the task did not change.
    assert stored.note_excerpt == "Write the intro"
    assert stored.updated_at == before
    assert client.get(f"{url}/markdown").json()["markdown"] == "Write the intro"
    # Search still finds the task by what its log says.
    service = TaskService()
    for search, expected in (("Monday", 1), ("intro", 1), ("Tuesday", 0)):
        _, total = service.get_workspace_tasks(session, str(USER_A), search=search)
        assert total == expected, search


def test_agent_note_list_can_be_limited_to_a_section(session: Session) -> None:
    project = seed_project(session, USER_A)
    overview = seed_note(session, USER_A, project=project)
    log = seed_note(session, USER_A, project=project, section="log")
    token = issue_token(session, USER_A, [AgentScope.NOTES_READ])

    def listed(query: str = "") -> dict[str, str]:
        response = client.get(
            f"/api/agent/v1/context-notes{query}", headers=bearer(token)
        )
        assert response.status_code == 200, response.text
        return {item["id"]: item["section"] for item in response.json()["items"]}

    assert listed() == {str(overview.id): "overview", str(log.id): "log"}
    assert listed("?section=overview") == {str(overview.id): "overview"}
    assert listed(f"?section=log&project_id={project.id}") == {str(log.id): "log"}
    response = client.get(
        "/api/agent/v1/context-notes?section=journal", headers=bearer(token)
    )
    assert response.status_code == 422


def test_restoring_an_old_backup_puts_task_text_in_the_overview() -> None:
    task_id, goal_id, project_id = (str(uuid4()) for _ in range(3))
    owner_id = str(uuid4())
    backup = {
        "projects": [{"id": project_id, "owner_id": owner_id}],
        "goals": [{"id": goal_id, "project_id": project_id}],
        "tasks": [{"id": task_id, "goal_id": goal_id, "description": "Why"}],
        "context_notes": [
            {
                "task_id": task_id,
                "section": "log",
                "content": "<p>Did</p>",
                "content_type": "html",
            },
            {
                "task_id": task_id,
                "section": "overview",
                "content": "<p>Plan</p>",
                "content_type": "html",
            },
        ],
    }

    restored = {
        note["section"]: note["content"] for note in notes_with_former_task_text(backup)
    }

    assert restored == {"log": "<p>Did</p>", "overview": "<p>Why</p><p>Plan</p>"}
