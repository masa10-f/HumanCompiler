"""
Test cases for updating task estimate hours via Runner checkout remaining_estimate_hours
"""

from decimal import Decimal, ROUND_HALF_UP

from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import (
    Task,
    TaskCreate,
    WorkSessionStartRequest,
    WorkSessionCheckoutRequest,
)
from humancompiler_api.services import TaskService, WorkSessionService


def _quantize_hours(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def test_checkout_updates_task_estimate_hours_when_remaining_provided(
    session: Session, test_user_id: str
):
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Runner Task",
            description="Task for remaining estimate update test",
            estimate_hours=10.0,
        ),
        test_user_id,
    )

    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at="2030-01-01T00:00:00Z",
            planned_outcome=None,
        ),
        test_user_id,
    )

    remaining = Decimal("3.50")
    work_session, generated_log = work_session_service.checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(
            decision="switch",
            remaining_estimate_hours=remaining,
        ),
    )

    updated_task = session.get(Task, task.id)
    assert updated_task is not None

    total_minutes = Decimal(generated_log.actual_minutes)
    expected_estimate_hours = _quantize_hours(total_minutes / Decimal(60) + remaining)
    assert updated_task.estimate_hours == expected_estimate_hours

    # WorkSession still stores the provided remaining estimate for reference
    assert work_session.remaining_estimate_hours == remaining


def test_checkout_does_not_update_task_estimate_hours_when_remaining_missing(
    session: Session, test_user_id: str
):
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Runner Task (no remaining)",
            description="Task for remaining estimate update test",
            estimate_hours=10.0,
        ),
        test_user_id,
    )

    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at="2030-01-01T00:00:00Z",
            planned_outcome=None,
        ),
        test_user_id,
    )

    work_session_service.checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(decision="switch"),
    )

    updated_task = session.get(Task, task.id)
    assert updated_task is not None
    assert _quantize_hours(updated_task.estimate_hours) == Decimal("10.00")
