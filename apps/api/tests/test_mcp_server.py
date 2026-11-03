# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""The MCP server at /mcp: per-call auth, scopes, rate limit, audit, read tools."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from limits import parse
from sqlmodel import Session, select

from humancompiler_api import agent_audit, agent_rate_limit
from humancompiler_api.agent_rate_limit import agent_rate_limiter
from humancompiler_api.database import db, get_session
from humancompiler_api.main import app
from humancompiler_api.mcp_server import mcp_lifespan
from humancompiler_api.models import (
    AgentAuditLog,
    AgentScope,
    AgentToken,
    ContextNote,
)
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

PROTOCOL_VERSION = "2025-11-25"
MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
}
READ_TOOLS = {"find", "get_goal", "get_task", "get_context"}
ALL_READ = [AgentScope.PROJECTS_READ, AgentScope.GOALS_READ, AgentScope.TASKS_READ]


@pytest.fixture(autouse=True)
def mcp_env(session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    use_session(session)
    monkeypatch.setattr(
        agent_audit, "session_factory", lambda: Session(session.get_bind())
    )
    agent_rate_limiter.reset()
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    yield
    agent_rate_limiter.reset()
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
async def mcp() -> AsyncIterator[httpx.AsyncClient]:
    """An in-process client, with the MCP session manager running."""
    # pytest-asyncio may run fixture setup and teardown in different tasks, and
    # the session manager's task group must be entered and left in one task.
    started, stop = asyncio.Event(), asyncio.Event()

    async def serve() -> None:
        async with mcp_lifespan():
            started.set()
            await stop.wait()

    server = asyncio.create_task(serve())
    await started.wait()
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as http:
            yield http
    finally:
        stop.set()
        await server


async def rpc(
    http: httpx.AsyncClient,
    method: str,
    params: dict[str, Any] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    headers = dict(MCP_HEADERS)
    if token is not None:
        headers.update(bearer(token))
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    response = await http.post("/mcp", headers=headers, json=body)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "result" in payload, payload
    return payload["result"]


async def call(
    http: httpx.AsyncClient,
    tool: str,
    arguments: dict[str, Any],
    token: str | None = None,
) -> tuple[bool, Any]:
    """Call a tool; return (is_error, parsed JSON text of the first block)."""
    result = await rpc(
        http, "tools/call", {"name": tool, "arguments": arguments}, token
    )
    return bool(result.get("isError")), json.loads(result["content"][0]["text"])


def audit_rows(session: Session) -> list[AgentAuditLog]:
    session.expire_all()
    return list(session.exec(select(AgentAuditLog)).all())


async def test_initialize_and_list_tools_without_token(
    session: Session, mcp: httpx.AsyncClient
):
    init = await rpc(
        mcp,
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    )
    tools = await rpc(mcp, "tools/list")

    assert init["serverInfo"]["name"] == "HumanCompiler"
    assert "find" in init["instructions"]
    names = {tool["name"] for tool in tools["tools"]}
    assert READ_TOOLS <= names
    for tool in tools["tools"]:
        if tool["name"] in READ_TOOLS:
            assert "not instructions" in tool["description"]
    assert audit_rows(session) == []


async def test_tool_call_without_token_is_401_error(
    session: Session, mcp: httpx.AsyncClient
):
    is_error, body = await call(mcp, "get_goal", {"goal_id": str(uuid4())})

    assert is_error
    assert body == {"status": 401, "detail": "Agent token required"}
    assert audit_rows(session) == []


async def test_invalid_token_is_401_and_counts_failure(
    session: Session, mcp: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(agent_rate_limiter, "enabled", True)
    monkeypatch.setattr(agent_rate_limit, "AUTH_FAILURE_LIMIT", parse("1 per minute"))
    token = "hc_agent_zzzzzzzz_" + "z" * 43

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, token)

    assert is_error
    assert body == {"status": 401, "detail": "Invalid agent token"}
    assert agent_rate_limiter.auth_failure_retry_after("127.0.0.1") is not None
    rows = audit_rows(session)
    assert len(rows) == 1
    assert rows[0].status_code == 401
    assert rows[0].token_id is None
    assert rows[0].token_prefix == "hc_agent_zzzzzzzz"
    assert rows[0].route == "mcp:get_goal"

    # The IP is now locked out, before any lookup, and that 429 is not audited.
    is_error, body = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, token)
    assert is_error
    assert body["status"] == 429
    assert body["detail"] == "Too many failed agent authentication attempts"
    assert len(audit_rows(session)) == 1


async def test_revoked_token_is_401_and_audited(
    session: Session, mcp: httpx.AsyncClient
):
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])
    agent_token = session.exec(select(AgentToken)).one()
    agent_token_service.revoke_token(session, agent_token.id, USER_A)
    session.commit()

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, secret)

    assert is_error
    assert body == {"status": 401, "detail": "Invalid agent token"}
    rows = audit_rows(session)
    assert [(row.route, row.status_code) for row in rows] == [("mcp:get_goal", 401)]


async def test_missing_scope_is_403_and_audited(
    session: Session, mcp: httpx.AsyncClient
):
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, secret)

    assert is_error
    assert body == {"status": 403, "detail": "Missing required scope: goals:read"}
    rows = audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.route == "mcp:get_goal"
    assert row.method == "MCP"
    assert row.required_scope == "goals:read"
    assert row.status_code == 403
    assert row.user_id == USER_A
    assert row.token_id is not None
    assert row.client_ip == "127.0.0.1"


async def test_rate_limit_counts_tool_calls(
    session: Session, mcp: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(agent_rate_limiter, "enabled", True)
    monkeypatch.setattr(agent_rate_limit, "TOKEN_LIMIT", parse("2 per minute"))
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])

    for _ in range(3):
        await rpc(mcp, "tools/list", token=secret)
    results = [
        await call(mcp, "get_goal", {"goal_id": str(goal.id)}, secret) for _ in range(3)
    ]

    assert [is_error for is_error, _ in results] == [False, False, True]
    assert results[2][1]["status"] == 429
    assert results[2][1]["detail"] == "Agent token rate limit exceeded"
    rows = audit_rows(session)
    assert sorted(row.status_code for row in rows) == [200, 200, 429]
    assert {row.route for row in rows} == {"mcp:get_goal"}


async def test_find_returns_only_own_items(session: Session, mcp: httpx.AsyncClient):
    now = datetime.now(UTC)
    project = seed_project(session, USER_A, updated_at=now - timedelta(hours=3))
    project.title = "Alpha launch"
    goal = seed_goal(session, project, updated_at=now - timedelta(hours=1))
    goal.title = "Alpha goal"
    task = seed_task(session, goal, updated_at=now - timedelta(hours=2))
    task.title = "Write ALPHA docs"
    other_project = seed_project(session, USER_B)
    other_project.title = "Alpha secret"
    other_goal = seed_goal(session, other_project)
    other_goal.title = "Alpha other goal"
    other_task = seed_task(session, other_goal)
    other_task.title = "Alpha other task"
    unrelated = seed_task(session, goal)
    unrelated.title = "Beta"
    session.add_all([project, goal, task, other_project, other_goal, other_task])
    session.add(unrelated)
    session.commit()
    secret = issue_token(session, USER_A, ALL_READ)

    is_error, body = await call(mcp, "find", {"query": "alpha"}, secret)

    assert not is_error
    items = body["items"]
    assert [(item["kind"], item["id"]) for item in items] == [
        ("goal", str(goal.id)),
        ("task", str(task.id)),
        ("project", str(project.id)),
    ]
    by_kind = {item["kind"]: item for item in items}
    assert by_kind["project"]["parent"] is None
    assert by_kind["goal"]["parent"] == {
        "kind": "project",
        "id": str(project.id),
        "title": "Alpha launch",
    }
    assert by_kind["task"]["parent"] == {
        "kind": "goal",
        "id": str(goal.id),
        "title": "Alpha goal",
    }
    assert by_kind["task"]["title"] == "Write ALPHA docs"
    assert by_kind["task"]["status"] == "pending"
    assert set(by_kind["task"]) == {
        "kind",
        "id",
        "title",
        "status",
        "parent",
        "updated_at",
    }

    is_error, body = await call(
        mcp, "find", {"query": "alpha", "kind": "task", "limit": 5}, secret
    )
    assert not is_error
    assert [item["id"] for item in body["items"]] == [str(task.id)]

    # A query with LIKE wildcards matches them literally.
    is_error, body = await call(mcp, "find", {"query": "%"}, secret)
    assert not is_error
    assert body["items"] == []


async def test_find_without_kind_needs_all_read_scopes(
    session: Session, mcp: httpx.AsyncClient
):
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    is_error, body = await call(mcp, "find", {"query": "x"}, secret)
    assert is_error
    assert body == {"status": 403, "detail": "Missing required scope: projects:read"}

    is_error, body = await call(mcp, "find", {"query": "x", "kind": "task"}, secret)
    assert not is_error
    assert body == {"items": []}


async def test_get_task_returns_markdown_note(session: Session, mcp: httpx.AsyncClient):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    task = seed_task(session, goal)
    bare_task = seed_task(session, goal)
    note = ContextNote(
        user_id=USER_A,
        task_id=task.id,
        content=(
            '<ul data-type="taskList">'
            '<li data-checked="false" data-type="taskItem"><p>Ship it</p></li>'
            '<li data-checked="true" data-type="taskItem"><p>Test it</p></li>'
            "</ul>"
        ),
        content_type="html",
    )
    session.add(note)
    session.commit()
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    is_error, body = await call(mcp, "get_task", {"task_id": str(task.id)}, secret)

    assert not is_error
    assert body["task"]["id"] == str(task.id)
    assert body["task"]["title"] == "Task"
    assert body["note"]["id"] == str(note.id)
    assert body["note"]["content_markdown"] == "- [ ] Ship it\n- [x] Test it"
    assert body["note"]["updated_at"].endswith("+00:00")

    is_error, body = await call(mcp, "get_task", {"task_id": str(bare_task.id)}, secret)
    assert not is_error
    assert body["note"] is None


async def test_get_goal_returns_goal_and_markdown_note(
    session: Session, mcp: httpx.AsyncClient
):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    session.add(
        ContextNote(
            user_id=USER_A, goal_id=goal.id, content="# Plain", content_type="markdown"
        )
    )
    session.commit()
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(goal.id)}, secret)

    assert not is_error
    assert body["goal"]["id"] == str(goal.id)
    assert body["note"]["content_markdown"] == "# Plain"


async def test_get_goal_foreign_is_404(session: Session, mcp: httpx.AsyncClient):
    other_goal = seed_goal(session, seed_project(session, USER_B))
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])

    foreign = await call(mcp, "get_goal", {"goal_id": str(other_goal.id)}, secret)
    missing = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, secret)

    assert foreign == missing == (True, {"status": 404, "detail": "Goal not found"})
    assert [row.status_code for row in audit_rows(session)] == [404, 404]


def _without_timestamp(markdown: str) -> str:
    return "\n".join(line for line in markdown.splitlines() if "出力日時" not in line)


async def test_get_context_matches_rest(session: Session, mcp: httpx.AsyncClient):
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    seed_task(session, goal)
    secret = issue_token(session, USER_A, [AgentScope.CONTEXT_READ])

    for kind, item_id, path in (
        ("project", project.id, f"projects/{project.id}"),
        ("goal", goal.id, f"goals/{goal.id}"),
    ):
        rest = client.get(
            f"/api/agent/v1/context-export/{path}", headers=bearer(secret)
        )
        is_error, body = await call(
            mcp, "get_context", {"kind": kind, "id": str(item_id)}, secret
        )

        assert rest.status_code == 200
        assert not is_error
        assert body["filename"] == rest.json()["filename"]
        assert _without_timestamp(body["markdown"]) == _without_timestamp(
            rest.json()["markdown"]
        )

    is_error, body = await call(
        mcp, "get_context", {"kind": "goal", "id": str(uuid4())}, secret
    )
    assert is_error
    assert body["status"] == 404


async def test_existing_routes_still_work(session: Session, mcp: httpx.AsyncClient):
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])

    health = await mcp.get("/health")
    projects = await mcp.get("/api/agent/v1/projects", headers=bearer(secret))
    not_allowed = await mcp.delete("/health")

    assert health.status_code in (200, 503)
    assert projects.status_code == 200
    assert projects.json()["items"] == []
    assert not_allowed.status_code == 405


async def test_token_never_in_results_or_logs(
    session: Session, mcp: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
):
    caplog.set_level(logging.DEBUG)
    project = seed_project(session, USER_A)
    goal = seed_goal(session, project)
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])
    texts: list[str] = []

    for tool, arguments in (
        ("get_goal", {"goal_id": str(goal.id)}),
        ("get_goal", {"goal_id": str(uuid4())}),
        ("get_task", {"task_id": str(uuid4())}),
        ("find", {"query": "Goal"}),
    ):
        result = await rpc(
            mcp, "tools/call", {"name": tool, "arguments": arguments}, secret
        )
        texts.append(json.dumps(result))
    result = await rpc(
        mcp,
        "tools/call",
        {"name": "get_goal", "arguments": {"goal_id": str(goal.id)}},
        secret[:-1] + "x",
    )
    texts.append(json.dumps(result))

    # The part after the non-secret display prefix ("hc_agent_" + public id + "_").
    secret_part = secret[len("hc_agent_") + 9 :]
    assert len(secret_part) >= 32
    for text in texts:
        assert secret_part not in text
    for record in caplog.records:
        assert secret_part not in record.getMessage()


def test_app_lifespan_serves_mcp(monkeypatch: pytest.MonkeyPatch):
    async def unhealthy() -> bool:
        return False

    # Skip the startup's DB checks; the lifespan then runs in degraded mode.
    monkeypatch.setattr(db, "health_check", unhealthy)
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

    # Twice: each lifespan must start a fresh session manager.
    for _ in range(2):
        with TestClient(app) as lifespan_client:
            response = lifespan_client.post("/mcp", headers=MCP_HEADERS, json=body)
            assert response.status_code == 200
            names = {tool["name"] for tool in response.json()["result"]["tools"]}
            assert READ_TOOLS <= names

    # Outside the lifespan the endpoint is unavailable, not a crash.
    response = client.post("/mcp", headers=MCP_HEADERS, json=body)
    assert response.status_code == 503
