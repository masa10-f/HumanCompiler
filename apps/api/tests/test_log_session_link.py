# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""A Runner session and its time log are one work record; a manual log can
also say where the task stands."""

from decimal import Decimal
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, func, select

from conftest import create_test_data
from humancompiler_api.models import (
    Log,
    LogCreate,
    LogResponse,
    LogUpdate,
    Task,
    TaskCreate,
    TaskStatus,
    WorkSessionCheckoutRequest,
    WorkSessionStartRequest,
    WorkSessionUpdate,
)
from humancompiler_api.services import LogService, TaskService, WorkSessionService


def make_task(session: Session, user_id: str, estimate: float = 10.0) -> Task:
    data = create_test_data(session, user_id)
    return TaskService().create_task(
        session,
        TaskCreate(goal_id=data["goal"].id, title="Task", estimate_hours=estimate),
        user_id,
    )


def start(session: Session, user_id: str, task_id: UUID) -> None:
    WorkSessionService().start_session(
        session,
        WorkSessionStartRequest(
            task_id=task_id,
            planned_checkout_at="2030-01-01T00:00:00Z",
            planned_outcome=None,
        ),
        user_id,
    )


def checkout(session: Session, user_id: str, **fields):
    return WorkSessionService().checkout_session(
        session, user_id, WorkSessionCheckoutRequest(decision="switch", **fields)
    )


def stored_task(session: Session, task_id: UUID) -> Task:
    session.expire_all()
    task = session.get(Task, task_id)
    assert task is not None
    return task


def test_checkout_log_is_linked_to_its_session(session: Session, test_user_id: str):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)

    work_session, log = checkout(session, test_user_id, kpt_keep="Kept focus")

    assert log.work_session_id == work_session.id
    assert log.comment == "K: Kept focus"
    assert LogResponse.model_validate(log).work_session_id == work_session.id


def test_manual_log_has_no_session(session: Session, test_user_id: str):
    task = make_task(session, test_user_id)

    log = LogService().create_log(
        session, LogCreate(task_id=task.id, actual_minutes=30), test_user_id
    )

    assert log.work_session_id is None
    assert LogResponse.model_validate(log).work_session_id is None


def test_editing_the_reflection_updates_the_log_comment(
    session: Session, test_user_id: str
):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)
    work_session, log = checkout(session, test_user_id, kpt_keep="Kept focus")

    WorkSessionService().update_session_kpt(
        session,
        work_session.id,
        test_user_id,
        WorkSessionUpdate(kpt_keep="Kept focus", kpt_try="Start earlier"),
    )

    session.expire_all()
    assert session.get(Log, log.id).comment == "K: Kept focus | T: Start earlier"  # type: ignore[union-attr]


def test_adding_a_reflection_fills_an_empty_log_comment(
    session: Session, test_user_id: str
):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)
    work_session, log = checkout(session, test_user_id)
    assert log.comment is None

    WorkSessionService().update_session_kpt(
        session, work_session.id, test_user_id, WorkSessionUpdate(kpt_problem="Late")
    )

    session.expire_all()
    assert session.get(Log, log.id).comment == "P: Late"  # type: ignore[union-attr]


def test_a_comment_the_user_rewrote_is_kept(session: Session, test_user_id: str):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)
    work_session, log = checkout(session, test_user_id, kpt_keep="Kept focus")
    LogService().update_log(
        session, log.id, test_user_id, LogUpdate(comment="My own words")
    )

    WorkSessionService().update_session_kpt(
        session, work_session.id, test_user_id, WorkSessionUpdate(kpt_try="Again")
    )

    session.expire_all()
    assert session.get(Log, log.id).comment == "My own words"  # type: ignore[union-attr]


def test_manual_log_can_set_what_remains(session: Session, test_user_id: str):
    task = make_task(session, test_user_id, estimate=10.0)
    logs = LogService()
    logs.create_log(
        session, LogCreate(task_id=task.id, actual_minutes=60), test_user_id
    )

    logs.create_log(
        session,
        LogCreate(
            task_id=task.id,
            actual_minutes=30,
            remaining_estimate_hours=Decimal("2"),
        ),
        test_user_id,
    )

    # 1.5h done and 2h left: the estimate becomes 3.5h.
    updated = stored_task(session, task.id)
    assert updated.estimate_hours == Decimal("3.50")
    assert updated.status == TaskStatus.IN_PROGRESS


def test_manual_log_without_remaining_keeps_the_estimate(
    session: Session, test_user_id: str
):
    task = make_task(session, test_user_id, estimate=10.0)

    LogService().create_log(
        session, LogCreate(task_id=task.id, actual_minutes=30), test_user_id
    )

    assert stored_task(session, task.id).estimate_hours == Decimal("10.00")


def test_manual_log_can_complete_the_task(session: Session, test_user_id: str):
    task = make_task(session, test_user_id)

    LogService().create_log(
        session,
        LogCreate(task_id=task.id, actual_minutes=30, complete_task=True),
        test_user_id,
    )

    assert stored_task(session, task.id).status == TaskStatus.COMPLETED


def test_completing_through_a_log_does_not_revive_a_cancelled_task(
    session: Session, test_user_id: str
):
    task = make_task(session, test_user_id)
    task.status = TaskStatus.CANCELLED
    session.add(task)
    session.commit()

    LogService().create_log(
        session,
        LogCreate(task_id=task.id, actual_minutes=30, complete_task=True),
        test_user_id,
    )

    assert stored_task(session, task.id).status == TaskStatus.CANCELLED


def test_an_estimate_out_of_range_records_nothing(session: Session, test_user_id: str):
    task = make_task(session, test_user_id, estimate=10.0)

    with pytest.raises(HTTPException) as caught:
        LogService().create_log(
            session,
            LogCreate(
                task_id=task.id,
                actual_minutes=30,
                remaining_estimate_hours=Decimal("999.99"),
                complete_task=True,
            ),
            test_user_id,
        )

    assert caught.value.status_code == 400
    session.rollback()
    assert session.exec(select(func.count()).select_from(Log)).one() == 0
    untouched = stored_task(session, task.id)
    assert untouched.estimate_hours == Decimal("10.00")
    assert untouched.status == TaskStatus.PENDING


def test_remaining_estimate_cannot_be_negative():
    with pytest.raises(ValidationError):
        LogCreate(task_id=UUID(int=1), actual_minutes=30, remaining_estimate_hours=-1)


@pytest.mark.parametrize("too_much", ["1000", "1e30"])
def test_remaining_estimate_cannot_exceed_what_an_estimate_holds(too_much: str):
    # 1e30 would otherwise fail inside the rounding, as a server error.
    with pytest.raises(ValidationError):
        LogCreate(
            task_id=UUID(int=1),
            actual_minutes=30,
            remaining_estimate_hours=Decimal(too_much),
        )
    with pytest.raises(ValidationError):
        WorkSessionCheckoutRequest(
            decision="switch", remaining_estimate_hours=Decimal(too_much)
        )


def test_checkout_sets_what_remains(session: Session, test_user_id: str):
    task = make_task(session, test_user_id, estimate=10.0)
    start(session, test_user_id, task.id)

    _, log = checkout(session, test_user_id, remaining_estimate_hours=Decimal("2"))

    # The checkout logs at least a minute; the estimate is that plus the rest.
    logged = Decimal(log.actual_minutes) / Decimal(60)
    expected = (logged + Decimal("2")).quantize(Decimal("0.01"))
    assert stored_task(session, task.id).estimate_hours == expected


def test_complete_at_checkout_finishes_the_task(session: Session, test_user_id: str):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)

    WorkSessionService().checkout_session(
        session, test_user_id, WorkSessionCheckoutRequest(decision="complete")
    )

    assert stored_task(session, task.id).status == TaskStatus.COMPLETED


@pytest.mark.parametrize("decision", ["continue", "switch", "break"])
def test_other_decisions_at_checkout_leave_the_task_in_progress(
    session: Session, test_user_id: str, decision: str
):
    task = make_task(session, test_user_id)
    start(session, test_user_id, task.id)

    WorkSessionService().checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(
            decision=decision,
            kpt_keep="Kept focus",
            continue_reason="good_stopping_point" if decision == "continue" else None,
        ),
    )

    assert stored_task(session, task.id).status == TaskStatus.IN_PROGRESS


def test_a_checkout_whose_estimate_is_out_of_range_leaves_the_session_running(
    session: Session, test_user_id: str
):
    task = make_task(session, test_user_id, estimate=10.0)
    start(session, test_user_id, task.id)

    # The logged minute on top of 999.99 hours no longer fits the column.
    with pytest.raises(HTTPException) as caught:
        checkout(session, test_user_id, remaining_estimate_hours=Decimal("999.99"))

    assert caught.value.status_code == 400
    session.rollback()
    session.expire_all()
    assert session.exec(select(func.count()).select_from(Log)).one() == 0
    running = WorkSessionService().get_current_session(session, test_user_id)
    assert running is not None
    assert running.ended_at is None
    assert stored_task(session, task.id).estimate_hours == Decimal("10.00")
