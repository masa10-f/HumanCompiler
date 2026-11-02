# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API: proposal intake (POST) and reads (GET) under /api/agent/v1."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from humancompiler_api import agent_audit, proposal_service
from humancompiler_api.agent_auth import AgentPrincipal
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentAuditLog,
    AgentProposal,
    AgentScope,
    AgentToken,
    ProposalKind,
    ProposalRejectCategory,
    ProposalStatus,
)
from humancompiler_api.proposal_payloads import ProposalCreateRequest
from humancompiler_api.services import agent_token_service
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

URL = "/api/agent/v1/proposals"
WRITE = [AgentScope.PROPOSALS_WRITE]
READ = [AgentScope.PROPOSALS_READ]


@pytest.fixture(autouse=True)
def agent_session(session: Session):
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    app.dependency_overrides.pop(get_session, None)


def quick_task_body(key: str = "key-1", **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "quick_task",
        "title": "Try it",
        "rationale": "Because",
        "payload": {"title": "Try it"},
        "idempotency_key": key,
    }
    body.update(overrides)
    return body


def experiment_body(key: str) -> dict[str, Any]:
    return {
        "kind": "experiment",
        "title": "Experiment " + key,
        "payload": {
            "question": "q",
            "method": "m",
            "supports_if": "s",
            "refutes_if": "r",
            "effort": "e",
        },
        "idempotency_key": key,
    }


def count_proposals(session: Session) -> int:
    return session.exec(select(func.count()).select_from(AgentProposal)).one()


def seed_pending_rows(
    session: Session, user_id: UUID, count: int, key_prefix: str = "seed"
) -> list[AgentProposal]:
    rows = [
        AgentProposal(
            id=uuid4(),
            user_id=user_id,
            agent_name="seeder",
            kind=ProposalKind.QUICK_TASK.value,
            title=f"Seed {index}",
            payload={"title": f"Seed {index}"},
            idempotency_key=f"{key_prefix}-{index}",
        )
        for index in range(count)
    ]
    session.add_all(rows)
    session.commit()
    return rows


def test_create_returns_201_and_records_agent(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    secret = issue_token(session, USER_A, WRITE, name="Distiller")
    body = {
        "kind": "task",
        "title": "Write the intro",
        "rationale": "Needed",
        "payload": {
            "goal_id": str(goal.id),
            "title": "Write the intro",
            "estimate_hours": 2,
        },
        "sources": [{"ref": "paper:1", "quote": "q"}],
        "idempotency_key": "distiller:task:intro@v1",
    }

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "pending"
    assert data["kind"] == "task"
    assert data["agent_name"] == "Distiller"
    assert data["project_id"] == str(project.id)
    assert data["idempotency_key"] == "distiller:task:intro@v1"
    assert data["sources"][0]["ref"] == "paper:1"
    assert "token_id" not in data


def test_create_requires_proposals_write(session: Session):
    secret = issue_token(session, USER_A, READ)

    response = client.post(URL, json=quick_task_body(), headers=bearer(secret))

    assert response.status_code == 403
    assert "proposals:write" in response.json()["detail"]
    assert count_proposals(session) == 0


def test_create_rejects_invalid_payload_with_422(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    body = quick_task_body(payload={"estimate_hours": 1})

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 422
    assert count_proposals(session) == 0


def test_create_rejects_other_users_reference_like_missing(session: Session):
    other_goal = seed_goal(session, seed_project(session, USER_B))
    other_task = seed_task(session, other_goal)
    secret = issue_token(session, USER_A, WRITE)

    def task_body(goal_id: UUID, key: str) -> dict[str, Any]:
        return {
            "kind": "task",
            "title": "T",
            "payload": {"goal_id": str(goal_id), "title": "T", "estimate_hours": 1},
            "idempotency_key": key,
        }

    def note_body(task_id: UUID, key: str) -> dict[str, Any]:
        return {
            "kind": "note_append",
            "title": "N",
            "payload": {"target": {"task_id": str(task_id)}, "content_markdown": "x"},
            "idempotency_key": key,
        }

    other = client.post(URL, json=task_body(other_goal.id, "a"), headers=bearer(secret))
    missing = client.post(URL, json=task_body(uuid4(), "b"), headers=bearer(secret))
    note_other = client.post(
        URL, json=note_body(other_task.id, "c"), headers=bearer(secret)
    )
    note_missing = client.post(
        URL, json=note_body(uuid4(), "d"), headers=bearer(secret)
    )

    assert other.status_code == missing.status_code == 422
    assert other.json()["detail"] == missing.json()["detail"] == "Unknown goal_id"
    assert note_other.status_code == note_missing.status_code == 422
    assert (
        note_other.json()["detail"]
        == note_missing.json()["detail"]
        == "Unknown target.task_id"
    )
    assert count_proposals(session) == 0


def test_create_rejects_other_users_project_and_target_goal_like_missing(
    session: Session,
):
    other_project = seed_project(session, USER_B)
    other_goal = seed_goal(session, other_project)
    secret = issue_token(session, USER_A, WRITE)

    def goal_body(project_id: UUID, key: str) -> dict[str, Any]:
        return {
            "kind": "goal",
            "title": "G",
            "payload": {"project_id": str(project_id), "title": "G"},
            "idempotency_key": key,
        }

    def note_body(goal_id: UUID, key: str) -> dict[str, Any]:
        return {
            "kind": "note_append",
            "title": "N",
            "payload": {"target": {"goal_id": str(goal_id)}, "content_markdown": "x"},
            "idempotency_key": key,
        }

    other = client.post(
        URL, json=goal_body(other_project.id, "a"), headers=bearer(secret)
    )
    missing = client.post(URL, json=goal_body(uuid4(), "b"), headers=bearer(secret))
    note_other = client.post(
        URL, json=note_body(other_goal.id, "c"), headers=bearer(secret)
    )
    note_missing = client.post(
        URL, json=note_body(uuid4(), "d"), headers=bearer(secret)
    )

    assert other.status_code == missing.status_code == 422
    assert other.json()["detail"] == missing.json()["detail"] == "Unknown project_id"
    assert note_other.status_code == note_missing.status_code == 422
    assert (
        note_other.json()["detail"]
        == note_missing.json()["detail"]
        == "Unknown target.goal_id"
    )
    assert count_proposals(session) == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "a\x00b"},
        {"rationale": "a\x00b"},
        {"idempotency_key": "key\x00"},
        {"sources": [{"ref": "paper:1", "quote": "a\x00b"}]},
        {"payload": {"title": "a\x00b"}},
        {"payload": {"title": "ok", "description": "a\x00b"}},
    ],
)
def test_create_rejects_nul_with_422(session: Session, overrides: dict[str, Any]):
    secret = issue_token(session, USER_A, WRITE)

    response = client.post(
        URL, json=quick_task_body(**overrides), headers=bearer(secret)
    )

    assert response.status_code == 422
    assert "NUL" in response.text
    assert count_proposals(session) == 0


def test_create_rejects_nul_in_nested_payload_list(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    body = {
        "kind": "contradiction",
        "title": "C",
        "payload": {
            "claims": [{"text": "a"}, {"text": "b\x00"}],
            "explanation": "x",
        },
        "idempotency_key": "key-c",
    }

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 422
    assert count_proposals(session) == 0


def test_resolves_project_for_each_kind(session: Session):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    task = seed_task(session, goal)
    secret = issue_token(session, USER_A, WRITE)

    def post(kind: str, payload: dict[str, Any], key: str) -> dict[str, Any]:
        response = client.post(
            URL,
            json={
                "kind": kind,
                "title": "x",
                "payload": payload,
                "idempotency_key": key,
            },
            headers=bearer(secret),
        )
        assert response.status_code == 201, response.text
        return response.json()

    task_row = post(
        "task", {"goal_id": str(goal.id), "title": "t", "estimate_hours": 1}, "1"
    )
    goal_row = post("goal", {"project_id": str(project.id), "title": "g"}, "2")
    note_goal = post(
        "note_append",
        {"target": {"goal_id": str(goal.id)}, "content_markdown": "c"},
        "3",
    )
    note_task = post(
        "note_append",
        {"target": {"task_id": str(task.id)}, "content_markdown": "c"},
        "4",
    )
    note_project = post(
        "note_append",
        {"target": {"project_id": str(project.id)}, "content_markdown": "c"},
        "5",
    )
    quick = post("quick_task", {"title": "q"}, "6")
    experiment = post(
        "experiment",
        {
            "project_id": str(project.id),
            "question": "q",
            "method": "m",
            "supports_if": "s",
            "refutes_if": "r",
            "effort": "e",
        },
        "7",
    )
    decision = post("decision_request", {"question": "q"}, "8")

    expected = str(project.id)
    assert task_row["project_id"] == expected
    assert goal_row["project_id"] == expected
    assert note_goal["project_id"] == expected
    assert note_task["project_id"] == expected
    assert note_project["project_id"] == expected
    assert experiment["project_id"] == expected
    assert quick["project_id"] is None
    assert decision["project_id"] is None


def test_same_idempotency_key_returns_existing_with_200(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    first = client.post(URL, json=quick_task_body(), headers=bearer(secret))
    changed = quick_task_body(
        title="Different", payload={"title": "Different"}, rationale="other"
    )

    second = client.post(URL, json=changed, headers=bearer(secret))
    session.exec(
        update(AgentProposal).values(
            status=ProposalStatus.REJECTED.value,
            reject_category=ProposalRejectCategory.WRONG.value,
        )
    )
    session.commit()
    third = client.post(URL, json=quick_task_body(), headers=bearer(secret))

    assert first.status_code == 201
    assert second.status_code == 200
    assert third.status_code == 200
    assert second.json()["id"] == first.json()["id"] == third.json()["id"]
    assert second.json()["title"] == "Try it"
    assert third.json()["status"] == "rejected"
    assert count_proposals(session) == 1


def test_idempotency_key_is_per_user(session: Session):
    secret_a = issue_token(session, USER_A, WRITE)
    secret_b = issue_token(session, USER_B, WRITE)

    first = client.post(URL, json=quick_task_body(), headers=bearer(secret_a))
    second = client.post(URL, json=quick_task_body(), headers=bearer(secret_b))

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]


def test_pending_cap_returns_409(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    rows = seed_pending_rows(session, USER_A, proposal_service.MAX_PENDING_PROPOSALS)

    full = client.post(URL, json=quick_task_body("new"), headers=bearer(secret))
    count_after_409 = count_proposals(session)
    rows[0].status = ProposalStatus.REJECTED.value
    rows[0].reject_category = ProposalRejectCategory.OTHER.value
    session.add(rows[0])
    session.commit()
    freed = client.post(URL, json=quick_task_body("new"), headers=bearer(secret))

    assert full.status_code == 409
    assert full.json()["detail"] == "Proposal inbox is full"
    assert count_after_409 == proposal_service.MAX_PENDING_PROPOSALS
    assert freed.status_code == 201


def test_pending_cap_ignores_other_users(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    seed_pending_rows(session, USER_B, proposal_service.MAX_PENDING_PROPOSALS)

    response = client.post(URL, json=quick_task_body(), headers=bearer(secret))

    assert response.status_code == 201


def test_idempotent_replay_wins_over_pending_cap(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    rows = seed_pending_rows(session, USER_A, proposal_service.MAX_PENDING_PROPOSALS)

    response = client.post(URL, json=quick_task_body("seed-7"), headers=bearer(secret))

    assert response.status_code == 200
    assert response.json()["id"] == str(rows[7].id)


def test_unique_violation_on_commit_returns_existing_row(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    principal_token, _ = agent_token_service.create_token(
        session, USER_A, "racer", WRITE
    )
    session.commit()
    principal = agent_principal(principal_token)
    existing = seed_pending_rows(session, USER_A, 1, key_prefix="race")[0]
    data = ProposalCreateRequest.model_validate(quick_task_body("race-0"))
    real_find = proposal_service._find_by_key
    calls = {"n": 0}

    def find_first_miss(*args: Any, **kwargs: Any) -> AgentProposal | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else real_find(*args, **kwargs)

    real_commit = session.commit

    def failing_commit() -> None:
        session.commit = real_commit  # type: ignore[method-assign]
        raise IntegrityError("insert", {}, Exception("uq_agent_proposals_user"))

    monkeypatch.setattr(proposal_service, "_find_by_key", find_first_miss)
    monkeypatch.setattr(session, "commit", failing_commit)

    row, created = proposal_service.create_proposal(session, principal, data)

    assert created is False
    assert row.id == existing.id


def agent_principal(token: AgentToken):
    return AgentPrincipal(
        token_id=token.id,  # type: ignore[arg-type]
        user_id=token.user_id,
        scopes=frozenset(token.scopes),
        token_prefix=token.token_prefix,
    )


def test_body_over_64kb_returns_413(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    body = quick_task_body(rationale="x" * 70_000)

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 413
    assert response.json()["detail"] == "Request body exceeds 65536 bytes"
    assert count_proposals(session) == 0


def test_oversized_invalid_body_returns_413_not_422(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    body = quick_task_body(kind="not-a-kind", rationale="x" * 70_000)

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 413


def test_oversized_body_returns_413_without_a_token_and_is_not_audited(
    session: Session, monkeypatch
):
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    body = quick_task_body(rationale="x" * 70_000)

    response = client.post(URL, json=body)

    assert response.status_code == 413
    assert session.exec(select(AgentAuditLog)).all() == []


def test_small_unauthenticated_body_still_gets_401(session: Session):
    response = client.post(URL, json=quick_task_body())

    assert response.status_code == 401


def test_body_cap_applies_only_to_the_post_route():
    from humancompiler_api.routers.agent_proposals import BodyCappedRoute

    capped = {
        (route.path, tuple(sorted(route.methods)))
        for route in app.routes
        if isinstance(route, BodyCappedRoute)
    }

    assert capped == {("/api/agent/v1/proposals", ("POST",))}


def test_deeply_nested_body_is_422_not_500(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    nested: Any = "leaf"
    for _ in range(2000):
        nested = [nested]
    body = quick_task_body(payload={"title": "Try it", "extra": nested})

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 422
    assert count_proposals(session) == 0


def test_body_just_under_64kb_is_accepted(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    sources = [{"ref": "r" * 500, "quote": "q" * 1000} for _ in range(20)]
    body = quick_task_body(sources=sources)

    response = client.post(URL, json=body, headers=bearer(secret))

    assert response.status_code == 201


def test_list_returns_all_tokens_proposals_for_user_only(session: Session):
    secret_x = issue_token(session, USER_A, WRITE, name="X")
    secret_y = issue_token(session, USER_A, WRITE, name="Y")
    secret_z = issue_token(session, USER_A, READ, name="Z")
    secret_b = issue_token(session, USER_B, WRITE, name="B")
    client.post(URL, json=quick_task_body("x"), headers=bearer(secret_x))
    client.post(URL, json=quick_task_body("y"), headers=bearer(secret_y))
    client.post(URL, json=quick_task_body("b"), headers=bearer(secret_b))

    response = client.get(URL, headers=bearer(secret_z))

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["idempotency_key"] for item in items} == {"x", "y"}
    assert {item["agent_name"] for item in items} == {"X", "Y"}
    assert response.json()["next_cursor"] is None


def test_list_requires_proposals_read(session: Session):
    secret = issue_token(session, USER_A, WRITE)

    response = client.get(URL, headers=bearer(secret))

    assert response.status_code == 403
    assert "proposals:read" in response.json()["detail"]


def test_list_filters_kind_and_status(session: Session):
    write = issue_token(session, USER_A, WRITE)
    read = issue_token(session, USER_A, READ)
    ids = {}
    for key in ("pending", "accepted", "edited", "rejected"):
        response = client.post(URL, json=experiment_body(key), headers=bearer(write))
        ids[key] = response.json()["id"]
    client.post(URL, json=quick_task_body("quick"), headers=bearer(write))
    for key, new_status in (
        ("accepted", ProposalStatus.ACCEPTED),
        ("edited", ProposalStatus.EDITED),
        ("rejected", ProposalStatus.REJECTED),
    ):
        session.exec(
            update(AgentProposal)
            .where(col(AgentProposal.idempotency_key) == key)
            .values(status=new_status.value)
        )
    session.commit()

    response = client.get(
        URL + "?kind=experiment&status=accepted&status=edited", headers=bearer(read)
    )
    only_kind = client.get(URL + "?kind=quick_task", headers=bearer(read))
    bad = client.get(URL + "?status=bogus", headers=bearer(read))

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {
        ids["accepted"],
        ids["edited"],
    }
    assert [item["idempotency_key"] for item in only_kind.json()["items"]] == ["quick"]
    assert bad.status_code == 422


def test_list_paginates_by_updated_at(session: Session):
    read = issue_token(session, USER_A, READ)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows = seed_pending_rows(session, USER_A, 5)
    for index, row in enumerate(rows):
        row.updated_at = base + timedelta(minutes=index)
        session.add(row)
    session.commit()

    seen: list[str] = []
    cursor = None
    for _ in range(5):
        query = "?limit=2" + (f"&cursor={cursor}" if cursor else "")
        page = client.get(URL + query, headers=bearer(read)).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == [str(row.id) for row in rows]

    later = base + timedelta(hours=1)
    rows[1].status = ProposalStatus.ACCEPTED.value
    rows[1].updated_at = later
    session.add(rows[1])
    session.commit()
    since = client.get(
        URL, params={"updated_since": later.isoformat()}, headers=bearer(read)
    )

    assert [item["id"] for item in since.json()["items"]] == [str(rows[1].id)]


def test_get_returns_own_proposal(session: Session):
    write = issue_token(session, USER_A, WRITE)
    read = issue_token(session, USER_A, READ)
    created = client.post(URL, json=quick_task_body(), headers=bearer(write)).json()

    response = client.get(f"{URL}/{created['id']}", headers=bearer(read))

    assert response.status_code == 200
    assert response.json() == created


def test_get_other_users_proposal_is_404(session: Session):
    write_b = issue_token(session, USER_B, WRITE)
    read_a = issue_token(session, USER_A, READ)
    created = client.post(URL, json=quick_task_body(), headers=bearer(write_b)).json()

    other = client.get(f"{URL}/{created['id']}", headers=bearer(read_a))
    missing = client.get(f"{URL}/{uuid4()}", headers=bearer(read_a))

    assert other.status_code == missing.status_code == 404
    assert other.json() == missing.json()


def test_deleted_token_keeps_agent_name(session: Session):
    write = issue_token(session, USER_A, WRITE, name="Gone soon")
    read = issue_token(session, USER_A, READ)
    created = client.post(URL, json=quick_task_body(), headers=bearer(write)).json()
    token = session.exec(select(AgentToken).where(AgentToken.name == "Gone soon")).one()
    agent_token_service.revoke_token(session, token.id, USER_A)
    row = session.get(AgentProposal, UUID(created["id"]))
    row.token_id = None  # what ON DELETE SET NULL does in PostgreSQL
    session.add(row)
    session.commit()
    session.delete(token)
    session.commit()

    response = client.get(f"{URL}/{created['id']}", headers=bearer(read))

    assert response.status_code == 200
    assert response.json()["agent_name"] == "Gone soon"


def test_proposal_requests_are_audited(session: Session, monkeypatch):
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    secret = issue_token(session, USER_A, WRITE)

    response = client.post(URL, json=quick_task_body(), headers=bearer(secret))

    assert response.status_code == 201
    logs = session.exec(select(AgentAuditLog)).all()
    assert len(logs) == 1
    assert logs[0].required_scope == "proposals:write"
    assert logs[0].route == "/api/agent/v1/proposals"
    assert logs[0].status_code == 201


def _post_request(chunks: list[bytes], headers: dict[str, str]):
    """A Request whose body arrives as ``chunks``; ``reads`` counts chunks taken."""
    from starlette.requests import Request

    reads = {"n": 0}
    messages = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]

    async def receive():
        reads["n"] += 1
        if messages:
            return messages.pop(0)
        raise AssertionError("body read past its end")

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/echo",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "query_string": b"",
    }
    return Request(scope, receive), reads


def _capped_echo_handler():
    from fastapi import Request

    from humancompiler_api.routers.agent_proposals import BodyCappedRoute

    async def echo(request: Request) -> dict[str, Any]:
        return {"size": len(await request.body()), "json": await request.json()}

    route = BodyCappedRoute("/echo", echo, methods=["POST"])
    return route.get_route_handler()


def test_declared_content_length_over_cap_is_413_without_reading_the_body():
    from fastapi import HTTPException

    from humancompiler_api.routers.agent_proposals import MAX_BODY_BYTES

    handler = _capped_echo_handler()
    request, reads = _post_request([b"{}"], {"content-length": str(MAX_BODY_BYTES + 1)})

    with pytest.raises(HTTPException) as caught:
        asyncio.run(handler(request))

    assert caught.value.status_code == 413
    assert reads["n"] == 0


def test_streamed_body_over_cap_stops_reading_early():
    from fastapi import HTTPException

    from humancompiler_api.routers.agent_proposals import MAX_BODY_BYTES

    handler = _capped_echo_handler()
    chunk = b" " * (MAX_BODY_BYTES // 4)
    # No Content-Length (chunked): 100 chunks offered, the cap trips at the 5th.
    request, reads = _post_request([chunk] * 100, {})

    with pytest.raises(HTTPException) as caught:
        asyncio.run(handler(request))

    assert caught.value.status_code == 413
    assert caught.value.detail == f"Request body exceeds {MAX_BODY_BYTES} bytes"
    assert reads["n"] == 5


def test_streamed_body_within_cap_is_reused_by_the_handler():
    handler = _capped_echo_handler()
    request, _ = _post_request([b'{"a":', b" 1}"], {})

    response = asyncio.run(handler(request))

    assert response.body == b'{"size":8,"json":{"a":1}}'


def test_chunked_upload_over_cap_returns_413(session: Session):
    secret = issue_token(session, USER_A, WRITE)
    payload = json.dumps(quick_task_body(rationale="x" * 70_000)).encode()

    def chunks():
        for start in range(0, len(payload), 8192):
            yield payload[start : start + 8192]

    response = client.post(
        URL,
        content=chunks(),
        headers={**bearer(secret), "content-type": "application/json"},
    )

    assert response.status_code == 413
    assert count_proposals(session) == 0
