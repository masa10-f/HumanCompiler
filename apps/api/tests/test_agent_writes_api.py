# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API: goal and task create and update under /api/agent/v1."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, func, select

from humancompiler_api import agent_write_service
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentChange,
    AgentScope,
    AgentToken,
    Goal,
    GoalStatus,
    Project,
    Task,
    TaskStatus,
    WorkType,
)
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_project,
    seed_task,
    seed_user,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

BASE = "/api/agent/v1"
WRITE = [AgentScope.GOALS_WRITE, AgentScope.TASKS_WRITE]
UNCONFIRMED = [*WRITE, AgentScope.WRITES_UNCONFIRMED]
STAMP = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
NEEDS_UNCONFIRMED = "This change needs the writes:unconfirmed scope"
STALE_MESSAGE = "Changed since you read it; read it again and retry"


@pytest.fixture(autouse=True)
def agent_session(session: Session):
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _changes(session: Session) -> list[AgentChange]:
    session.expire_all()
    return list(session.exec(select(AgentChange)).all())


def _count(session: Session, model: Any) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


def _tree(session: Session, owner: UUID = USER_A) -> tuple[Project, Goal, Task]:
    project = seed_project(session, owner, updated_at=STAMP)
    goal = seed_goal(session, project, updated_at=STAMP)
    task = seed_task(session, goal, updated_at=STAMP)
    return project, goal, task


def _set(session: Session, entity: Any, **values: Any) -> None:
    for name, value in values.items():
        setattr(entity, name, value)
    session.add(entity)
    session.commit()
    session.refresh(entity)


def _patch(path: str, token: str, **body: Any):
    body.setdefault("expected_updated_at", STAMP.isoformat())
    return client.patch(f"{BASE}{path}", json=body, headers=bearer(token))


def test_write_scopes_required(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ])
    expected = STAMP.isoformat()
    calls = [
        (
            "post",
            "/goals",
            {"project_id": str(goal.project_id), "title": "G"},
            "goals:write",
        ),
        (
            "patch",
            f"/goals/{goal.id}",
            {"expected_updated_at": expected, "title": "G"},
            "goals:write",
        ),
        (
            "post",
            "/tasks",
            {"goal_id": str(goal.id), "title": "T", "estimate_hours": 1},
            "tasks:write",
        ),
        (
            "patch",
            f"/tasks/{task.id}",
            {"expected_updated_at": expected, "title": "T"},
            "tasks:write",
        ),
    ]
    for method, path, body, scope in calls:
        response = getattr(client, method)(
            f"{BASE}{path}", json=body, headers=bearer(token)
        )
        assert response.status_code == 403, (method, path)
        assert response.json()["detail"] == f"Missing required scope: {scope}"
    assert _changes(session) == []


def test_create_goal_and_task(session: Session):
    project = seed_project(session, USER_A)
    token = issue_token(session, USER_A, WRITE, name="distiller")

    response = client.post(
        f"{BASE}/goals",
        json={
            "project_id": str(project.id),
            "title": "New goal",
            "description": "Why",
            "due_date": "2026-12-01",
        },
        headers=bearer(token),
    )
    assert response.status_code == 201, response.text
    goal_body = response.json()
    assert goal_body["title"] == "New goal"
    assert goal_body["description"] == "Why"
    assert goal_body["project_id"] == str(project.id)
    assert goal_body["dependencies"] == []
    goal_id = UUID(goal_body["id"])

    response = client.post(
        f"{BASE}/tasks",
        json={
            "goal_id": str(goal_id),
            "title": "New task",
            "estimate_hours": "1.5",
            "priority": 2,
            "work_type": "study",
        },
        headers=bearer(token),
    )
    assert response.status_code == 201, response.text
    task_body = response.json()
    assert task_body["title"] == "New task"
    assert task_body["estimate_hours"] == 1.5
    assert task_body["priority"] == 2
    assert task_body["work_type"] == "study"
    assert task_body["goal_id"] == str(goal_id)
    task_id = UUID(task_body["id"])

    session.expire_all()
    goal = session.get(Goal, goal_id)
    task = session.get(Task, task_id)
    assert goal is not None and goal.project.owner_id == USER_A
    assert task is not None and task.goal_id == goal_id

    changes = sorted(_changes(session), key=lambda row: row.entity_type)
    assert [row.entity_type for row in changes] == ["goal", "task"]
    goal_change, task_change = changes
    token_row = session.exec(select(AgentToken)).one()
    for row in changes:
        assert row.action == "create"
        assert row.destructive is False
        assert row.before is None
        assert row.actor == "agent"
        assert row.user_id == USER_A
        assert row.agent_name == "distiller"
        assert row.agent_token_id == token_row.id
        assert row.project_id == project.id
        assert row.goal_id == goal_id
    assert goal_change.entity_id == goal_id
    assert goal_change.after["title"] == "New goal"
    assert goal_change.after["due_date"].startswith("2026-11-30T15:00:00")
    assert task_change.entity_id == task_id
    assert task_change.after["title"] == "New task"
    assert task_change.after["priority"] == 2


def test_create_rejects_extra_fields_including_depends_on(session: Session):
    _, goal, _ = _tree(session)
    token = issue_token(session, USER_A, WRITE)
    response = client.post(
        f"{BASE}/tasks",
        json={
            "goal_id": str(goal.id),
            "title": "T",
            "estimate_hours": 1,
            "depends_on": [],
        },
        headers=bearer(token),
    )
    assert response.status_code == 422
    response = client.post(
        f"{BASE}/goals",
        json={"project_id": str(goal.project_id), "title": "G", "status": "pending"},
        headers=bearer(token),
    )
    assert response.status_code == 422
    assert _changes(session) == []


def test_create_under_foreign_or_missing_parent_is_404(session: Session):
    _, foreign_goal, _ = _tree(session, owner=USER_B)
    token = issue_token(session, USER_A, WRITE)
    goals_before = _count(session, Goal)
    tasks_before = _count(session, Task)

    for project_id in (foreign_goal.project_id, uuid4()):
        response = client.post(
            f"{BASE}/goals",
            json={"project_id": str(project_id), "title": "G"},
            headers=bearer(token),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"

    for goal_id in (foreign_goal.id, uuid4()):
        response = client.post(
            f"{BASE}/tasks",
            json={"goal_id": str(goal_id), "title": "T", "estimate_hours": 1},
            headers=bearer(token),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Goal not found"

    assert _count(session, Goal) == goals_before
    assert _count(session, Task) == tasks_before
    assert _changes(session) == []


def test_update_ordinary_fields(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, WRITE)

    response = _patch(
        f"/tasks/{task.id}",
        token,
        title="Renamed",
        estimate_hours="2.5",
        due_date="2026-12-01",
        status="completed",
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Renamed"
    assert body["estimate_hours"] == 2.5
    assert body["status"] == "completed"

    session.expire_all()
    stored = session.get(Task, task.id)
    assert stored is not None
    assert _utc(stored.due_date) == datetime(2026, 11, 30, 15, 0, tzinfo=UTC)
    assert _utc(stored.updated_at) != STAMP
    assert stored.estimate_hours == Decimal("2.5")

    changes = _changes(session)
    assert len(changes) == 1
    change = changes[0]
    fields = {"title", "estimate_hours", "due_date", "status"}
    assert change.action == "update"
    assert change.entity_type == "task"
    assert change.entity_id == task.id
    assert change.destructive is False
    assert change.goal_id == goal.id
    assert change.project_id == goal.project_id
    assert set(change.before or {}) == fields
    assert set(change.after) == fields
    assert change.before is not None and change.before["title"] == "Task"
    assert change.before["due_date"] is None
    assert change.after["title"] == "Renamed"
    assert change.after["status"] == "completed"
    assert change.after["due_date"].startswith("2026-11-30T15:00:00")

    response = _patch(
        f"/goals/{goal.id}", token, title="Goal renamed", due_date="2026-12-01"
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Goal renamed"
    goal_change = [row for row in _changes(session) if row.entity_type == "goal"]
    assert len(goal_change) == 1
    assert set(goal_change[0].after) == {"title", "due_date"}
    assert goal_change[0].goal_id == goal.id
    assert goal_change[0].project_id == goal.project_id


def test_update_requires_expected_updated_at(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, WRITE)
    for path in (f"/tasks/{task.id}", f"/goals/{goal.id}"):
        response = client.patch(
            f"{BASE}{path}", json={"title": "X"}, headers=bearer(token)
        )
        assert response.status_code == 422, path
    assert _changes(session) == []


def test_update_rejects_null_for_required_fields(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, UNCONFIRMED)
    for field in ("title", "estimate_hours", "status", "goal_id"):
        response = _patch(f"/tasks/{task.id}", token, **{field: None})
        assert response.status_code == 422, field
    for field in ("title", "status"):
        response = _patch(f"/goals/{goal.id}", token, **{field: None})
        assert response.status_code == 422, field
    assert _changes(session) == []


def test_stale_expected_updated_at_is_409(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, UNCONFIRMED)
    stale = datetime(2026, 10, 1, tzinfo=UTC).isoformat()

    for path in (f"/tasks/{task.id}", f"/goals/{goal.id}"):
        response = _patch(path, token, title="Changed", expected_updated_at=stale)
        assert response.status_code == 409, path
        detail = response.json()["detail"]
        assert detail["message"] == STALE_MESSAGE
        assert datetime.fromisoformat(detail["current_updated_at"]) == STAMP

    session.expire_all()
    assert session.get(Task, task.id).title == "Task"  # type: ignore[union-attr]
    assert session.get(Goal, goal.id).title == "Goal"  # type: ignore[union-attr]
    assert _changes(session) == []


def test_expected_updated_at_accepts_naive_and_other_offsets(session: Session):
    _, _, task = _tree(session)
    token = issue_token(session, USER_A, WRITE)
    response = _patch(
        f"/tasks/{task.id}",
        token,
        title="A",
        expected_updated_at="2026-11-01T21:00:00+09:00",
    )
    assert response.status_code == 200, response.text
    new_stamp = datetime.fromisoformat(response.json()["updated_at"])
    response = _patch(
        f"/tasks/{task.id}",
        token,
        title="B",
        expected_updated_at=new_stamp.replace(tzinfo=None).isoformat(),
    )
    assert response.status_code == 200, response.text


def test_noop_update(session: Session):
    _, goal, task = _tree(session)
    _set(session, task, description="Keep", due_date=datetime(2026, 12, 1, tzinfo=UTC))
    _set(session, task, updated_at=STAMP)
    token = issue_token(session, USER_A, WRITE)

    response = _patch(
        f"/tasks/{task.id}",
        token,
        title="Task",
        description="Keep",
        estimate_hours=1,
        status="pending",
        due_date="2026-12-01T09:00:00+09:00",
        goal_id=str(goal.id),
        priority=3,
    )
    assert response.status_code == 200, response.text
    response = _patch(f"/goals/{goal.id}", token, title="Goal", status="pending")
    assert response.status_code == 200, response.text

    session.expire_all()
    assert _utc(session.get(Task, task.id).updated_at) == STAMP  # type: ignore[union-attr]
    assert _utc(session.get(Goal, goal.id).updated_at) == STAMP  # type: ignore[union-attr]
    assert _changes(session) == []


def _destructive_cases(
    session: Session,
) -> list[tuple[str, dict[str, Any], Any, dict[str, Any]]]:
    """(path, body, entity, stored values) for each destructive change."""
    _, goal, task = _tree(session)
    other_goal = seed_goal(session, goal.project, updated_at=STAMP)
    _set(session, task, description="Old description", memo="Old memo")
    _set(session, task, updated_at=STAMP)
    _set(session, goal, description="Goal description")
    _set(session, goal, updated_at=STAMP)
    task_values = {
        "status": TaskStatus.PENDING,
        "description": "Old description",
        "memo": "Old memo",
        "goal_id": goal.id,
    }
    goal_values = {"status": GoalStatus.PENDING, "description": "Goal description"}
    return [
        (f"/tasks/{task.id}", {"status": "cancelled"}, task, task_values),
        (f"/tasks/{task.id}", {"description": "New"}, task, task_values),
        (f"/tasks/{task.id}", {"memo": "New memo"}, task, task_values),
        (f"/tasks/{task.id}", {"goal_id": str(other_goal.id)}, task, task_values),
        (f"/goals/{goal.id}", {"status": "cancelled"}, goal, goal_values),
        (f"/goals/{goal.id}", {"description": None}, goal, goal_values),
    ]


def test_destructive_without_unconfirmed_is_403(session: Session):
    cases = _destructive_cases(session)
    token = issue_token(session, USER_A, WRITE)
    for path, body, entity, stored in cases:
        response = _patch(path, token, **body)
        assert response.status_code == 403, (path, body)
        assert response.json()["detail"] == NEEDS_UNCONFIRMED
        session.expire_all()
        current = session.get(type(entity), entity.id)
        for name, value in stored.items():
            assert getattr(current, name) == value, (path, body, name)
        assert _utc(current.updated_at) == STAMP
    assert _changes(session) == []


def test_mixed_patch_without_unconfirmed_writes_nothing(session: Session):
    _, goal, task = _tree(session)
    token = issue_token(session, USER_A, WRITE)
    for path in (f"/tasks/{task.id}", f"/goals/{goal.id}"):
        response = _patch(path, token, title="Renamed", status="cancelled")
        assert response.status_code == 403, path
        assert response.json()["detail"] == NEEDS_UNCONFIRMED
    session.expire_all()
    assert session.get(Task, task.id).title == "Task"  # type: ignore[union-attr]
    assert session.get(Goal, goal.id).title == "Goal"  # type: ignore[union-attr]
    assert _changes(session) == []


def test_destructive_with_unconfirmed(session: Session):
    cases = _destructive_cases(session)
    token = issue_token(session, USER_A, UNCONFIRMED)
    old_goal_id = cases[0][3]["goal_id"]
    for path, body, entity, _ in cases:
        session.expire_all()
        current = session.get(type(entity), entity.id)
        stamp = _utc(current.updated_at)
        response = _patch(path, token, expected_updated_at=stamp.isoformat(), **body)
        assert response.status_code == 200, (path, body, response.text)

    changes = sorted(_changes(session), key=lambda row: row.created_at)
    assert len(changes) == len(cases)
    assert all(row.destructive for row in changes)
    move = changes[3]
    new_goal_id = UUID(cases[3][1]["goal_id"])
    assert move.before == {"goal_id": str(old_goal_id)}
    assert move.after == {"goal_id": str(new_goal_id)}
    assert move.goal_id == new_goal_id
    cleared = changes[5]
    assert cleared.before == {"description": "Goal description"}
    assert cleared.after == {"description": None}

    session.expire_all()
    task = session.get(Task, cases[0][2].id)
    goal = session.get(Goal, cases[4][2].id)
    assert task is not None and goal is not None
    assert task.status == TaskStatus.CANCELLED
    assert task.description == "New"
    assert task.memo == "New memo"
    assert task.goal_id == new_goal_id
    assert goal.status == GoalStatus.CANCELLED
    assert goal.description is None


def test_move_to_foreign_goal_is_404(session: Session):
    _, _, task = _tree(session)
    _, foreign_goal, _ = _tree(session, owner=USER_B)
    token = issue_token(session, USER_A, UNCONFIRMED)
    for goal_id in (foreign_goal.id, uuid4()):
        response = _patch(f"/tasks/{task.id}", token, goal_id=str(goal_id))
        assert response.status_code == 404
        assert response.json()["detail"] == "Goal not found"
    session.expire_all()
    assert session.get(Task, task.id).goal_id != foreign_goal.id  # type: ignore[union-attr]
    assert _changes(session) == []


def test_memo_append_is_ordinary(session: Session):
    _, _, task = _tree(session)
    token = issue_token(session, USER_A, WRITE)

    response = _patch(f"/tasks/{task.id}", token, memo_append="First")
    assert response.status_code == 200, response.text
    assert response.json()["memo"] == "First"
    stamp = response.json()["updated_at"]
    response = _patch(
        f"/tasks/{task.id}", token, memo_append="Second", expected_updated_at=stamp
    )
    assert response.status_code == 200, response.text
    assert response.json()["memo"] == "First\nSecond"

    changes = sorted(_changes(session), key=lambda row: row.created_at)
    assert len(changes) == 2
    assert changes[0].action == "update"
    assert changes[0].destructive is False
    assert changes[0].before == {"memo_length": 0}
    assert changes[0].after == {"memo_append": "First"}
    assert changes[1].before == {"memo_length": 5}
    assert changes[1].after == {"memo_append": "Second"}

    stamp = response.json()["updated_at"]
    response = _patch(
        f"/tasks/{task.id}",
        token,
        memo="x",
        memo_append="y",
        expected_updated_at=stamp,
    )
    assert response.status_code == 422

    response = _patch(
        f"/tasks/{task.id}", token, memo_append="z" * 2000, expected_updated_at=stamp
    )
    assert response.status_code == 422
    session.expire_all()
    assert session.get(Task, task.id).memo == "First\nSecond"  # type: ignore[union-attr]
    assert len(_changes(session)) == 2


def test_goal_invalid_status_transition_is_422(session: Session):
    _, goal, _ = _tree(session)
    token = issue_token(session, USER_A, UNCONFIRMED)
    response = _patch(f"/goals/{goal.id}", token, status="completed")
    assert response.status_code == 422
    assert "Invalid status transition" in response.json()["detail"]
    session.expire_all()
    assert session.get(Goal, goal.id).status == GoalStatus.PENDING  # type: ignore[union-attr]
    assert _changes(session) == []


def test_other_users_task_is_404(session: Session):
    _, foreign_goal, foreign_task = _tree(session, owner=USER_B)
    token = issue_token(session, USER_A, UNCONFIRMED)
    for task_id in (foreign_task.id, uuid4()):
        response = _patch(f"/tasks/{task_id}", token, title="Mine")
        assert response.status_code == 404
        assert response.json()["detail"] == "Task not found"
    for goal_id in (foreign_goal.id, uuid4()):
        response = _patch(f"/goals/{goal_id}", token, title="Mine")
        assert response.status_code == 404
        assert response.json()["detail"] == "Goal not found"
    session.expire_all()
    assert session.get(Task, foreign_task.id).title == "Task"  # type: ignore[union-attr]
    assert session.get(Goal, foreign_goal.id).title == "Goal"  # type: ignore[union-attr]
    assert _changes(session) == []


def test_clear_optional_task_fields(session: Session):
    _, _, task = _tree(session)
    _set(
        session,
        task,
        description="Old",
        memo="Old memo",
        due_date=datetime(2026, 12, 1, tzinfo=UTC),
        updated_at=STAMP,
    )
    token = issue_token(session, USER_A, UNCONFIRMED)
    response = _patch(
        f"/tasks/{task.id}", token, description=None, memo=None, due_date=None
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["description"] is None
    assert body["memo"] is None
    assert body["due_date"] is None
    change = _changes(session)[0]
    assert change.after == {"description": None, "memo": None, "due_date": None}


@pytest.mark.parametrize("field", ["priority", "work_type"])
def test_null_priority_or_work_type_is_422(session: Session, field: str):
    _, goal, task = _tree(session)
    _set(session, task, priority=1, work_type=WorkType.STUDY, updated_at=STAMP)
    token = issue_token(session, USER_A, UNCONFIRMED)

    response = _patch(f"/tasks/{task.id}", token, **{field: None})
    assert response.status_code == 422, response.text
    response = client.post(
        f"{BASE}/tasks",
        json={"goal_id": str(goal.id), "title": "T", "estimate_hours": 1, field: None},
        headers=bearer(token),
    )
    assert response.status_code == 422, response.text

    session.expire_all()
    stored = session.get(Task, task.id)
    assert stored is not None
    assert stored.priority == 1
    assert stored.work_type == WorkType.STUDY
    assert _utc(stored.updated_at) == STAMP
    assert _count(session, Task) == 1
    assert _changes(session) == []


def test_move_to_goal_in_another_project(session: Session):
    project, old_goal, task = _tree(session)
    other_project = seed_project(session, USER_A, updated_at=STAMP)
    new_goal = seed_goal(session, other_project, updated_at=STAMP)
    token = issue_token(session, USER_A, UNCONFIRMED)

    response = _patch(f"/tasks/{task.id}", token, goal_id=str(new_goal.id))
    assert response.status_code == 200, response.text
    assert response.json()["goal_id"] == str(new_goal.id)

    changes = _changes(session)
    assert len(changes) == 1
    change = changes[0]
    assert change.destructive is True
    assert change.before == {"goal_id": str(old_goal.id)}
    assert change.after == {"goal_id": str(new_goal.id)}
    assert change.goal_id == new_goal.id
    assert change.project_id == other_project.id
    assert change.project_id != project.id


def test_memo_append_with_destructive_field_without_unconfirmed_is_403(
    session: Session,
):
    _, _, task = _tree(session)
    _set(session, task, memo="Kept", updated_at=STAMP)
    token = issue_token(session, USER_A, WRITE)

    response = _patch(
        f"/tasks/{task.id}", token, memo_append="More", status="cancelled"
    )
    assert response.status_code == 403
    assert response.json()["detail"] == NEEDS_UNCONFIRMED

    session.expire_all()
    stored = session.get(Task, task.id)
    assert stored is not None
    assert stored.memo == "Kept"
    assert stored.status == TaskStatus.PENDING
    assert _utc(stored.updated_at) == STAMP
    assert _changes(session) == []


def test_change_row_agent_name_and_token(session: Session):
    _, _, task = _tree(session)
    token = issue_token(session, USER_A, WRITE, name="first-name")
    token_row = session.exec(select(AgentToken)).one()

    response = _patch(f"/tasks/{task.id}", token, title="One")
    assert response.status_code == 200, response.text
    _set(session, token_row, name="second-name")
    response = _patch(
        f"/tasks/{task.id}",
        token,
        title="Two",
        expected_updated_at=response.json()["updated_at"],
    )
    assert response.status_code == 200, response.text

    changes = sorted(_changes(session), key=lambda row: row.created_at)
    assert [row.agent_name for row in changes] == ["first-name", "second-name"]
    assert all(row.agent_token_id == token_row.id for row in changes)
    assert all(row.actor == "agent" for row in changes)
    assert all(row.user_id == USER_A for row in changes)


def test_missing_stored_updated_at_is_a_server_fault():
    task = Task(id=uuid4(), goal_id=uuid4(), title="T", estimate_hours=Decimal("1"))
    task.updated_at = None
    with pytest.raises(RuntimeError):
        agent_write_service._stored_updated_at(task)
