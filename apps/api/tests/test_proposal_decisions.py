# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Accepting and rejecting agent proposals (proposal_service)."""

import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlmodel import Session, func, select

from humancompiler_api import proposal_service
from humancompiler_api.models import (
    AgentProposal,
    ContextNote,
    Goal,
    ProposalKind,
    ProposalStatus,
    QuickTask,
    Task,
    WorkType,
)
from humancompiler_api.note_markdown import (
    agent_append_heading,
    markdown_to_note_html,
)
from humancompiler_api.proposal_payloads import (
    ProposalAcceptRequest,
    ProposalRejectRequest,
    normalize_payload,
)
from humancompiler_api.proposal_service import accept_proposal, reject_proposal
from tests.agent_api_helpers import (
    seed_goal,
    seed_note,
    seed_project,
    seed_task,
    seed_user,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
OLD_STAMP = datetime(2026, 1, 1, tzinfo=UTC)
AGENT = "Distiller"

EXPERIMENT_PAYLOAD = {
    "question": "q",
    "method": "m",
    "supports_if": "s",
    "refutes_if": "r",
    "effort": "e",
}


@pytest.fixture(autouse=True)
def users(session: Session):
    seed_user(session, USER_A)
    seed_user(session, USER_B)


def make_proposal(
    session: Session,
    kind: ProposalKind,
    payload: dict[str, Any],
    *,
    user_id: UUID = USER_A,
    project_id: UUID | None = None,
) -> AgentProposal:
    """Store a pending proposal the way intake does (payload normalised)."""
    row = AgentProposal(
        id=uuid4(),
        user_id=user_id,
        agent_name=AGENT,
        kind=kind.value,
        title="Proposal",
        payload=normalize_payload(kind, payload),
        idempotency_key=f"key-{uuid4()}",
        project_id=project_id,
        created_at=OLD_STAMP,
        updated_at=OLD_STAMP,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def accept(
    session: Session, row: AgentProposal, user_id: UUID = USER_A, **body: Any
) -> AgentProposal:
    return accept_proposal(
        session, user_id, row.id, ProposalAcceptRequest.model_validate(body)
    )


def reject(
    session: Session, row: AgentProposal, user_id: UUID = USER_A, **body: Any
) -> AgentProposal:
    return reject_proposal(
        session, user_id, row.id, ProposalRejectRequest.model_validate(body)
    )


def count(session: Session, model: type) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


def reload(session: Session, row: AgentProposal) -> AgentProposal:
    session.expire_all()
    fresh = session.get(AgentProposal, row.id)
    if fresh is None:
        raise AssertionError("proposal vanished")
    return fresh


def as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes for timezone-aware columns.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def tokyo_today():
    return datetime.now(ZoneInfo("Asia/Tokyo")).date()


def test_accept_goal_creates_goal(session: Session):
    project = seed_project(session, USER_A)
    row = make_proposal(
        session,
        ProposalKind.GOAL,
        {"project_id": str(project.id), "title": "Ship it", "due_date": "2026-12-01"},
        project_id=project.id,
    )

    result = accept(session, row)

    goal = session.get(Goal, result.result_id)
    assert goal is not None
    assert goal.title == "Ship it"
    assert goal.project_id == project.id
    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.result_type == "goal"
    assert result.final_payload == result.payload
    assert result.project_id == project.id
    assert result.decided_at is not None
    assert as_utc(result.updated_at) > OLD_STAMP


def test_accept_task_creates_task(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    row = make_proposal(
        session,
        ProposalKind.TASK,
        {
            "goal_id": str(goal.id),
            "title": "Write intro",
            "estimate_hours": 2,
            "priority": 2,
            "work_type": "study",
        },
        project_id=project.id,
    )

    result = accept(session, row)

    task = session.get(Task, result.result_id)
    assert task is not None
    assert task.goal_id == goal.id
    assert task.title == "Write intro"
    assert task.estimate_hours == Decimal("2")
    assert task.priority == 2
    assert task.work_type == WorkType.STUDY
    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.result_type == "task"
    assert result.final_payload == result.payload


def test_accept_quick_task_creates_quick_task(session: Session):
    row = make_proposal(session, ProposalKind.QUICK_TASK, {"title": "Try it"})

    result = accept(session, row)

    quick_task = session.get(QuickTask, result.result_id)
    assert quick_task is not None
    assert quick_task.owner_id == USER_A
    assert quick_task.title == "Try it"
    assert quick_task.estimate_hours == Decimal("0.5")
    assert quick_task.priority == 3
    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.result_type == "quick_task"
    assert result.final_payload == result.payload
    assert result.project_id is None


def test_accept_with_edit_marks_edited(session: Session):
    project = seed_project(session, USER_A)
    original = {"project_id": str(project.id), "title": "Before"}
    row = make_proposal(session, ProposalKind.GOAL, original, project_id=project.id)

    result = accept(session, row, payload={**original, "title": "After"})

    goal = session.get(Goal, result.result_id)
    assert goal is not None
    assert goal.title == "After"
    assert result.status == ProposalStatus.EDITED.value
    assert result.payload["title"] == "Before"
    assert result.final_payload is not None
    assert result.final_payload["title"] == "After"


def test_accept_with_equivalent_payload_is_not_edited(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    row = make_proposal(
        session,
        ProposalKind.TASK,
        {
            "goal_id": str(goal.id),
            "title": "Same",
            "estimate_hours": 1,
            "due_date": "2026-12-01T09:00:00+09:00",
        },
        project_id=project.id,
    )

    result = accept(
        session,
        row,
        payload={
            "goal_id": str(goal.id),
            "title": "Same",
            "estimate_hours": "1.0",
            "due_date": "2026-12-01T00:00:00Z",
        },
    )

    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.final_payload == result.payload


def test_accept_edit_can_move_task_to_another_owned_goal_and_updates_project_id(
    session: Session,
):
    first_project = seed_project(session, USER_A)
    first_goal = seed_goal(session, first_project)
    second_project = seed_project(session, USER_A)
    second_goal = seed_goal(session, second_project)
    original = {"goal_id": str(first_goal.id), "title": "Move", "estimate_hours": 1}
    row = make_proposal(
        session, ProposalKind.TASK, original, project_id=first_project.id
    )

    result = accept(session, row, payload={**original, "goal_id": str(second_goal.id)})

    task = session.get(Task, result.result_id)
    assert task is not None
    assert task.goal_id == second_goal.id
    assert result.project_id == second_project.id
    assert result.status == ProposalStatus.EDITED.value


def test_accept_edit_with_other_users_goal_is_422(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    other_goal = seed_goal(session, seed_project(session, USER_B))
    original = {"goal_id": str(goal.id), "title": "Mine", "estimate_hours": 1}
    row = make_proposal(session, ProposalKind.TASK, original, project_id=project.id)

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "goal_id": str(other_goal.id)})

    assert caught.value.status_code == 422
    assert caught.value.detail == "Unknown goal_id"
    assert count(session, Task) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_accept_invalid_edit_is_422_with_serialisable_errors(session: Session):
    project = seed_project(session, USER_A)
    original = {"project_id": str(project.id), "title": "Fine"}
    row = make_proposal(session, ProposalKind.GOAL, original, project_id=project.id)

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "title": "", "extra": 1})

    assert caught.value.status_code == 422
    detail = caught.value.detail
    assert isinstance(detail, list)
    json.dumps(detail)
    assert {tuple(item["loc"]) for item in detail} == {("title",), ("extra",)}
    assert count(session, Goal) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_accept_twice_creates_one_entity(session: Session):
    project = seed_project(session, USER_A)
    row = make_proposal(
        session,
        ProposalKind.GOAL,
        {"project_id": str(project.id), "title": "Once"},
        project_id=project.id,
    )

    accept(session, row)
    with pytest.raises(HTTPException) as caught:
        accept(session, row)

    assert caught.value.status_code == 409
    assert caught.value.detail == "Proposal already decided"
    assert count(session, Goal) == 1


def test_accept_after_target_deleted_returns_409_and_creates_nothing(
    session: Session,
):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    row = make_proposal(
        session,
        ProposalKind.TASK,
        {"goal_id": str(goal.id), "title": "Orphan", "estimate_hours": 1},
        project_id=project.id,
    )
    session.delete(goal)
    session.commit()

    with pytest.raises(HTTPException) as caught:
        accept(session, row)

    assert caught.value.status_code == 409
    assert caught.value.detail == "Proposal target no longer exists; reject it instead"
    assert count(session, Task) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_unchanged_payload_sent_back_after_target_deleted_is_409(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    original = {"goal_id": str(goal.id), "title": "Orphan", "estimate_hours": 1}
    row = make_proposal(session, ProposalKind.TASK, original, project_id=project.id)
    session.delete(goal)
    session.commit()

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "estimate_hours": "1.00"})

    assert caught.value.status_code == 409
    assert count(session, Task) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_edited_title_with_deleted_goal_is_409(session: Session):
    """Editing other fields does not make a vanished target an input error."""
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    original = {"goal_id": str(goal.id), "title": "Orphan", "estimate_hours": 1}
    row = make_proposal(session, ProposalKind.TASK, original, project_id=project.id)
    session.delete(goal)
    session.commit()

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "title": "Renamed"})

    assert caught.value.status_code == 409
    assert caught.value.detail == "Proposal target no longer exists; reject it instead"
    assert count(session, Task) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_edited_note_text_with_deleted_target_is_409(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    original = {"target": {"goal_id": str(goal.id)}, "content_markdown": "Old"}
    row = make_proposal(
        session, ProposalKind.NOTE_APPEND, original, project_id=project.id
    )
    session.delete(goal)
    session.commit()

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "content_markdown": "New"})

    assert caught.value.status_code == 409
    assert count(session, ContextNote) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_edit_moving_note_target_to_missing_id_is_422(session: Session):
    project = seed_project(session, USER_A)
    original = {"target": {"project_id": str(project.id)}, "content_markdown": "x"}
    row = make_proposal(
        session, ProposalKind.NOTE_APPEND, original, project_id=project.id
    )

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload={**original, "target": {"goal_id": str(uuid4())}})

    assert caught.value.status_code == 422
    assert caught.value.detail == "Unknown target.goal_id"
    assert count(session, ContextNote) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_accept_rejects_edit_for_non_editable_kind(session: Session):
    payload = {
        "claims": [{"text": "a"}, {"text": "b"}],
        "explanation": "They disagree",
    }
    row = make_proposal(session, ProposalKind.CONTRADICTION, payload)

    with pytest.raises(HTTPException) as caught:
        accept(session, row, payload=payload)

    assert caught.value.status_code == 422
    assert caught.value.detail == "This kind cannot be edited"
    assert reload(session, row).status == ProposalStatus.PENDING.value


def test_accept_contradiction_without_note(session: Session):
    row = make_proposal(
        session,
        ProposalKind.CONTRADICTION,
        {"claims": [{"text": "a"}, {"text": "b"}], "explanation": "x"},
    )

    result = accept(session, row)

    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.result_type is None
    assert result.result_id is None


def test_decision_request_needs_answer(session: Session):
    payload = {"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]}

    def expect_422(row: AgentProposal, **body: Any) -> None:
        with pytest.raises(HTTPException) as caught:
            accept(session, row, **body)
        assert caught.value.status_code == 422
        assert reload(session, row).status == ProposalStatus.PENDING.value

    by_option = make_proposal(session, ProposalKind.DECISION_REQUEST, payload)
    expect_422(by_option)
    expect_422(by_option, decision_note="   ")
    expect_422(by_option, decision_option=2)

    answered = accept(session, by_option, decision_option=1)
    assert answered.status == ProposalStatus.ACCEPTED.value
    assert answered.decision_option == 1
    assert answered.result_type is None

    by_note = make_proposal(session, ProposalKind.DECISION_REQUEST, payload)
    noted = accept(session, by_note, decision_note="Neither; do C")
    assert noted.status == ProposalStatus.ACCEPTED.value
    assert noted.decision_note == "Neither; do C"
    assert noted.decision_option is None

    no_options = make_proposal(
        session, ProposalKind.DECISION_REQUEST, {"question": "Open?"}
    )
    expect_422(no_options, decision_option=0)

    quick = make_proposal(session, ProposalKind.QUICK_TASK, {"title": "Q"})
    expect_422(quick, decision_option=0)
    assert count(session, QuickTask) == 0


def test_accept_experiment_keeps_instructions(session: Session):
    row = make_proposal(session, ProposalKind.EXPERIMENT, EXPERIMENT_PAYLOAD)

    result = accept(session, row, decision_note="Use three seeds")

    assert result.status == ProposalStatus.ACCEPTED.value
    assert result.decision_note == "Use three seeds"
    assert result.result_type is None
    assert result.result_id is None
    assert result.final_payload == result.payload
    assert count(session, Goal) + count(session, Task) + count(session, QuickTask) == 0


def test_note_append_creates_note_when_missing(session: Session):
    project = seed_project(session, USER_A)
    markdown = "## Finding\n\nIt **works**."
    row = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"project_id": str(project.id)}, "content_markdown": markdown},
        project_id=project.id,
    )

    result = accept(session, row)

    note = session.exec(
        select(ContextNote).where(ContextNote.project_id == project.id)
    ).one()
    assert note.user_id == USER_A
    assert note.content == (
        agent_append_heading(AGENT, tokyo_today()) + markdown_to_note_html(markdown)
    )
    assert note.content_type == "html"
    assert result.result_type == "context_note"
    assert result.result_id == note.id
    assert result.project_id == project.id
    assert result.status == ProposalStatus.ACCEPTED.value


def test_note_append_appends_to_existing_html(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    note = seed_note(session, USER_A, goal=goal, updated_at=OLD_STAMP)
    note.content = "<p>Old</p>"
    note.content_type = "html"
    session.add(note)
    session.commit()
    row = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"goal_id": str(goal.id)}, "content_markdown": "- one\n- two"},
        project_id=project.id,
    )

    result = accept(session, row)

    session.refresh(note)
    assert note.content == (
        "<p>Old</p>"
        + agent_append_heading(AGENT, tokyo_today())
        + markdown_to_note_html("- one\n- two")
    )
    assert note.content_type == "html"
    assert as_utc(note.updated_at) > OLD_STAMP
    assert result.result_type == "context_note"
    assert result.result_id == note.id
    assert count(session, ContextNote) == 1


def test_note_append_converts_markdown_note_to_html(session: Session):
    project = seed_project(session, USER_A)
    task = seed_task(session, seed_goal(session, project))
    note = seed_note(session, USER_A, task=task)
    note.content = "Old **markdown**"
    note.content_type = "markdown"
    session.add(note)
    session.commit()
    row = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"task_id": str(task.id)}, "content_markdown": "New"},
        project_id=project.id,
    )

    result = accept(session, row)

    session.refresh(note)
    assert note.content_type == "html"
    assert note.content.endswith(
        agent_append_heading(AGENT, tokyo_today()) + "<p>New</p>\n"
    )
    assert result.result_id == note.id
    assert result.project_id == project.id


def test_note_append_locks_the_note_row(session: Session):
    """Two accepts appending to one note must serialise on the note row.

    SQLite ignores FOR UPDATE, so check the statement itself as PostgreSQL
    would compile it."""
    project = seed_project(session, USER_A)
    seed_note(session, USER_A, project=project)
    row = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"project_id": str(project.id)}, "content_markdown": "x"},
        project_id=project.id,
    )
    note_lookups: list[Any] = []

    def capture(state: Any) -> None:
        if state.is_select and any(
            getattr(entity, "class_", None) is ContextNote
            for entity in state.all_mappers
        ):
            note_lookups.append(state)

    event.listen(session, "do_orm_execute", capture)
    try:
        accept(session, row)
    finally:
        event.remove(session, "do_orm_execute", capture)

    assert note_lookups, "the note must have been looked up"
    lookup = note_lookups[0]
    compiled = str(lookup.statement.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled
    assert lookup.execution_options.get("populate_existing") is True


def test_failed_accept_rolls_back(session: Session, monkeypatch):
    project = seed_project(session, USER_A)
    row = make_proposal(
        session,
        ProposalKind.GOAL,
        {"project_id": str(project.id), "title": "Doomed"},
        project_id=project.id,
    )
    built: list[Goal] = []
    real_build = proposal_service.goal_service.build

    def spy_build(*args: Any, **kwargs: Any) -> Goal:
        goal = real_build(*args, **kwargs)
        built.append(goal)
        return goal

    def fail_after_build(kind: ProposalKind, data: dict[str, Any]) -> dict[str, Any]:
        if not built:
            return normalize_payload(kind, data)
        raise RuntimeError("boom")

    monkeypatch.setattr(proposal_service.goal_service, "build", spy_build)
    monkeypatch.setattr(proposal_service, "normalize_payload", fail_after_build)

    with pytest.raises(RuntimeError):
        accept(session, row)

    assert built, "the goal must have been flushed before the failure"
    assert count(session, Goal) == 0
    fresh = reload(session, row)
    assert fresh.status == ProposalStatus.PENDING.value
    assert fresh.final_payload is None
    assert fresh.result_id is None
    assert fresh.decided_at is None


def test_reject_records_category_and_note(session: Session):
    row = make_proposal(session, ProposalKind.QUICK_TASK, {"title": "Nope"})

    result = reject(
        session, row, reject_category="duplicate", decision_note="Already have it"
    )

    assert result.status == ProposalStatus.REJECTED.value
    assert result.reject_category == "duplicate"
    assert result.decision_note == "Already have it"
    assert result.decided_at is not None
    assert result.final_payload is None
    assert result.result_type is None
    assert as_utc(result.updated_at) > OLD_STAMP
    assert count(session, QuickTask) == 0
    fresh = reload(session, row)
    assert fresh.status == ProposalStatus.REJECTED.value


def test_reject_requires_category():
    with pytest.raises(ValidationError):
        ProposalRejectRequest.model_validate({})
    with pytest.raises(ValidationError):
        ProposalRejectRequest.model_validate({"reject_category": "meh"})


def test_reject_decided_is_409(session: Session):
    rejected = make_proposal(session, ProposalKind.QUICK_TASK, {"title": "A"})
    reject(session, rejected, reject_category="not_now")

    with pytest.raises(HTTPException) as again:
        reject(session, rejected, reject_category="wrong")
    with pytest.raises(HTTPException) as accept_after:
        accept(session, rejected)

    assert again.value.status_code == 409
    assert accept_after.value.status_code == 409
    assert count(session, QuickTask) == 0
    assert reload(session, rejected).reject_category == "not_now"

    accepted = make_proposal(session, ProposalKind.QUICK_TASK, {"title": "B"})
    accept(session, accepted)
    with pytest.raises(HTTPException) as reject_after:
        reject(session, accepted, reject_category="wrong")
    assert reject_after.value.status_code == 409


def test_other_users_proposal_is_404(session: Session):
    row = make_proposal(
        session, ProposalKind.QUICK_TASK, {"title": "B's"}, user_id=USER_B
    )
    missing = AgentProposal(id=uuid4())

    for target in (row, missing):
        with pytest.raises(HTTPException) as accepted:
            accept(session, target, user_id=USER_A)
        with pytest.raises(HTTPException) as rejected:
            reject(session, target, user_id=USER_A, reject_category="other")
        assert accepted.value.status_code == 404
        assert accepted.value.detail == "Proposal not found"
        assert rejected.value.status_code == 404
        assert rejected.value.detail == "Proposal not found"

    assert count(session, QuickTask) == 0
    assert reload(session, row).status == ProposalStatus.PENDING.value


@pytest.mark.parametrize(
    "body",
    [
        {"decision_note": "a\x00b"},
        {"payload": {"title": "a\x00b"}},
        {"payload": {"title": "ok", "description": "a\x00b"}},
    ],
)
def test_accept_body_rejects_nul(body: dict[str, Any]):
    with pytest.raises(ValidationError, match="NUL"):
        ProposalAcceptRequest.model_validate(body)


def test_reject_body_rejects_nul():
    with pytest.raises(ValidationError, match="NUL"):
        ProposalRejectRequest.model_validate(
            {"reject_category": "other", "decision_note": "a\x00b"}
        )
