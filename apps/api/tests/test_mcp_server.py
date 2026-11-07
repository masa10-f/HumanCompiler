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
from sqlmodel import Session, func, select

from humancompiler_api import agent_audit, agent_rate_limit
from humancompiler_api.agent_write_models import NOTE_REPLACE_LOSES
from humancompiler_api.agent_rate_limit import agent_rate_limiter
from humancompiler_api.database import db, get_session
from humancompiler_api.main import app
from humancompiler_api.mcp_server import mcp_lifespan
from humancompiler_api.models import (
    AgentAuditLog,
    AgentChange,
    AgentProposal,
    AgentScope,
    AgentToken,
    ContextNote,
    Goal,
    Log,
    Project,
    ProposalKind,
    Task,
    TaskDependency,
    TaskStatus,
)
from humancompiler_api.services import agent_token_service
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_log,
    seed_note,
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
READ_TOOLS = {"find", "get_goal", "get_task", "list_logs", "get_context"}
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
    # Points agents at the local CLI for roadmaps and context exports.
    assert "npx humancompiler@0 roadmap <project-id>" in init["instructions"]
    assert "npx humancompiler@0 context <project|goal> <id>" in init["instructions"]
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
    secret = issue_token(
        session, USER_A, [AgentScope.TASKS_READ, AgentScope.NOTES_READ], name="notes"
    )
    no_notes = issue_token(session, USER_A, [AgentScope.TASKS_READ], name="plain")

    # As in REST, the note needs notes:read on top of tasks:read.
    is_error, body = await call(mcp, "get_task", {"task_id": str(task.id)}, no_notes)
    assert not is_error
    assert body["task"]["id"] == str(task.id)
    assert body["note"] is None

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
    secret = issue_token(
        session, USER_A, [AgentScope.GOALS_READ, AgentScope.NOTES_READ], name="notes"
    )
    no_notes = issue_token(session, USER_A, [AgentScope.GOALS_READ], name="plain")

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(goal.id)}, secret)

    assert not is_error
    assert body["goal"]["id"] == str(goal.id)
    assert body["note"]["content_markdown"] == "# Plain"

    is_error, body = await call(mcp, "get_goal", {"goal_id": str(goal.id)}, no_notes)
    assert not is_error
    assert body["goal"]["id"] == str(goal.id)
    assert body["note"] is None


async def test_get_goal_foreign_is_404(session: Session, mcp: httpx.AsyncClient):
    other_goal = seed_goal(session, seed_project(session, USER_B))
    secret = issue_token(session, USER_A, [AgentScope.GOALS_READ])

    foreign = await call(mcp, "get_goal", {"goal_id": str(other_goal.id)}, secret)
    missing = await call(mcp, "get_goal", {"goal_id": str(uuid4())}, secret)

    assert foreign == missing == (True, {"status": 404, "detail": "Goal not found"})
    assert [row.status_code for row in audit_rows(session)] == [404, 404]


async def test_get_task_foreign_is_404(session: Session, mcp: httpx.AsyncClient):
    other_task = seed_task(session, seed_goal(session, seed_project(session, USER_B)))
    secret = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    foreign = await call(mcp, "get_task", {"task_id": str(other_task.id)}, secret)
    missing = await call(mcp, "get_task", {"task_id": str(uuid4())}, secret)

    assert foreign == missing == (True, {"status": 404, "detail": "Task not found"})
    assert [row.status_code for row in audit_rows(session)] == [404, 404]


async def test_get_context_foreign_is_404(session: Session, mcp: httpx.AsyncClient):
    other_project = seed_project(session, USER_B)
    other_goal = seed_goal(session, other_project)
    secret = issue_token(session, USER_A, [AgentScope.CONTEXT_READ])

    for kind, label, foreign_id in (
        ("project", "Project", other_project.id),
        ("goal", "Goal", other_goal.id),
    ):
        missing_id = uuid4()
        foreign = await call(
            mcp, "get_context", {"kind": kind, "id": str(foreign_id)}, secret
        )
        missing = await call(
            mcp, "get_context", {"kind": kind, "id": str(missing_id)}, secret
        )

        # The detail echoes the requested ID, exactly as REST does; otherwise
        # a foreign ID and a random one are indistinguishable.
        assert foreign == (
            True,
            {"status": 404, "detail": f"{label} not found with ID: {foreign_id}"},
        )
        assert missing == (
            True,
            {"status": 404, "detail": f"{label} not found with ID: {missing_id}"},
        )
    assert [row.status_code for row in audit_rows(session)] == [404] * 4


async def test_non_post_methods_are_405_without_stream(mcp: httpx.AsyncClient):
    for method in ("GET", "DELETE"):
        response = await asyncio.wait_for(
            mcp.request(
                method,
                "/mcp",
                headers={**MCP_HEADERS, "Accept": "text/event-stream"},
            ),
            timeout=5,
        )

        assert response.status_code == 405
        assert response.headers["allow"] == "POST"
        assert response.json() == {
            "jsonrpc": "2.0",
            "error": {"code": -32000, "message": "Method not allowed"},
            "id": None,
        }

    init = await rpc(
        mcp,
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    )
    assert init["serverInfo"]["name"] == "HumanCompiler"


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


# --- Write tools and list_my_changes -----------------------------------------

STAMP = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
NEEDS_UNCONFIRMED = "This change needs the writes:unconfirmed scope"
STALE_MESSAGE = "Changed since you read it; read it again and retry"
WRITE_ALL = [AgentScope.GOALS_WRITE, AgentScope.TASKS_WRITE, AgentScope.NOTES_WRITE]
WRITE_TOOL_SCOPES = {
    "create_goal": "goals:write",
    "update_goal": "goals:write",
    "create_task": "tasks:write",
    "update_task": "tasks:write",
    "add_dependency": "tasks:write",
    "remove_dependency": "tasks:write",
    "append_note": "notes:write",
    "replace_note": "notes:write",
    "create_log": "logs:write",
}


def _minimal_arguments() -> dict[str, dict[str, Any]]:
    """Schema-valid arguments for each write tool (the IDs exist nowhere)."""
    stamp = STAMP.isoformat()
    return {
        "create_goal": {"project_id": str(uuid4()), "title": "G"},
        "update_goal": {"goal_id": str(uuid4()), "expected_updated_at": stamp},
        "create_task": {"goal_id": str(uuid4()), "title": "T", "estimate_hours": 1},
        "update_task": {"task_id": str(uuid4()), "expected_updated_at": stamp},
        "add_dependency": {
            "task_id": str(uuid4()),
            "depends_on_task_id": str(uuid4()),
        },
        "remove_dependency": {
            "task_id": str(uuid4()),
            "depends_on_task_id": str(uuid4()),
        },
        "append_note": {"kind": "task", "id": str(uuid4()), "content_markdown": "x"},
        "replace_note": {
            "kind": "task",
            "id": str(uuid4()),
            "expected_updated_at": None,
            "content_markdown": "",
        },
        "create_log": {"task_id": str(uuid4()), "actual_minutes": 30},
    }


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _agent_changes(session: Session) -> list[AgentChange]:
    session.expire_all()
    return list(session.exec(select(AgentChange)).all())


def _count(session: Session, model: Any) -> int:
    session.expire_all()
    return session.exec(select(func.count()).select_from(model)).one()


def _token_id(session: Session, name: str) -> UUID:
    token = session.exec(select(AgentToken).where(AgentToken.name == name)).one()
    return token.id  # type: ignore[return-value]


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


async def test_write_tools_listed_with_scopes(session: Session, mcp: httpx.AsyncClient):
    init = await rpc(
        mcp,
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    )
    tools = {tool["name"]: tool for tool in (await rpc(mcp, "tools/list"))["tools"]}

    assert {*WRITE_TOOL_SCOPES, "list_my_changes"} <= set(tools)
    assert "retry_after" in init["instructions"]
    assert "schema" in init["instructions"]
    assert NOTE_REPLACE_LOSES in tools["replace_note"]["description"]
    update_task = tools["update_task"]
    for words in ("writes:unconfirmed", "cancel", "goal_id", "memo_append", "null"):
        assert words in update_task["description"], words
    schema = update_task["inputSchema"]
    assert set(schema["required"]) == {"task_id", "expected_updated_at"}
    assert {"title", "memo", "memo_append", "due_date", "priority"} <= set(
        schema["properties"]
    )
    assert "null" in tools["update_goal"]["description"]
    assert (
        tools["list_my_changes"]["inputSchema"]["properties"]["limit"]["maximum"] == 100
    )

    # A token with none of the tools' scopes gets REST's 403 for each.
    secret = issue_token(session, USER_A, [AgentScope.PROJECTS_READ])
    for tool, arguments in _minimal_arguments().items():
        is_error, body = await call(mcp, tool, arguments, secret)
        assert is_error, tool
        assert body == {
            "status": 403,
            "detail": f"Missing required scope: {WRITE_TOOL_SCOPES[tool]}",
        }, tool
    rows = audit_rows(session)
    assert sorted((row.route, row.required_scope) for row in rows) == sorted(
        (f"mcp:{tool}", scope) for tool, scope in WRITE_TOOL_SCOPES.items()
    )
    assert _agent_changes(session) == []


async def test_create_and_update_task_via_mcp(session: Session, mcp: httpx.AsyncClient):
    _, goal, _ = _tree(session)
    secret = issue_token(
        session, USER_A, [AgentScope.TASKS_WRITE, AgentScope.TASKS_READ], name="mcp"
    )

    is_error, created = await call(
        mcp,
        "create_task",
        {
            "goal_id": str(goal.id),
            "title": "Write the intro",
            "estimate_hours": 1.5,
            "priority": 2,
            "due_date": "2026-12-01",
        },
        secret,
    )
    assert not is_error, created
    assert set(created) == {"task"}
    task_id = created["task"]["id"]
    assert created["task"]["title"] == "Write the intro"
    assert created["task"]["priority"] == 2
    rest = client.get(f"/api/agent/v1/tasks/{task_id}", headers=bearer(secret))
    assert rest.status_code == 200
    assert created["task"] == rest.json()

    is_error, updated = await call(
        mcp,
        "update_task",
        {
            "task_id": task_id,
            "expected_updated_at": created["task"]["updated_at"],
            "status": "completed",
            "memo_append": "Done: drafted the intro",
        },
        secret,
    )
    assert not is_error, updated
    assert set(updated) == {"applied", "task"}
    assert updated["applied"] is True
    assert updated["task"]["status"] == "completed"
    assert updated["task"]["memo"] == "Done: drafted the intro"
    assert updated["task"]["title"] == "Write the intro"
    rest = client.get(f"/api/agent/v1/tasks/{task_id}", headers=bearer(secret))
    assert updated["task"] == rest.json()

    changes = sorted(_agent_changes(session), key=lambda row: row.created_at)
    assert [(row.entity_type, row.action) for row in changes] == [
        ("task", "create"),
        ("task", "update"),
    ]
    assert {str(row.entity_id) for row in changes} == {task_id}
    assert {row.agent_token_id for row in changes} == {_token_id(session, "mcp")}
    assert changes[0].after["title"] == "Write the intro"
    assert "description" not in changes[0].after  # only the sent fields
    assert changes[1].after == {
        "status": "completed",
        "memo_append": "Done: drafted the intro",
    }
    mcp_rows = [row for row in audit_rows(session) if row.method == "MCP"]
    assert sorted((row.route, row.status_code) for row in mcp_rows) == [
        ("mcp:create_task", 200),
        ("mcp:update_task", 200),
    ]
    assert {row.required_scope for row in mcp_rows} == {"tasks:write"}


async def test_update_task_explicit_null_and_unset(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, task = _tree(session)
    _set(session, task, due_date=STAMP + timedelta(days=3), priority=2)
    _set(session, task, updated_at=STAMP)
    _set(session, goal, due_date=STAMP + timedelta(days=5))
    _set(session, goal, updated_at=STAMP)
    secret = issue_token(session, USER_A, WRITE_ALL)

    is_error, body = await call(
        mcp,
        "update_task",
        {
            "task_id": str(task.id),
            "expected_updated_at": STAMP.isoformat(),
            "due_date": None,
        },
        secret,
    )
    assert not is_error, body
    assert body["task"]["due_date"] is None
    assert body["task"]["title"] == "Task"
    assert body["task"]["priority"] == 2
    changes = _agent_changes(session)
    assert len(changes) == 1
    assert set(changes[0].after) == {"due_date"}
    assert changes[0].after["due_date"] is None

    is_error, body = await call(
        mcp,
        "update_goal",
        {
            "goal_id": str(goal.id),
            "expected_updated_at": STAMP.isoformat(),
            "due_date": None,
        },
        secret,
    )
    assert not is_error, body
    assert body["applied"] is True
    assert body["goal"]["due_date"] is None
    assert body["goal"]["title"] == "Goal"

    session.expire_all()
    stamp = _utc(session.get(Task, task.id).updated_at)  # type: ignore[union-attr]
    is_error, body = await call(
        mcp,
        "update_task",
        {
            "task_id": str(task.id),
            "expected_updated_at": stamp.isoformat(),  # type: ignore[union-attr]
            "priority": None,
        },
        secret,
    )
    assert is_error
    assert body["status"] == 422
    assert "priority cannot be null" in json.dumps(body["detail"])
    session.expire_all()
    assert session.get(Task, task.id).priority == 2  # type: ignore[union-attr]

    # memo with memo_append is the model's 422, audited like REST.
    is_error, body = await call(
        mcp,
        "update_task",
        {
            "task_id": str(task.id),
            "expected_updated_at": stamp.isoformat(),  # type: ignore[union-attr]
            "memo": "a",
            "memo_append": "b",
        },
        secret,
    )
    assert is_error
    assert body["status"] == 422
    assert "memo or memo_append" in json.dumps(body["detail"])
    assert len(_agent_changes(session)) == 2
    statuses = [row.status_code for row in audit_rows(session)]
    assert sorted(statuses) == [200, 200, 422, 422]


async def test_stale_update_is_409_error_with_dict_detail(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, task = _tree(session)
    secret = issue_token(session, USER_A, WRITE_ALL)
    old = (STAMP - timedelta(hours=1)).isoformat()

    for tool, arguments in (
        ("update_task", {"task_id": str(task.id), "title": "New"}),
        ("update_goal", {"goal_id": str(goal.id), "title": "New"}),
    ):
        is_error, body = await call(
            mcp, tool, {**arguments, "expected_updated_at": old}, secret
        )
        assert is_error, tool
        assert body["status"] == 409
        detail = body["detail"]
        assert set(detail) == {"message", "current_updated_at"}
        assert detail["message"] == STALE_MESSAGE
        assert datetime.fromisoformat(detail["current_updated_at"]) == STAMP
    assert _agent_changes(session) == []


def _destructive_setup(session: Session) -> tuple[Task, Task, ContextNote]:
    _, goal, task = _tree(session)
    first = seed_task(session, goal, updated_at=STAMP)
    session.add(
        TaskDependency(id=uuid4(), task_id=task.id, depends_on_task_id=first.id)
    )
    session.commit()
    note = seed_note(session, USER_A, task=task, updated_at=STAMP)
    return task, first, note


def _destructive_calls(
    task: Task, first: Task, note: ContextNote
) -> list[tuple[str, dict[str, Any]]]:
    return [
        (
            "update_task",
            {
                "task_id": str(task.id),
                "expected_updated_at": STAMP.isoformat(),
                "status": "cancelled",
            },
        ),
        (
            "remove_dependency",
            {"task_id": str(task.id), "depends_on_task_id": str(first.id)},
        ),
        (
            "replace_note",
            {
                "kind": "task",
                "id": str(task.id),
                "expected_updated_at": STAMP.isoformat(),
                "content_markdown": "Replaced",
            },
        ),
    ]


async def test_destructive_without_unconfirmed_is_403_error(
    session: Session, mcp: httpx.AsyncClient
):
    task, first, note = _destructive_setup(session)
    secret = issue_token(session, USER_A, WRITE_ALL)

    for tool, arguments in _destructive_calls(task, first, note):
        is_error, body = await call(mcp, tool, arguments, secret)
        assert is_error, tool
        assert body == {"status": 403, "detail": NEEDS_UNCONFIRMED}, tool

    assert _agent_changes(session) == []
    session.expire_all()
    stored = session.get(Task, task.id)
    assert stored is not None
    assert stored.status == TaskStatus.PENDING
    assert _utc(stored.updated_at) == STAMP
    assert _count(session, TaskDependency) == 1
    stored_note = session.get(ContextNote, note.id)
    assert stored_note is not None and stored_note.content == "Note"
    assert sorted(row.status_code for row in audit_rows(session)) == [403, 403, 403]


async def test_destructive_with_unconfirmed_applies(
    session: Session, mcp: httpx.AsyncClient
):
    task, first, note = _destructive_setup(session)
    secret = issue_token(session, USER_A, [*WRITE_ALL, AgentScope.WRITES_UNCONFIRMED])
    calls = _destructive_calls(task, first, note)

    is_error, body = await call(mcp, *calls[0], secret)
    assert not is_error, body
    assert body["applied"] is True
    assert body["task"]["status"] == "cancelled"

    is_error, body = await call(mcp, *calls[1], secret)
    assert not is_error, body
    assert body["applied"] is True
    assert body["task"]["id"] == str(task.id)

    is_error, body = await call(mcp, *calls[2], secret)
    assert not is_error, body
    assert set(body) == {"applied", "note"}
    assert body["applied"] is True
    assert set(body["note"]) == {"id", "updated_at", "content_markdown"}
    assert body["note"]["id"] == str(note.id)
    assert body["note"]["content_markdown"] == "Replaced"

    changes = _agent_changes(session)
    assert len(changes) == 3
    assert all(row.destructive for row in changes)
    assert _count(session, TaskDependency) == 0


async def test_foreign_ids_are_404_errors(session: Session, mcp: httpx.AsyncClient):
    own_project, own_goal, own_task = _tree(session)
    other_project, other_goal, other_task = _tree(session, USER_B)
    seed_note(session, USER_B, task=other_task)
    secret = issue_token(session, USER_A, WRITE_ALL)
    stamp = STAMP.isoformat()
    counts = {
        model: _count(session, model)
        for model in (Goal, Task, TaskDependency, ContextNote)
    }

    def cases(project: Any, goal: Any, task: Any) -> list[tuple[str, dict[str, Any]]]:
        return [
            ("create_goal", {"project_id": str(project), "title": "G"}),
            (
                "create_task",
                {"goal_id": str(goal), "title": "T", "estimate_hours": 1},
            ),
            (
                "create_task",
                {
                    "goal_id": str(own_goal.id),
                    "title": "T",
                    "estimate_hours": 1,
                    "depends_on": [str(task)],
                },
            ),
            (
                "update_goal",
                {"goal_id": str(goal), "expected_updated_at": stamp, "title": "X"},
            ),
            (
                "update_task",
                {"task_id": str(task), "expected_updated_at": stamp, "title": "X"},
            ),
            (
                "update_task",
                {
                    "task_id": str(own_task.id),
                    "expected_updated_at": stamp,
                    "goal_id": str(goal),
                },
            ),
            (
                "add_dependency",
                {"task_id": str(own_task.id), "depends_on_task_id": str(task)},
            ),
            ("append_note", {"kind": "task", "id": str(task), "content_markdown": "x"}),
            ("append_note", {"kind": "goal", "id": str(goal), "content_markdown": "x"}),
            (
                "append_note",
                {"kind": "project", "id": str(project), "content_markdown": "x"},
            ),
            (
                "replace_note",
                {
                    "kind": "task",
                    "id": str(task),
                    "expected_updated_at": None,
                    "content_markdown": "x",
                },
            ),
        ]

    foreign = cases(other_project.id, other_goal.id, other_task.id)
    missing = cases(uuid4(), uuid4(), uuid4())
    for (tool, foreign_args), (_, missing_args) in zip(foreign, missing, strict=True):
        foreign_result = await call(mcp, tool, foreign_args, secret)
        missing_result = await call(mcp, tool, missing_args, secret)
        assert foreign_result[0] is True, (tool, foreign_result)
        assert foreign_result[1]["status"] == 404, (tool, foreign_result)
        assert foreign_result == missing_result, tool

    assert _agent_changes(session) == []
    for model, count in counts.items():
        assert _count(session, model) == count, model
    session.expire_all()
    assert session.get(Task, own_task.id).goal_id == own_goal.id  # type: ignore[union-attr]
    assert session.get(Task, other_task.id).title == "Task"  # type: ignore[union-attr]


async def test_append_note_returns_markdown(session: Session, mcp: httpx.AsyncClient):
    _, _, task = _tree(session)
    secret = issue_token(session, USER_A, [AgentScope.NOTES_WRITE])

    is_error, body = await call(
        mcp,
        "append_note",
        {
            "kind": "task",
            "id": str(task.id),
            "content_markdown": "- [ ] Ship it\n- [x] Test it",
        },
        secret,
    )

    assert not is_error, body
    assert set(body) == {"note"}
    note = body["note"]
    assert set(note) == {"id", "updated_at", "content_markdown"}
    assert "- [ ] Ship it" in note["content_markdown"]
    assert "- [x] Test it" in note["content_markdown"]
    assert note["updated_at"].endswith("+00:00")
    stored = session.exec(select(ContextNote)).one()
    assert note["id"] == str(stored.id)
    assert stored.task_id == task.id
    changes = _agent_changes(session)
    assert [(row.entity_type, row.action) for row in changes] == [
        ("context_note", "append")
    ]


async def test_add_dependency_existing_reports_created_false(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, task = _tree(session)
    first = seed_task(session, goal)
    secret = issue_token(session, USER_A, [AgentScope.TASKS_WRITE])
    arguments = {"task_id": str(task.id), "depends_on_task_id": str(first.id)}

    is_error, added = await call(mcp, "add_dependency", arguments, secret)
    assert not is_error, added
    assert set(added) == {"task", "created"}
    assert added["created"] is True
    assert added["task"]["id"] == str(task.id)

    is_error, again = await call(mcp, "add_dependency", arguments, secret)
    assert not is_error, again
    assert again["created"] is False
    assert again["task"]["id"] == str(task.id)

    assert _count(session, TaskDependency) == 1
    assert len(_agent_changes(session)) == 1


def _seed_change(session: Session, token_id: UUID | None, user_id: UUID, minute: int):
    row = AgentChange(
        user_id=user_id,
        actor="agent",
        agent_token_id=token_id,
        agent_name="agent",
        entity_type="goal",
        entity_id=uuid4(),
        action="create",
        after={},
        created_at=STAMP + timedelta(minutes=minute),
    )
    session.add(row)
    session.commit()
    return row


def _seed_proposal(session: Session, token_id: UUID, user_id: UUID, minute: int):
    row = AgentProposal(
        id=uuid4(),
        user_id=user_id,
        token_id=token_id,
        agent_name="agent",
        kind=ProposalKind.QUICK_TASK.value,
        title=f"Proposal {minute}",
        payload={"title": f"Proposal {minute}"},
        idempotency_key=f"key-{token_id}-{minute}",
        created_at=STAMP + timedelta(minutes=minute),
    )
    session.add(row)
    session.commit()
    return row


async def test_list_my_changes_only_this_token(
    session: Session, mcp: httpx.AsyncClient
):
    mine = issue_token(session, USER_A, [AgentScope.PROPOSALS_READ], name="mine")
    issue_token(session, USER_A, [AgentScope.PROPOSALS_READ], name="sibling")
    issue_token(session, USER_B, [AgentScope.PROPOSALS_READ], name="other")
    mine_id = _token_id(session, "mine")
    sibling_id = _token_id(session, "sibling")
    other_id = _token_id(session, "other")
    old_change = _seed_change(session, mine_id, USER_A, 1)
    new_change = _seed_change(session, mine_id, USER_A, 5)
    _seed_change(session, sibling_id, USER_A, 3)
    _seed_change(session, other_id, USER_B, 4)
    _seed_change(session, None, USER_A, 6)  # the user's revert
    old_proposal = _seed_proposal(session, mine_id, USER_A, 2)
    new_proposal = _seed_proposal(session, mine_id, USER_A, 7)
    _seed_proposal(session, sibling_id, USER_A, 8)
    _seed_proposal(session, other_id, USER_B, 9)

    is_error, body = await call(mcp, "list_my_changes", {}, mine)

    assert not is_error, body
    assert set(body) == {"changes", "proposals"}
    assert [row["id"] for row in body["changes"]] == [
        str(new_change.id),
        str(old_change.id),
    ]
    assert set(body["changes"][0]) == {
        "id",
        "created_at",
        "entity_type",
        "entity_id",
        "action",
        "destructive",
        "reverted_at",
    }
    assert body["changes"][0]["entity_type"] == "goal"
    assert body["changes"][0]["action"] == "create"
    assert body["changes"][0]["destructive"] is False
    assert body["changes"][0]["reverted_at"] is None
    assert datetime.fromisoformat(body["changes"][0]["created_at"]) == STAMP + (
        timedelta(minutes=5)
    )
    assert [row["id"] for row in body["proposals"]] == [
        str(new_proposal.id),
        str(old_proposal.id),
    ]
    assert body["proposals"][0] == {
        "id": str(new_proposal.id),
        "kind": "quick_task",
        "title": "Proposal 7",
        "status": "pending",
        "created_at": (STAMP + timedelta(minutes=7)).isoformat(),
        "decided_at": None,
    }

    is_error, body = await call(mcp, "list_my_changes", {"limit": 1}, mine)
    assert not is_error, body
    assert [row["id"] for row in body["changes"]] == [str(new_change.id)]
    assert [row["id"] for row in body["proposals"]] == [str(new_proposal.id)]

    is_error, body = await call(mcp, "list_my_changes", {"limit": 100}, mine)
    assert not is_error
    assert len(body["changes"]) == 2

    # Over the cap is refused by the tool's schema, before any call is made.
    result = await rpc(
        mcp,
        "tools/call",
        {"name": "list_my_changes", "arguments": {"limit": 101}},
        mine,
    )
    assert result.get("isError") is True
    assert [row.status_code for row in audit_rows(session)] == [200, 200, 200]


async def test_list_my_changes_needs_no_scope_and_hides_proposals(
    session: Session, mcp: httpx.AsyncClient
):
    writer = issue_token(session, USER_A, [AgentScope.TASKS_WRITE], name="writer")
    writer_id = _token_id(session, "writer")
    change = _seed_change(session, writer_id, USER_A, 1)
    _seed_proposal(session, writer_id, USER_A, 2)

    is_error, body = await call(mcp, "list_my_changes", {}, writer)

    assert not is_error, body
    assert [row["id"] for row in body["changes"]] == [str(change.id)]
    # Proposals need proposals:read, as in REST.
    assert body["proposals"] == []
    rows = audit_rows(session)
    assert [(row.route, row.required_scope, row.status_code) for row in rows] == [
        ("mcp:list_my_changes", None, 200)
    ]

    # Still authenticated: no token is REST's 401 and is not audited.
    is_error, body = await call(mcp, "list_my_changes", {})
    assert is_error
    assert body == {"status": 401, "detail": "Agent token required"}
    assert len(audit_rows(session)) == 1


# --- Work logs ----------------------------------------------------------------------


async def test_create_log_records_time_and_starts_pending_task(
    session: Session, mcp: httpx.AsyncClient
):
    project, goal, task = _tree(session)
    secret = issue_token(session, USER_A, [AgentScope.LOGS_WRITE], name="logger")
    comment = "Drafted the intro and fixed the outline"

    is_error, body = await call(
        mcp,
        "create_log",
        {"task_id": str(task.id), "actual_minutes": 45, "comment": comment},
        secret,
    )

    assert not is_error, body
    assert set(body) == {"log", "task"}
    log = body["log"]
    assert log["task_id"] == str(task.id)
    assert log["actual_minutes"] == 45
    assert log["comment"] == comment
    # Logging work on a pending task starts it, as in the web app.
    assert body["task"]["status"] == "in_progress"
    session.expire_all()
    stored = session.get(Log, UUID(log["id"]))
    assert stored is not None
    assert (stored.actual_minutes, stored.comment) == (45, comment)
    stored_task = session.get(Task, task.id)
    assert stored_task.status == TaskStatus.IN_PROGRESS  # type: ignore[union-attr]
    assert _utc(stored_task.updated_at) > STAMP  # type: ignore[union-attr,operator]
    # The task in the result is current, so a following update_task can use it.
    returned = datetime.fromisoformat(body["task"]["updated_at"])
    assert returned == _utc(stored_task.updated_at)  # type: ignore[union-attr]

    changes = {row.entity_type: row for row in _agent_changes(session)}
    assert set(changes) == {"log", "task"}
    log_change = changes["log"]
    assert (log_change.action, log_change.destructive) == ("create", False)
    assert log_change.entity_id == UUID(log["id"])
    assert log_change.before is None
    assert log_change.after == {
        "task_id": str(task.id),
        "actual_minutes": 45,
        "comment": comment,
    }
    assert (log_change.project_id, log_change.goal_id) == (project.id, goal.id)
    assert log_change.agent_name == "logger"
    task_change = changes["task"]
    assert (task_change.action, task_change.entity_id) == ("update", task.id)
    assert task_change.before == {"status": "pending"}
    assert task_change.after == {"status": "in_progress"}
    rows = audit_rows(session)
    assert [(row.route, row.required_scope, row.status_code) for row in rows] == [
        ("mcp:create_log", "logs:write", 200)
    ]


async def test_create_log_keeps_status_of_started_task(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, _ = _tree(session)
    task = seed_task(session, goal, status=TaskStatus.COMPLETED, updated_at=STAMP)
    secret = issue_token(session, USER_A, [AgentScope.LOGS_WRITE])

    is_error, body = await call(
        mcp, "create_log", {"task_id": str(task.id), "actual_minutes": 15}, secret
    )

    assert not is_error, body
    assert body["log"]["comment"] is None
    assert body["task"]["status"] == "completed"
    session.expire_all()
    assert _utc(session.get(Task, task.id).updated_at) == STAMP  # type: ignore[union-attr]
    assert [row.entity_type for row in _agent_changes(session)] == ["log"]


async def test_create_log_on_foreign_or_missing_task_is_404(
    session: Session, mcp: httpx.AsyncClient
):
    _, _, foreign = _tree(session, USER_B)
    secret = issue_token(session, USER_A, [AgentScope.LOGS_WRITE])

    for task_id in (foreign.id, uuid4()):
        is_error, body = await call(
            mcp, "create_log", {"task_id": str(task_id), "actual_minutes": 30}, secret
        )
        assert is_error
        assert body == {"status": 404, "detail": "Task not found"}
    assert _count(session, Log) == 0
    assert _agent_changes(session) == []
    session.expire_all()
    assert session.get(Task, foreign.id).status == TaskStatus.PENDING  # type: ignore[union-attr]


async def test_create_log_schema_limits(session: Session, mcp: httpx.AsyncClient):
    _, _, task = _tree(session)
    secret = issue_token(session, USER_A, [AgentScope.LOGS_WRITE])
    tools = {tool["name"]: tool for tool in (await rpc(mcp, "tools/list"))["tools"]}
    schema = tools["create_log"]["inputSchema"]
    assert set(schema["required"]) == {"task_id", "actual_minutes"}
    assert schema["properties"]["actual_minutes"]["maximum"] == 1440
    assert "not a destructive" in tools["create_log"]["description"].lower()

    for arguments in (
        {"actual_minutes": 0},
        {"actual_minutes": 1441},
        {"actual_minutes": 30, "comment": "x" * 501},
    ):
        result = await rpc(
            mcp,
            "tools/call",
            {"name": "create_log", "arguments": {"task_id": str(task.id), **arguments}},
            secret,
        )
        assert result.get("isError") is True, arguments
    assert _count(session, Log) == 0


async def test_list_logs_newest_first_with_totals(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, task = _tree(session)
    other_task = seed_task(session, goal)
    old = seed_log(session, task, updated_at=STAMP)
    new = seed_log(session, task, updated_at=STAMP + timedelta(hours=1))
    _set(session, new, actual_minutes=90, comment="Wrote tests")
    seed_log(session, other_task)
    secret = issue_token(session, USER_A, [AgentScope.LOGS_READ])

    is_error, body = await call(mcp, "list_logs", {"task_id": str(task.id)}, secret)

    assert not is_error, body
    assert [item["id"] for item in body["items"]] == [str(new.id), str(old.id)]
    assert body["items"][0]["comment"] == "Wrote tests"
    assert (body["count"], body["total_minutes"]) == (2, 120)

    is_error, body = await call(
        mcp, "list_logs", {"task_id": str(task.id), "limit": 1}, secret
    )
    assert not is_error, body
    assert [item["id"] for item in body["items"]] == [str(new.id)]
    assert (body["count"], body["total_minutes"]) == (2, 120)

    rows = audit_rows(session)
    assert {(row.route, row.required_scope) for row in rows} == {
        ("mcp:list_logs", "logs:read")
    }


async def test_list_logs_scope_and_ownership(session: Session, mcp: httpx.AsyncClient):
    _, _, foreign = _tree(session, USER_B)
    seed_log(session, foreign)
    reader = issue_token(session, USER_A, [AgentScope.LOGS_READ])
    no_scope = issue_token(session, USER_A, [AgentScope.TASKS_READ])

    is_error, body = await call(mcp, "list_logs", {"task_id": str(foreign.id)}, reader)
    assert is_error
    assert body == {"status": 404, "detail": "Task not found"}

    is_error, body = await call(
        mcp, "list_logs", {"task_id": str(foreign.id)}, no_scope
    )
    assert is_error
    assert body == {"status": 403, "detail": "Missing required scope: logs:read"}


async def test_goal_note_append_read_and_replace(
    session: Session, mcp: httpx.AsyncClient
):
    _, goal, _ = _tree(session)
    secret = issue_token(
        session,
        USER_A,
        [
            AgentScope.GOALS_READ,
            AgentScope.NOTES_READ,
            AgentScope.NOTES_WRITE,
            AgentScope.WRITES_UNCONFIRMED,
        ],
    )

    is_error, body = await call(
        mcp,
        "append_note",
        {"kind": "goal", "id": str(goal.id), "content_markdown": "First summary"},
        secret,
    )
    assert not is_error, body

    is_error, read = await call(mcp, "get_goal", {"goal_id": str(goal.id)}, secret)
    assert not is_error, read
    assert "First summary" in read["note"]["content_markdown"]

    is_error, body = await call(
        mcp,
        "replace_note",
        {
            "kind": "goal",
            "id": str(goal.id),
            "expected_updated_at": read["note"]["updated_at"],
            "content_markdown": "## Tidied\n\n- One point",
        },
        secret,
    )
    assert not is_error, body
    assert body["applied"] is True
    assert body["note"]["content_markdown"].startswith("## Tidied")
    stored = session.exec(select(ContextNote)).one()
    assert stored.goal_id == goal.id
    assert "First summary" not in stored.content
    changes = sorted(_agent_changes(session), key=lambda row: row.created_at)
    assert [(row.action, row.destructive) for row in changes] == [
        ("append", False),
        ("replace", True),
    ]
