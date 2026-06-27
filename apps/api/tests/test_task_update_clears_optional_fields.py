from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import TaskCreate, TaskUpdate
from humancompiler_api.services import TaskService


def test_update_task_with_explicit_null_clears_description_and_due_date(
    session: Session, test_user_id: str
):
    data = create_test_data(session, test_user_id)
    task_service = TaskService()
    due_date = datetime(2026, 1, 15, tzinfo=UTC)
    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Task with optional fields",
            description="Clear me",
            estimate_hours=2,
            due_date=due_date,
        ),
        test_user_id,
    )

    updated_task = task_service.update_task(
        session,
        task.id,
        test_user_id,
        TaskUpdate(description=None, due_date=None),
    )

    assert updated_task.description is None
    assert updated_task.due_date is None

    session.expire_all()
    persisted_task = task_service.get_task(session, task.id, test_user_id)
    assert persisted_task.description is None
    assert persisted_task.due_date is None


def test_task_update_validation_matches_task_database_constraints():
    TaskUpdate(
        title="a" * 200,
        description="b" * 1000,
        memo="c" * 2000,
        estimate_hours=Decimal("999.99"),
    )

    invalid_inputs = [
        {"title": "a" * 201},
        {"description": "b" * 1001},
        {"memo": "c" * 2001},
        {"estimate_hours": Decimal("1000.00")},
        {"estimate_hours": Decimal("1.234")},
    ]

    for invalid_input in invalid_inputs:
        with pytest.raises(ValidationError):
            TaskUpdate(**invalid_input)
