# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Web API for the proposal inbox (/api/proposals)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event
from sqlmodel import Session

from humancompiler_api import auth
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentProposal,
    AgentScope,
    ProposalKind,
    ProposalStatus,
)
from humancompiler_api.proposal_payloads import normalize_payload
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_project,
    seed_task,
    seed_user,
)

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
BASE = "/api/proposals"
BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)

EXPERIMENT_PAYLOAD = {
    "question": "q",
    "method": "m",
    "supports_if": "s",
    "refutes_if": "r",
    "effort": "e",
}


def install_overrides(session: Session, user_id: UUID = USER_A) -> None:
    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(user_id), email="web-user@example.com")

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user


@pytest.fixture(autouse=True)
def web_session(session: Session):
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    install_overrides(session)
    yield
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


def make_proposal(
    session: Session,
    kind: ProposalKind,
    payload: dict[str, Any],
    *,
    user_id: UUID = USER_A,
    project_id: UUID | None = None,
    age_minutes: int = 0,
    title: str = "Proposal",
    status: ProposalStatus = ProposalStatus.PENDING,
    decided_minutes: int | None = None,
) -> AgentProposal:
    """Store a proposal. Larger ``age_minutes`` means a later ``created_at``."""
    stamp = BASE_TIME + timedelta(minutes=age_minutes)
    decided_at = (
        BASE_TIME + timedelta(minutes=decided_minutes)
        if decided_minutes is not None
        else None
    )
    row = AgentProposal(
        id=uuid4(),
        user_id=user_id,
        agent_name="Distiller",
        kind=kind.value,
        title=title,
        payload=normalize_payload(kind, payload),
        idempotency_key=f"key-{uuid4()}",
        project_id=project_id,
        status=status.value,
        decided_at=decided_at,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def experiment(session: Session, **kwargs: Any) -> AgentProposal:
    return make_proposal(session, ProposalKind.EXPERIMENT, EXPERIMENT_PAYLOAD, **kwargs)


def ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_list_pending_and_decided(session: Session):
    old = experiment(session, age_minutes=1)
    new = experiment(session, age_minutes=5)
    mid = experiment(session, age_minutes=3)
    accepted = experiment(
        session, status=ProposalStatus.ACCEPTED, decided_minutes=10, age_minutes=0
    )
    rejected = experiment(
        session, status=ProposalStatus.REJECTED, decided_minutes=20, age_minutes=9
    )
    edited = experiment(
        session, status=ProposalStatus.EDITED, decided_minutes=15, age_minutes=2
    )
    experiment(session, user_id=USER_B, age_minutes=7)

    pending = client.get(BASE)
    assert ids(pending) == [str(new.id), str(mid.id), str(old.id)]
    assert pending.json()["total"] == 3

    decided = client.get(BASE, params={"status": "decided"})
    assert ids(decided) == [str(rejected.id), str(edited.id), str(accepted.id)]
    assert decided.json()["total"] == 3

    page = client.get(BASE, params={"limit": 2, "offset": 1})
    assert ids(page) == [str(mid.id), str(old.id)]
    assert page.json()["total"] == 3

    assert client.get(BASE, params={"limit": 0}).status_code == 422
    assert client.get(BASE, params={"limit": 201}).status_code == 422
    assert client.get(BASE, params={"offset": -1}).status_code == 422
    assert client.get(BASE, params={"status": "accepted"}).status_code == 422


def test_list_filters_kind_and_project(session: Session):
    project_a = seed_project(session, USER_A)
    project_b = seed_project(session, USER_A)
    goal_a = seed_goal(session, project_a)
    task_a = seed_task(session, goal_a)
    in_a_exp = experiment(session, project_id=project_a.id, age_minutes=1)
    in_a_task = make_proposal(
        session,
        ProposalKind.TASK,
        {"goal_id": str(goal_a.id), "title": "T", "estimate_hours": 1},
        project_id=project_a.id,
        age_minutes=2,
    )
    in_a_note = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"task_id": str(task_a.id)}, "content_markdown": "x"},
        project_id=project_a.id,
        age_minutes=3,
    )
    in_b = experiment(session, project_id=project_b.id, age_minutes=4)
    no_project = experiment(session, age_minutes=5)

    by_project = client.get(BASE, params={"project_id": str(project_a.id)})
    assert ids(by_project) == [str(in_a_note.id), str(in_a_task.id), str(in_a_exp.id)]
    assert by_project.json()["total"] == 3

    by_kind = client.get(BASE, params={"kind": "experiment"})
    assert ids(by_kind) == [str(no_project.id), str(in_b.id), str(in_a_exp.id)]

    both = client.get(
        BASE, params={"kind": "experiment", "project_id": str(project_a.id)}
    )
    assert ids(both) == [str(in_a_exp.id)]
    assert both.json()["total"] == 1

    assert client.get(BASE, params={"kind": "nope"}).status_code == 422


def test_list_shows_reference_names(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    task = seed_task(session, goal)
    task_proposal = make_proposal(
        session,
        ProposalKind.TASK,
        {"goal_id": str(goal.id), "title": "T", "estimate_hours": 1},
        project_id=project.id,
        age_minutes=2,
    )
    note_proposal = make_proposal(
        session,
        ProposalKind.NOTE_APPEND,
        {"target": {"task_id": str(task.id)}, "content_markdown": "x"},
        project_id=project.id,
        age_minutes=1,
    )
    unreferenced = experiment(session, age_minutes=0)

    items = {item["id"]: item for item in client.get(BASE).json()["items"]}
    task_item = items[str(task_proposal.id)]
    assert task_item["goal_title"] == "Goal"
    assert task_item["project_name"] == "Project"
    assert task_item["task_title"] is None
    note_item = items[str(note_proposal.id)]
    assert note_item["task_title"] == "Task"
    assert note_item["project_name"] == "Project"
    bare = items[str(unreferenced.id)]
    assert (bare["project_name"], bare["goal_title"], bare["task_title"]) == (
        None,
        None,
        None,
    )

    session.delete(goal)
    session.commit()
    after = client.get(f"{BASE}/{task_proposal.id}").json()
    assert after["goal_title"] is None
    assert after["project_name"] == "Project"


def test_reference_names_are_scoped_to_the_owner(session: Session):
    # A proposal row that points at someone else's goal must not leak its title
    # (intake forbids this; the lookup is guarded anyway).
    other_goal = seed_goal(session, seed_project(session, USER_B))
    row = make_proposal(
        session,
        ProposalKind.TASK,
        {"goal_id": str(other_goal.id), "title": "T", "estimate_hours": 1},
    )
    body = client.get(f"{BASE}/{row.id}").json()
    assert body["goal_title"] is None


def _statements(session: Session, **params) -> list[str]:
    statements: list[str] = []
    session.expire_all()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(BASE, params=params)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200
    return statements


def test_list_reference_names_use_constant_queries(session: Session):
    project = seed_project(session, USER_A)
    for i in range(20):
        goal = seed_goal(session, project)
        task = seed_task(session, goal)
        make_proposal(
            session,
            ProposalKind.TASK,
            {"goal_id": str(goal.id), "title": f"T{i}", "estimate_hours": 1},
            project_id=project.id,
            age_minutes=2 * i,
        )
        make_proposal(
            session,
            ProposalKind.NOTE_APPEND,
            {"target": {"task_id": str(task.id)}, "content_markdown": "x"},
            project_id=project.id,
            age_minutes=2 * i + 1,
        )

    small = _statements(session, limit=2)
    large = _statements(session, limit=40)
    assert len(small) == len(large)
    for table in ("projects", "goals", "tasks"):
        # Name lookups select from the table itself (ownership subqueries inside
        # the goal and task lookups mention the other tables but start elsewhere).
        lookups = [s for s in large if s.startswith(f"SELECT {table}.")]
        assert len(lookups) == 1, (table, lookups)


def test_summary_counts_pending_and_latest_three(session: Session):
    empty = client.get(f"{BASE}/summary")
    assert empty.status_code == 200
    assert empty.json() == {"pending_count": 0, "latest": []}

    rows = [experiment(session, age_minutes=i, title=f"P{i}") for i in range(5)]
    experiment(session, status=ProposalStatus.ACCEPTED, decided_minutes=5)
    experiment(session, user_id=USER_B, age_minutes=50)

    body = client.get(f"{BASE}/summary").json()
    assert body["pending_count"] == 5
    assert [item["id"] for item in body["latest"]] == [
        str(rows[4].id),
        str(rows[3].id),
        str(rows[2].id),
    ]
    first = body["latest"][0]
    assert set(first) == {"id", "kind", "title", "agent_name", "created_at"}
    assert first["kind"] == "experiment"
    assert first["title"] == "P4"
    assert first["agent_name"] == "Distiller"
    assert first["created_at"].endswith("Z") or "+00:00" in first["created_at"]


def test_accept_and_reject_via_router(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    task_row = make_proposal(
        session,
        ProposalKind.TASK,
        {"goal_id": str(goal.id), "title": "Write it", "estimate_hours": 2},
        project_id=project.id,
    )
    experiment_row = experiment(session, project_id=project.id)
    duplicate_row = experiment(session)
    secret = issue_token(session, USER_A, [AgentScope.PROPOSALS_READ])

    accepted = client.post(f"{BASE}/{task_row.id}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["status"] == "accepted"
    assert body["result"]["type"] == "task"
    assert body["final_payload"]["title"] == "Write it"
    assert body["goal_title"] == "Goal"
    assert body["decided_at"] is not None

    approved = client.post(
        f"{BASE}/{experiment_row.id}/accept",
        json={"decision_note": "Use three seeds"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["decision_note"] == "Use three seeds"
    assert approved.json()["result"] is None

    rejected = client.post(
        f"{BASE}/{duplicate_row.id}/reject",
        json={"reject_category": "duplicate", "decision_note": "Already have it"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["reject_category"] == "duplicate"

    # The agent sees exactly the same decisions.
    for web, label in (
        (accepted.json(), "task"),
        (approved.json(), "experiment"),
        (rejected.json(), "duplicate"),
    ):
        seen = client.get(
            f"/api/agent/v1/proposals/{web['id']}", headers=bearer(secret)
        )
        assert seen.status_code == 200, label
        agent = seen.json()
        for field in (
            "status",
            "result",
            "final_payload",
            "reject_category",
            "decision_note",
            "decision_option",
            "decided_at",
        ):
            assert agent[field] == web[field], (label, field)

    # A decided proposal cannot be decided again.
    again = client.post(f"{BASE}/{duplicate_row.id}/accept", json={})
    assert again.status_code == 409

    decided = client.get(BASE, params={"status": "decided"})
    assert len(ids(decided)) == 3

    assert client.post(f"{BASE}/{uuid4()}/accept", json={}).status_code == 404
    bad = client.post(f"{BASE}/{uuid4()}/reject", json={"reject_category": "bogus"})
    assert bad.status_code == 422


def test_other_users_proposal_is_404_everywhere(session: Session):
    foreign = experiment(session, user_id=USER_B)
    experiment(session)

    listed = ids(client.get(BASE))
    assert str(foreign.id) not in listed
    assert len(listed) == 1
    assert client.get(BASE, params={"status": "decided"}).json()["total"] == 0

    for method, path, body in (
        ("get", f"{BASE}/{foreign.id}", None),
        ("post", f"{BASE}/{foreign.id}/accept", {}),
        ("post", f"{BASE}/{foreign.id}/reject", {"reject_category": "wrong"}),
        ("get", f"{BASE}/{uuid4()}", None),
    ):
        response = getattr(client, method)(
            path, **({} if body is None else {"json": body})
        )
        assert response.status_code == 404, (method, path)

    session.expire_all()
    assert session.get(AgentProposal, foreign.id).status == "pending"


def test_agent_token_cannot_use_web_api(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    # Drop the get_current_user override so the real dependency runs. It asks
    # Supabase to verify the bearer token; only that network client is replaced
    # (Supabase answers "no user" for something that is not one of its JWTs).
    app.dependency_overrides.pop(get_current_user, None)
    secret = issue_token(session, USER_A, [AgentScope.PROPOSALS_READ])
    row = experiment(session)
    lookups: list[str] = []

    def get_user(token: str):
        lookups.append(token)
        return SimpleNamespace(user=None)

    fake_client = SimpleNamespace(auth=SimpleNamespace(get_user=get_user))
    monkeypatch.setattr(auth.db, "get_client", lambda: fake_client)

    headers = bearer(secret)
    responses = [
        client.get(BASE, headers=headers),
        client.get(f"{BASE}/summary", headers=headers),
        client.get(f"{BASE}/{row.id}", headers=headers),
        client.post(f"{BASE}/{row.id}/accept", headers=headers, json={}),
        client.post(
            f"{BASE}/{row.id}/reject",
            headers=headers,
            json={"reject_category": "wrong"},
        ),
    ]
    for response in responses:
        assert response.status_code in (401, 403)
        assert secret not in response.text
    assert lookups == [secret] * len(responses)
    assert client.get(BASE).status_code in (401, 403)
