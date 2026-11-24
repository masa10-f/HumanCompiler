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
    Task,
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
        str(test_user_id),
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
        str(test_user_id),
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


def test_workspace_search_takes_wildcard_characters_as_written(
    session: Session, test_user_id: str
):
    service, task_id = _create(
        session, test_user_id, title="Budget", note="50% of plan_a, see docs/a"
    )
    goal_id = session.get(Task, task_id).goal_id
    service.create_task(
        session,
        TaskCreate(
            goal_id=goal_id,
            title="Plan B",
            estimate_hours=Decimal("2"),
            note="500 of planXa",
        ),
        test_user_id,
    )

    def found(search: str) -> list[str]:
        rows, total = service.get_workspace_tasks(session, test_user_id, search=search)
        counts = service.get_workspace_summary_counts(
            session, test_user_id, search=search
        )
        assert counts["total"] == total == len(rows)
        return sorted(row[0].title for row in rows)

    # "%" and "_" are the characters themselves, not "anything" and "any one".
    assert found("%") == ["Budget"]
    assert found("50%") == ["Budget"]
    assert found("plan_a") == ["Budget"]
    assert found("5_%") == []
    assert found("_") == ["Budget"]
    # The character the pattern is escaped with is one too.
    assert found("docs/a") == ["Budget"]
    assert found("/") == ["Budget"]
    # A plain word still finds both, whatever its case.
    assert found("PLAN") == ["Budget", "Plan B"]


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


def _stored_updated_at(session: Session, task_id: UUID):
    session.expire_all()
    task = session.get(Task, task_id)
    assert task is not None
    return task.updated_at


def test_note_text_change_advances_the_task_updated_at(
    session: Session, test_user_id: str
):
    """The task's response changes with its note, so incremental sync must see it."""
    _, task_id = _create(session, test_user_id, note="Old opening")
    before = _stored_updated_at(session, task_id)

    update_note(
        session,
        str(test_user_id),
        NoteTarget(task_id=task_id),
        ContextNoteUpdate(content="<p>New opening</p>", content_type="html"),
    )

    assert _stored_updated_at(session, task_id) > before


def test_note_save_without_a_text_change_keeps_the_task_updated_at(
    session: Session, test_user_id: str
):
    _, task_id = _create(session, test_user_id, note="Same text")
    before = _stored_updated_at(session, task_id)

    update_note(
        session,
        str(test_user_id),
        NoteTarget(task_id=task_id),
        ContextNoteUpdate(
            content="<p><strong>Same</strong> text</p>", content_type="html"
        ),
    )

    assert _stored_updated_at(session, task_id) == before


def test_first_note_text_advances_the_task_updated_at(
    session: Session, test_user_id: str
):
    _, task_id = _create(session, test_user_id)
    before = _stored_updated_at(session, task_id)

    update_note(
        session,
        str(test_user_id),
        NoteTarget(task_id=task_id),
        ContextNoteUpdate(content="<p>First words</p>", content_type="html"),
    )

    assert _stored_updated_at(session, task_id) > before


def test_project_note_change_leaves_tasks_alone(session: Session, test_user_id: str):
    data = create_test_data(session, test_user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(goal_id=data["goal"].id, title="T", estimate_hours=Decimal("1")),
        test_user_id,
    )
    before = _stored_updated_at(session, task.id)

    update_note(
        session,
        str(test_user_id),
        NoteTarget(project_id=data["project"].id),
        ContextNoteUpdate(content="<p>Project plan</p>", content_type="html"),
    )

    assert _stored_updated_at(session, task.id) == before
