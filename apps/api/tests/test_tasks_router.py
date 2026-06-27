import logging
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from humancompiler_api.auth import AuthUser
from humancompiler_api.models import Task, TaskCreate
from humancompiler_api.routers import tasks


@pytest.mark.asyncio
async def test_create_task_logs_only_task_id_and_user_id(monkeypatch, caplog):
    """Task creation logs should not include user-authored task content."""
    user_id = UUID("12345678-1234-1234-1234-123456789012")
    goal_id = uuid4()
    task_id = uuid4()
    task_data = TaskCreate(
        goal_id=goal_id,
        title="Sensitive task title",
        description="Sensitive task description",
        memo="Sensitive task memo",
        estimate_hours=Decimal("1.5"),
    )
    created_task = Task(
        id=task_id,
        goal_id=goal_id,
        title=task_data.title,
        description=task_data.description,
        memo=task_data.memo,
        estimate_hours=task_data.estimate_hours,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )

    def create_task(session, received_task_data, received_user_id):
        assert received_task_data is task_data
        assert received_user_id == user_id
        return created_task

    monkeypatch.setattr(tasks.task_service, "create_task", create_task)

    with caplog.at_level(logging.INFO, logger=tasks.logger.name):
        response = await tasks.create_task(
            task_data,
            session=None,
            current_user=AuthUser(user_id=user_id, email="test@example.com"),
        )

    assert response.id == task_id
    assert str(task_id) in caplog.text
    assert str(user_id) in caplog.text
    assert "Sensitive task title" not in caplog.text
    assert "Sensitive task description" not in caplog.text
    assert "Sensitive task memo" not in caplog.text
