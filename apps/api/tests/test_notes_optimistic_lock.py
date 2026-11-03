# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Optimistic lock on the web note editor's PUT /api/notes/{kind}/{id}."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlmodel import Session

from humancompiler_api.agent_write_service import STALE_MESSAGE
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.main import app
from humancompiler_api.models import ContextNote, ContextNoteUpdate
from humancompiler_api.routers import notes
from tests.agent_api_helpers import (
    client,
    seed_goal,
    seed_note,
    seed_project,
    seed_task,
    seed_user,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
STORED_AT = datetime(2026, 1, 1, 9, 30, tzinfo=UTC)

NoteFactory = Callable[[Session], tuple[str, ContextNote]]


@pytest.fixture(autouse=True)
def web_session(session: Session):
    seed_user(session, USER_A)

    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(USER_A), email="web-user@example.com")

    app.dependency_overrides[notes.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    yield
    app.dependency_overrides.pop(notes.get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def project_note(session: Session) -> tuple[str, ContextNote]:
    project = seed_project(session, USER_A)
    note = seed_note(session, USER_A, project=project, updated_at=STORED_AT)
    return f"/api/notes/projects/{project.id}", note


def goal_note(session: Session) -> tuple[str, ContextNote]:
    goal = seed_goal(session, seed_project(session, USER_A))
    note = seed_note(session, USER_A, goal=goal, updated_at=STORED_AT)
    return f"/api/notes/goals/{goal.id}", note


def task_note(session: Session) -> tuple[str, ContextNote]:
    task = seed_task(session, seed_goal(session, seed_project(session, USER_A)))
    note = seed_note(session, USER_A, task=task, updated_at=STORED_AT)
    return f"/api/notes/tasks/{task.id}", note


KINDS = pytest.mark.parametrize(
    "make_note",
    [project_note, goal_note, task_note],
    ids=["projects", "goals", "tasks"],
)


def stored(session: Session, note: ContextNote) -> ContextNote:
    session.expire_all()
    row = session.get(ContextNote, note.id)
    if row is None:
        raise AssertionError("note disappeared")
    return row


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def test_update_model_accepts_expected_updated_at() -> None:
    data = ContextNoteUpdate.model_validate(
        {"content": "x", "expected_updated_at": STORED_AT.isoformat()}
    )
    assert data.expected_updated_at == STORED_AT


@KINDS
def test_matching_expected_updated_at_saves(
    session: Session, make_note: NoteFactory
) -> None:
    url, note = make_note(session)

    response = client.put(
        url,
        json={"content": "<p>new</p>", "expected_updated_at": STORED_AT.isoformat()},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content"] == "<p>new</p>"
    assert datetime.fromisoformat(body["updated_at"]) > STORED_AT
    assert stored(session, note).content == "<p>new</p>"


@KINDS
def test_matching_expected_updated_at_in_another_offset_saves(
    session: Session, make_note: NoteFactory
) -> None:
    url, _ = make_note(session)
    jst = STORED_AT.astimezone(timezone(timedelta(hours=9)))

    response = client.put(
        url, json={"content": "jst", "expected_updated_at": jst.isoformat()}
    )

    assert response.status_code == 200, response.text


@KINDS
def test_stale_expected_updated_at_gives_409_and_writes_nothing(
    session: Session, make_note: NoteFactory
) -> None:
    url, note = make_note(session)
    stale = STORED_AT - timedelta(seconds=1)

    response = client.put(
        url,
        json={"content": "<p>lost</p>", "expected_updated_at": stale.isoformat()},
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["message"] == STALE_MESSAGE
    assert datetime.fromisoformat(detail["current_updated_at"]) == STORED_AT
    row = stored(session, note)
    assert row.content == "Note"
    assert row.updated_at is not None
    assert as_utc(row.updated_at) == STORED_AT


@KINDS
def test_without_expected_updated_at_saves_as_before(
    session: Session, make_note: NoteFactory
) -> None:
    url, note = make_note(session)

    response = client.put(url, json={"content": "<p>overwrite</p>"})

    assert response.status_code == 200, response.text
    assert stored(session, note).content == "<p>overwrite</p>"
    assert datetime.fromisoformat(response.json()["updated_at"]) > STORED_AT


@KINDS
def test_expected_updated_at_is_never_stored(
    session: Session, make_note: NoteFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    url, _ = make_note(session)
    written: list[str] = []
    original = ContextNote.__setattr__

    def spy(self: ContextNote, name: str, value: object) -> None:
        written.append(name)
        original(self, name, value)

    monkeypatch.setattr(ContextNote, "__setattr__", spy)

    response = client.put(
        url,
        json={"content": "kept", "expected_updated_at": STORED_AT.isoformat()},
    )

    assert response.status_code == 200, response.text
    assert "expected_updated_at" not in written
    assert "expected_updated_at" not in response.json()


@KINDS
def test_successive_saves_chain_on_the_returned_updated_at(
    session: Session, make_note: NoteFactory
) -> None:
    url, _ = make_note(session)

    first = client.put(
        url, json={"content": "one", "expected_updated_at": STORED_AT.isoformat()}
    )
    assert first.status_code == 200, first.text
    second = client.put(
        url,
        json={"content": "two", "expected_updated_at": first.json()["updated_at"]},
    )
    assert second.status_code == 200, second.text
    stale = client.put(
        url,
        json={"content": "three", "expected_updated_at": first.json()["updated_at"]},
    )
    assert stale.status_code == 409, stale.text
