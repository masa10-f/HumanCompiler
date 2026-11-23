# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""GET /api/notes/tasks/{id}/markdown: a task's note as Markdown for the clipboard."""

from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, func, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.main import app
from humancompiler_api.models import ContextNote, Task
from humancompiler_api.routers import notes
from tests.agent_api_helpers import (
    client,
    seed_goal,
    seed_project,
    seed_task,
    seed_user,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


@pytest.fixture(autouse=True)
def web_session(session: Session):
    seed_user(session, USER_A)
    seed_user(session, USER_B)

    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(USER_A), email="web-user@example.com")

    app.dependency_overrides[notes.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    yield
    app.dependency_overrides.pop(notes.get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def make_task(session: Session, owner: UUID = USER_A) -> Task:
    return seed_task(session, seed_goal(session, seed_project(session, owner)))


def add_note(
    session: Session, task: Task, content: str, content_type: str = "html"
) -> None:
    session.add(
        ContextNote(
            user_id=USER_A, task_id=task.id, content=content, content_type=content_type
        )
    )
    session.commit()


def test_html_note_comes_back_as_markdown(session: Session):
    task = make_task(session)
    add_note(
        session,
        task,
        "<h2>依頼</h2><p>序論を <strong>800字</strong> で書く</p>"
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">'
        "<p>構成</p></li></ul>",
    )

    response = client.get(f"/api/notes/tasks/{task.id}/markdown")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "title": "Task",
        "markdown": "## 依頼\n\n序論を **800字** で書く\n\n- [x] 構成",
    }


def test_markdown_note_is_returned_as_written(session: Session):
    task = make_task(session)
    add_note(session, task, "  # Plan\n\n<TODO> write\n", "markdown")

    response = client.get(f"/api/notes/tasks/{task.id}/markdown")

    assert response.json()["markdown"] == "# Plan\n\n<TODO> write"


def test_task_without_a_note_gives_an_empty_string_and_creates_nothing(
    session: Session,
):
    task = make_task(session)

    response = client.get(f"/api/notes/tasks/{task.id}/markdown")

    assert response.status_code == 200, response.text
    assert response.json() == {"title": "Task", "markdown": ""}
    assert session.exec(select(func.count()).select_from(ContextNote)).one() == 0


def test_other_users_and_missing_tasks_are_refused(session: Session):
    foreign = make_task(session, USER_B)
    add_note(session, foreign, "<p>secret</p>")

    assert client.get(f"/api/notes/tasks/{foreign.id}/markdown").status_code == 403
    assert client.get(f"/api/notes/tasks/{uuid4()}/markdown").status_code == 404
