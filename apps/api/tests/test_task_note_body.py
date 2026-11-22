# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""A task's note is its body: created with the task, excerpted and searched."""

from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlmodel import Session, select

from conftest import create_test_data
from humancompiler_api.models import (
    ContextNote,
    ContextNoteUpdate,
    QuickTaskCreate,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
)
from humancompiler_api.proposal_payloads import NoteTarget
from humancompiler_api.routers.notes import update_note
from humancompiler_api.services import QuickTaskService, TaskService


def _create(session: Session, user_id: str, **fields) -> tuple[TaskService, UUID]:
    data = create_test_data(session, user_id)
    service = TaskService()
    task = service.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title=fields.pop("title", "Write the report"),
            estimate_hours=Decimal("2"),
            **fields,
        ),
        user_id,
    )
    return service, task.id


def _note(session: Session, task_id: UUID) -> ContextNote | None:
    return session.exec(
        select(ContextNote).where(ContextNote.task_id == task_id)
    ).first()


def test_task_created_with_text_gets_a_note(session: Session, test_user_id: str):
    service, task_id = _create(
        session, test_user_id, note="Summarise <Q3>\n\nKeep it to one page"
    )

    note = _note(session, task_id)
    assert note is not None
    assert str(note.user_id) == str(test_user_id)
    assert note.content_type == "html"
    assert note.content == "<p>Summarise &lt;Q3&gt;</p><p>Keep it to one page</p>"
    assert note.content_text == "Summarise <Q3>\nKeep it to one page"

    task = service.get_task(session, task_id, test_user_id)
    response = TaskResponse.model_validate(task)
    assert response.note_excerpt == "Summarise <Q3> Keep it to one page"
    dumped = response.model_dump()
    assert "description" not in dumped
    assert "memo" not in dumped
    assert "note" not in dumped


def test_task_created_without_text_has_no_note(session: Session, test_user_id: str):
    service, task_id = _create(session, test_user_id, note="  \n ")

    assert _note(session, task_id) is None
    task = service.get_task(session, task_id, test_user_id)
    assert TaskResponse.model_validate(task).note_excerpt is None


def test_former_description_opens_the_note(session: Session, test_user_id: str):
    _, task_id = _create(
        session, test_user_id, description="Why it matters", note="First step"
    )

    note = _note(session, task_id)
    assert note is not None
    assert note.content == "<p>Why it matters</p><p>First step</p>"


def test_task_update_has_no_text_fields():
    assert not {"description", "memo", "note"} & set(TaskUpdate.model_fields)
    with pytest.raises(ValidationError):
        TaskCreate(goal_id=UUID(int=1), title="T", estimate_hours=1, note="x" * 20001)


def test_editing_the_note_changes_the_excerpt(session: Session, test_user_id: str):
    service, task_id = _create(session, test_user_id, note="Old opening")

    update_note(
        session,
        test_user_id,
        NoteTarget(task_id=task_id),
        ContextNoteUpdate(
            content="<h2>New plan</h2><p>Ship <em>early</em></p>", content_type="html"
        ),
    )

    session.expire_all()
    note = _note(session, task_id)
    assert note is not None
    assert note.content_text == "New plan\nShip early"
    task = service.get_task(session, task_id, test_user_id)
    assert task.note_excerpt == "New plan Ship early"


def test_tasks_of_a_goal_carry_their_excerpts(session: Session, test_user_id: str):
    data = create_test_data(session, test_user_id)
    service = TaskService()
    for title, note in (("With note", "Has a body"), ("Without note", None)):
        service.create_task(
            session,
            TaskCreate(
                goal_id=data["goal"].id,
                title=title,
                estimate_hours=Decimal("1"),
                note=note,
            ),
            test_user_id,
        )

    tasks = service.get_tasks_by_goal(session, data["goal"].id, test_user_id)

    assert {task.title: task.note_excerpt for task in tasks} == {
        "With note": "Has a body",
        "Without note": None,
    }


def test_workspace_search_matches_note_text_not_markup(
    session: Session, test_user_id: str
):
    service, task_id = _create(session, test_user_id, note="placeholder")
    update_note(
        session,
        test_user_id,
        NoteTarget(task_id=task_id),
        ContextNoteUpdate(
            content="<p>Call the <strong>vendor</strong> about R&amp;D</p>",
            content_type="html",
        ),
    )

    def found(search: str) -> int:
        _, total = service.get_workspace_tasks(session, test_user_id, search=search)
        return total

    assert found("vendor about") == 1
    assert found("R&D") == 1
    assert found("report") == 1  # the title still matches
    assert found("strong") == 0
    assert found("&amp;") == 0
    assert found("placeholder") == 0


def test_converting_a_quick_task_moves_its_description_to_the_note(
    session: Session, test_user_id: str
):
    data = create_test_data(session, test_user_id)
    quick_tasks = QuickTaskService()
    quick_task = quick_tasks.create_quick_task(
        session,
        QuickTaskCreate(title="Call the vendor", description="Ask about lead time"),
        test_user_id,
    )

    task = quick_tasks.convert_to_task(
        session, quick_task.id, data["goal"].id, test_user_id
    )

    note = _note(session, task.id)
    assert note is not None
    assert note.content == "<p>Ask about lead time</p>"
    assert task.note_excerpt == "Ask about lead time"
