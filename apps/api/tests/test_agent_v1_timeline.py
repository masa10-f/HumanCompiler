# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""GET /api/agent/v1/projects/{id}/timeline, the roadmap CLI's data source."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api import agent_audit
from humancompiler_api.agent_auth import require_scopes
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentAuditLog,
    AgentScope,
    GoalDependency,
    TriageCapacitySettings,
)
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_log,
    seed_project,
    seed_task,
    seed_user,
    use_session,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
TIMELINE_SCOPES = [
    AgentScope.PROJECTS_READ,
    AgentScope.GOALS_READ,
    AgentScope.TASKS_READ,
    AgentScope.LOGS_READ,
]


@pytest.fixture(autouse=True)
def agent_session(session: Session, monkeypatch: pytest.MonkeyPatch):
    use_session(session)
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def _path(project_id: UUID) -> str:
    return f"/api/agent/v1/projects/{project_id}/timeline"


def test_returns_goals_tasks_logs_and_capacity(session: Session):
    project = seed_project(session, USER_A)
    first = seed_goal(session, project)
    second = seed_goal(session, project)
    session.add(
        GoalDependency(id=uuid4(), goal_id=second.id, depends_on_goal_id=first.id)
    )
    task = seed_task(session, first, estimate_hours=Decimal("3"))
    seed_log(session, task)
    session.add(
        TriageCapacitySettings(
            user_id=USER_A,
            weekly_capacity_hours=Decimal("40.00"),
            meeting_buffer_hours=Decimal("5.00"),
            project_allocations_json={str(project.id): 40},
        )
    )
    session.commit()
    secret = issue_token(session, USER_A, TIMELINE_SCOPES)

    response = client.get(_path(project.id), headers=bearer(secret))

    assert response.status_code == 200
    body = response.json()
    assert body["project"]["id"] == str(project.id)
    # (40h - 5h) x 40%
    assert body["project"]["weekly_work_hours"] == 14.0
    assert body["project"]["capacity"]["effort_percent"] == 40
    goals = {goal["id"]: goal for goal in body["goals"]}
    assert set(goals) == {str(first.id), str(second.id)}
    assert goals[str(second.id)]["dependencies"] == [str(first.id)]
    (sent_task,) = goals[str(first.id)]["tasks"]
    assert sent_task["id"] == str(task.id)
    assert sent_task["estimate_hours"] == 3.0
    assert sent_task["logs_count"] == 1
    assert sent_task["actual_hours"] == 0.5
    assert goals[str(first.id)]["actual_start_date"] is not None


def test_other_users_and_missing_projects_are_not_found(session: Session):
    others = seed_project(session, USER_B)
    secret = issue_token(session, USER_A, TIMELINE_SCOPES)

    for project_id in (others.id, uuid4()):
        response = client.get(_path(project_id), headers=bearer(secret))
        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"


@pytest.mark.parametrize("missing", TIMELINE_SCOPES)
def test_requires_all_four_read_scopes(session: Session, missing: AgentScope):
    project = seed_project(session, USER_A)
    secret = issue_token(
        session, USER_A, [scope for scope in TIMELINE_SCOPES if scope != missing]
    )

    response = client.get(_path(project.id), headers=bearer(secret))

    assert response.status_code == 403
    assert response.json()["detail"] == f"Missing required scope: {missing.value}"


def test_audit_row_records_all_required_scopes(session: Session):
    project = seed_project(session, USER_A)
    secret = issue_token(session, USER_A, TIMELINE_SCOPES)

    response = client.get(_path(project.id), headers=bearer(secret))

    assert response.status_code == 200
    session.expire_all()
    rows = [
        row
        for row in session.exec(select(AgentAuditLog)).all()
        if row.route.endswith("/timeline")
    ]
    assert len(rows) == 1
    assert rows[0].required_scope == "projects:read,goals:read,tasks:read,logs:read"
    assert rows[0].status_code == 200


def test_without_token_is_401(session: Session):
    project = seed_project(session, USER_A)

    response = client.get(_path(project.id))

    assert response.status_code == 401


def test_require_scopes_rejects_values_too_long_for_the_audit_log():
    with pytest.raises(ValueError, match="too long for the audit log"):
        require_scopes(*AgentScope)
