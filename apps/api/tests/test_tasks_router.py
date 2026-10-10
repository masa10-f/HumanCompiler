# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
import logging
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from conftest import create_test_data
from humancompiler_api.auth import AuthUser
from humancompiler_api.models import Task, TaskCreate, TaskDependency, TaskUpdate
from humancompiler_api.routers import tasks

JST = timezone(timedelta(hours=9))


def test_create_task_keeps_no_slash_route_out_of_schema():
    create_routes = [
        route
        for route in tasks.router.routes
        if getattr(route, "endpoint", None) is tasks.create_task
        and "POST" in getattr(route, "methods", set())
    ]

    routes_by_path = {route.path: route for route in create_routes}

    assert "/tasks/" in routes_by_path
    assert "/tasks" in routes_by_path
    assert routes_by_path["/tasks/"].include_in_schema is True
    assert routes_by_path["/tasks"].include_in_schema is False


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


def test_build_task_responses_with_dependencies_batches_project_tasks(
    session, test_user_id
):
    data = create_test_data(session, test_user_id)
    goal = data["goal"]
    blocked_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Blocked task",
        estimate_hours=Decimal("1.0"),
    )
    prerequisite_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Prerequisite task",
        estimate_hours=Decimal("1.0"),
    )
    dependency = TaskDependency(
        id=uuid4(),
        task_id=blocked_task.id,
        depends_on_task_id=prerequisite_task.id,
    )
    session.add(blocked_task)
    session.add(prerequisite_task)
    session.add(dependency)
    session.flush()

    responses = tasks.build_task_responses_with_dependencies(
        session, [blocked_task], test_user_id
    )

    assert len(responses) == 1
    assert len(responses[0].dependencies) == 1
    assert responses[0].dependencies[0].depends_on_task_id == prerequisite_task.id
    assert responses[0].dependencies[0].depends_on_task.title == "Prerequisite task"


def test_task_create_persists_date_only_due_date_as_jst(session, test_user_id):
    data = create_test_data(session, test_user_id)

    task = tasks.task_service.create_task(
        session,
        TaskCreate.model_validate(
            {
                "goal_id": data["goal"].id,
                "title": "Dated task",
                "estimate_hours": 1,
                "due_date": "2026-10-20",
            }
        ),
        test_user_id,
    )
    session.commit()
    session.refresh(task)

    assert task.due_date == datetime(2026, 10, 20, tzinfo=JST)


def test_task_input_models_read_date_only_due_dates_as_jst():
    create_data = TaskCreate.model_validate(
        {
            "goal_id": uuid4(),
            "title": "Dated task",
            "estimate_hours": 1,
            "due_date": "2026-10-20",
        }
    )
    update_data = TaskUpdate.model_validate({"due_date": "2026-11-01"})

    assert create_data.due_date == datetime(2026, 10, 20, tzinfo=JST)
    assert update_data.due_date == datetime(2026, 11, 1, tzinfo=JST)


def test_task_input_models_reject_naive_due_datetimes():
    with pytest.raises(ValidationError, match="timezone offset"):
        TaskCreate(
            goal_id=uuid4(),
            title="Ambiguous task",
            estimate_hours=Decimal("1"),
            due_date=datetime(2026, 10, 20, 10),
        )

    with pytest.raises(ValidationError, match="timezone offset"):
        TaskUpdate(due_date=datetime(2026, 11, 1, 10))
