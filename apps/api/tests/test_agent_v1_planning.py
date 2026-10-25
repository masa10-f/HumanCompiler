# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event
from sqlmodel import Session, select

from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentAuditLog,
    AgentScope,
    GoalDependency,
    GoalStatus,
    ProjectStatus,
    TaskDependency,
    TaskStatus,
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


@pytest.fixture(autouse=True)
def agent_session(session: Session):
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def test_me_returns_token_identity(session: Session):
    # No read scope: /me needs authentication only
    secret = issue_token(
        session, USER_A, [AgentScope.QUICK_TASKS_WRITE], name="My agent"
    )

    response = client.get("/api/agent/v1/me", headers=bearer(secret))

    assert response.status_code == 200
    body = response.json()
    assert body["token_name"] == "My agent"
    assert body["token_prefix"] == secret[: len(body["token_prefix"])]
    assert body["token_prefix"].startswith("hc_agent_")
    assert body["scopes"] == ["quick_tasks:write"]
    assert body["user_id"] == str(USER_A)


def test_me_returns_scopes_in_ascending_order(session: Session):
    secret = issue_token(
        session,
        USER_A,
        [AgentScope.TASKS_READ, AgentScope.GOALS_READ, AgentScope.PROJECTS_READ],
    )

    response = client.get("/api/agent/v1/me", headers=bearer(secret))

    assert response.json()["scopes"] == ["goals:read", "projects:read", "tasks:read"]


def test_me_rejects_supabase_jwt(session: Session):
    def part(payload: dict[str, str]) -> str:
        raw = json.dumps(payload).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    jwt_like = ".".join(
        [part({"alg": "HS256", "typ": "JWT"}), part({"sub": str(USER_A)}), "sig"]
    )

    response = client.get("/api/agent/v1/me", headers=bearer(jwt_like))

    assert response.status_code == 401


def test_list_projects_returns_only_own(session: Session):
    own = {
        seed_project(session, USER_A).id,
        seed_project(session, USER_A).id,
    }
    seed_project(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get("/api/agent/v1/projects", headers=bearer(secret))

    assert response.status_code == 200
    body = response.json()
    assert {UUID(item["id"]) for item in body["items"]} == own
    assert body["next_cursor"] is None


def test_list_projects_filters_by_status(session: Session):
    seed_project(session, USER_A, status=ProjectStatus.PENDING)
    active = seed_project(session, USER_A, status=ProjectStatus.IN_PROGRESS)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        "/api/agent/v1/projects",
        params={"status": "in_progress"},
        headers=bearer(secret),
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(active.id)]


def test_get_project_returns_own(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        f"/api/agent/v1/projects/{project.id}", headers=bearer(secret)
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(project.id)


def test_get_project_of_other_user_or_missing_is_404(session: Session):
    others = seed_project(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    for project_id in (others.id, uuid4()):
        response = client.get(
            f"/api/agent/v1/projects/{project_id}", headers=bearer(secret)
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"


def test_projects_require_projects_read_scope(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    for path in ("/api/agent/v1/projects", f"/api/agent/v1/projects/{project.id}"):
        response = client.get(path, headers=bearer(secret))
        assert response.status_code == 403
        assert response.json()["detail"] == "Missing required scope: projects:read"


def test_agent_read_is_audited_with_route_template(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    response = client.get(
        f"/api/agent/v1/projects/{project.id}", headers=bearer(secret)
    )

    assert response.status_code == 200
    session.expire_all()
    rows = list(session.exec(select(AgentAuditLog)).all())
    assert len(rows) == 1
    assert rows[0].route == "/api/agent/v1/projects/{project_id}"
    assert rows[0].required_scope == "projects:read"
    assert rows[0].status_code == 200


def test_list_endpoints_document_incremental_sync():
    description = app.openapi()["paths"]["/api/agent/v1/projects"]["get"]["description"]

    assert "5 minutes" in description


def test_list_goals_returns_only_own_and_filters(session: Session):
    project_1 = seed_project(session, USER_A)
    project_2 = seed_project(session, USER_A)
    goal_1 = seed_goal(session, project_1, status=GoalStatus.PENDING)
    goal_2 = seed_goal(session, project_2, status=GoalStatus.IN_PROGRESS)
    seed_goal(session, seed_project(session, USER_B))
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])

    def ids(params: dict[str, str]) -> set[str]:
        response = client.get(
            "/api/agent/v1/goals", params=params, headers=bearer(secret)
        )
        assert response.status_code == 200
        return {item["id"] for item in response.json()["items"]}

    assert ids({}) == {str(goal_1.id), str(goal_2.id)}
    assert ids({"project_id": str(project_1.id)}) == {str(goal_1.id)}
    assert ids({"status": "in_progress"}) == {str(goal_2.id)}


def test_list_tasks_returns_only_own_and_filters(session: Session):
    project_1 = seed_project(session, USER_A)
    project_2 = seed_project(session, USER_A)
    goal_1 = seed_goal(session, project_1)
    goal_2 = seed_goal(session, project_2)
    task_1 = seed_task(session, goal_1, status=TaskStatus.PENDING)
    task_2 = seed_task(session, goal_2, status=TaskStatus.COMPLETED)
    seed_task(session, seed_goal(session, seed_project(session, USER_B)))
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    def ids(params: dict[str, str]) -> set[str]:
        response = client.get(
            "/api/agent/v1/tasks", params=params, headers=bearer(secret)
        )
        assert response.status_code == 200
        return {item["id"] for item in response.json()["items"]}

    assert ids({}) == {str(task_1.id), str(task_2.id)}
    assert ids({"project_id": str(project_2.id)}) == {str(task_2.id)}
    assert ids({"goal_id": str(goal_1.id)}) == {str(task_1.id)}
    assert ids({"status": "completed"}) == {str(task_2.id)}


def test_filters_with_other_users_parent_return_empty(session: Session):
    others_project = seed_project(session, USER_B)
    others_goal = seed_goal(session, others_project)
    seed_task(session, others_goal)
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ]
    )

    for path, params in (
        ("/goals", {"project_id": str(others_project.id)}),
        ("/tasks", {"project_id": str(others_project.id)}),
        ("/tasks", {"goal_id": str(others_goal.id)}),
    ):
        response = client.get(
            f"/api/agent/v1{path}", params=params, headers=bearer(secret)
        )
        assert response.status_code == 200
        assert response.json()["items"] == []


def test_get_goal_and_task_of_other_user_or_missing_is_404(session: Session):
    others_goal = seed_goal(session, seed_project(session, USER_B))
    others_task = seed_task(session, others_goal)
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ]
    )

    for goal_id in (others_goal.id, uuid4()):
        response = client.get(f"/api/agent/v1/goals/{goal_id}", headers=bearer(secret))
        assert response.status_code == 404
        assert response.json()["detail"] == "Goal not found"
    for task_id in (others_task.id, uuid4()):
        response = client.get(f"/api/agent/v1/tasks/{task_id}", headers=bearer(secret))
        assert response.status_code == 404
        assert response.json()["detail"] == "Task not found"


def test_get_own_goal_and_task(session: Session):
    goal = seed_goal(session, seed_project(session, USER_A))
    task = seed_task(session, goal)
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ]
    )

    goal_response = client.get(f"/api/agent/v1/goals/{goal.id}", headers=bearer(secret))
    task_response = client.get(f"/api/agent/v1/tasks/{task.id}", headers=bearer(secret))

    assert goal_response.status_code == 200
    assert goal_response.json()["id"] == str(goal.id)
    assert task_response.status_code == 200
    assert task_response.json()["id"] == str(task.id)


def test_goal_and_task_responses_include_dependencies(session: Session):
    project = seed_project(session, USER_A)
    goal_1 = seed_goal(session, project)
    goal_2 = seed_goal(session, project)
    task_1 = seed_task(session, goal_1, estimate_hours=Decimal("2"))
    task_2 = seed_task(session, goal_1, estimate_hours=Decimal("3"))
    # Explicit ids: the server-side gen_random_uuid() default is Postgres-only.
    session.add(
        GoalDependency(id=uuid4(), goal_id=goal_2.id, depends_on_goal_id=goal_1.id)
    )
    session.add(
        TaskDependency(id=uuid4(), task_id=task_2.id, depends_on_task_id=task_1.id)
    )
    session.commit()
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ]
    )

    goals = client.get("/api/agent/v1/goals", headers=bearer(secret)).json()["items"]
    goal_detail = client.get(f"/api/agent/v1/goals/{goal_2.id}", headers=bearer(secret))
    tasks = client.get("/api/agent/v1/tasks", headers=bearer(secret)).json()["items"]
    task_detail = client.get(f"/api/agent/v1/tasks/{task_2.id}", headers=bearer(secret))

    by_goal = {item["id"]: item for item in goals}
    assert [
        d["depends_on_goal_id"] for d in by_goal[str(goal_2.id)]["dependencies"]
    ] == [str(goal_1.id)]
    assert by_goal[str(goal_1.id)]["dependencies"] == []
    assert by_goal[str(goal_1.id)]["estimate_hours"] == 5.0
    assert [d["depends_on_goal_id"] for d in goal_detail.json()["dependencies"]] == [
        str(goal_1.id)
    ]
    by_task = {item["id"]: item for item in tasks}
    assert [
        d["depends_on_task_id"] for d in by_task[str(task_2.id)]["dependencies"]
    ] == [str(task_1.id)]
    assert by_task[str(task_1.id)]["dependencies"] == []
    assert [d["depends_on_task_id"] for d in task_detail.json()["dependencies"]] == [
        str(task_1.id)
    ]


def test_goals_and_tasks_require_their_scopes(session: Session):
    goal = seed_goal(session, seed_project(session, USER_A))
    task = seed_task(session, goal)
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    for path, scope in (
        ("/goals", "goals:read"),
        (f"/goals/{goal.id}", "goals:read"),
        ("/tasks", "tasks:read"),
        (f"/tasks/{task.id}", "tasks:read"),
    ):
        response = client.get(f"/api/agent/v1{path}", headers=bearer(secret))
        assert response.status_code == 403
        assert response.json()["detail"] == f"Missing required scope: {scope}"


def _count_statements(session: Session, path: str, secret: str, **params) -> int:
    """Count SQL statements the app executes for one GET on ``path``."""
    statements: list[str] = []
    # The app shares this session, so loaded relationships would otherwise be
    # served from the identity map and hide per-row lazy loads.
    session.expire_all()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(path, params=params, headers=bearer(secret))
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200
    return len(statements)


def test_list_tasks_and_goals_query_count_does_not_grow_with_rows(session: Session):
    project = seed_project(session, USER_A)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    goals = [
        seed_goal(session, project, updated_at=base + timedelta(minutes=i))
        for i in range(12)
    ]
    tasks = [
        seed_task(session, goals[0], updated_at=base + timedelta(minutes=i))
        for i in range(12)
    ]
    # Each row depends on its predecessor, so every page row has dependencies.
    for i in range(1, 12):
        session.add(
            GoalDependency(
                id=uuid4(), goal_id=goals[i].id, depends_on_goal_id=goals[i - 1].id
            )
        )
        session.add(
            TaskDependency(
                id=uuid4(), task_id=tasks[i].id, depends_on_task_id=tasks[i - 1].id
            )
        )
    session.commit()
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.TASKS_READ]
    )
    # Warm-up: the first request also pays for per-request work (token touch,
    # audit insert) that is not per-row.
    client.get("/api/agent/v1/tasks", headers=bearer(secret))

    for path in ("/api/agent/v1/tasks", "/api/agent/v1/goals"):
        small = _count_statements(session, path, secret, limit=3)
        large = _count_statements(session, path, secret, limit=12)
        assert small == large, f"{path}: 3 rows -> {small}, 12 rows -> {large}"

    page = client.get(
        "/api/agent/v1/tasks", params={"limit": 3}, headers=bearer(secret)
    ).json()["items"]
    info = [d["depends_on_task"] for item in page for d in item["dependencies"]]
    assert len(info) == 2
    assert all(i is not None and i["id"] for i in info)


def test_list_tasks_paging_walk_with_shared_updated_at(session: Session):
    goal = seed_goal(session, seed_project(session, USER_A))
    stamp = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    shared = [seed_task(session, goal, updated_at=stamp) for _ in range(5)]
    # Older than updated_since below, so it must not appear in the walk.
    seed_task(session, goal, updated_at=stamp - timedelta(hours=1))
    seed_task(
        session, seed_goal(session, seed_project(session, USER_B)), updated_at=stamp
    )
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    seen: list[str] = []
    params: dict[str, str | int] = {
        "limit": 2,
        # 21:00+09:00 is exactly 12:00 UTC; params= encodes the "+".
        "updated_since": "2026-01-01T21:00:00+09:00",
    }
    pages = 0
    while True:
        response = client.get(
            "/api/agent/v1/tasks", params=params, headers=bearer(secret)
        )
        assert response.status_code == 200
        body = response.json()
        seen.extend(item["id"] for item in body["items"])
        pages += 1
        if body["next_cursor"] is None:
            break
        params["cursor"] = body["next_cursor"]
        assert pages < 10

    assert pages == 3
    assert seen == [str(t.id) for t in sorted(shared, key=lambda t: t.id)]
