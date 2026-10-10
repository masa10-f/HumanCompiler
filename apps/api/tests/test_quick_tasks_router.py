# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.models import QuickTask, TaskStatus, User, WorkType
from humancompiler_api.routers import quick_tasks
from humancompiler_api.services import quick_task_service


@pytest.fixture
def owner(session: Session) -> User:
    user = User(id=uuid4(), email="quick-tasks@example.com")
    session.add(user)
    session.commit()
    return user


@pytest.fixture
def quick_task_rows(session: Session, owner: User) -> dict[str, QuickTask]:
    """Older active tasks hidden behind newer closed ones in created_at order."""
    base = datetime(2026, 1, 1, tzinfo=UTC)
    statuses = {
        "old_pending": TaskStatus.PENDING,
        "old_in_progress": TaskStatus.IN_PROGRESS,
        "new_completed": TaskStatus.COMPLETED,
        "newer_cancelled": TaskStatus.CANCELLED,
        "newest_completed": TaskStatus.COMPLETED,
    }
    rows = {}
    for offset, (title, task_status) in enumerate(statuses.items()):
        row = QuickTask(
            id=uuid4(),
            owner_id=owner.id,
            title=title,
            estimate_hours=Decimal("0.5"),
            status=task_status,
            work_type=WorkType.LIGHT_WORK,
            priority=3,
            created_at=base + timedelta(hours=offset),
            updated_at=base + timedelta(hours=offset),
        )
        session.add(row)
        rows[title] = row
    session.commit()
    return rows


@pytest.fixture
def client(session: Session, owner: User) -> TestClient:
    app = FastAPI()
    app.include_router(quick_tasks.router, prefix="/api")

    def override_session():
        yield session

    app.dependency_overrides[quick_tasks.get_session] = override_session
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        user_id=str(owner.id), email=owner.email
    )
    return TestClient(app)


def test_status_filter_accepts_multiple_values_before_pagination(
    client: TestClient, quick_task_rows
):
    response = client.get(
        "/api/quick-tasks/",
        params=[("limit", "2"), ("status", "pending"), ("status", "in_progress")],
    )

    assert response.status_code == 200
    assert [task["title"] for task in response.json()] == [
        "old_in_progress",
        "old_pending",
    ]


def test_status_filter_still_accepts_a_single_value(
    client: TestClient, quick_task_rows
):
    response = client.get("/api/quick-tasks/", params={"status": "completed"})

    assert response.status_code == 200
    assert [task["title"] for task in response.json()] == [
        "newest_completed",
        "new_completed",
    ]


def test_get_active_quick_tasks_excludes_closed_statuses(
    session: Session, owner: User, quick_task_rows
):
    active = quick_task_service.get_active_quick_tasks(session, owner.id)

    assert {task.title for task in active} == {"old_pending", "old_in_progress"}


JST = timezone(timedelta(hours=9))


def test_create_accepts_date_only_due_date_as_jst(client: TestClient):
    response = client.post(
        "/api/quick-tasks/",
        json={"title": "dated", "estimate_hours": 0.5, "due_date": "2026-10-20"},
    )

    assert response.status_code == 201
    due_date = datetime.fromisoformat(response.json()["due_date"])
    assert due_date == datetime(2026, 10, 20, tzinfo=JST)


def test_update_accepts_date_only_due_date_as_jst(client: TestClient, quick_task_rows):
    task_id = quick_task_rows["old_pending"].id

    response = client.put(
        f"/api/quick-tasks/{task_id}", json={"due_date": "2026-11-01"}
    )

    assert response.status_code == 200
    due_date = datetime.fromisoformat(response.json()["due_date"])
    assert due_date == datetime(2026, 11, 1, tzinfo=JST)


def test_create_rejects_due_date_without_timezone_offset(client: TestClient):
    response = client.post(
        "/api/quick-tasks/",
        json={
            "title": "ambiguous",
            "estimate_hours": 0.5,
            "due_date": "2026-10-20T10:00:00",
        },
    )

    assert response.status_code == 422


def test_update_clears_due_date_and_description_with_null(
    client: TestClient, quick_task_rows
):
    task_id = quick_task_rows["old_pending"].id
    client.put(
        f"/api/quick-tasks/{task_id}",
        json={"due_date": "2026-11-01", "description": "memo"},
    )

    response = client.put(
        f"/api/quick-tasks/{task_id}", json={"due_date": None, "description": None}
    )

    assert response.status_code == 200
    assert response.json()["due_date"] is None
    assert response.json()["description"] is None
