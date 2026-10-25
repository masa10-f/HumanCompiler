# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Audit logging for agent-facing endpoints.

HTTP requests under the agent prefixes whose token reached the lookup in
``get_agent_principal`` are recorded in ``agent_audit_logs``. Request bodies,
query values and token secrets are never stored, and ``route`` is the route
template, not the path.
"""

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from sqlmodel import Session, col, delete, select

from humancompiler_api.agent_auth import (
    AUDIT_STATE,
    AgentPrincipal,
    extract_agent_token,
    extract_token_prefix,
)
from humancompiler_api.client_ip import resolve_client_ip
from humancompiler_api.database import db
from humancompiler_api.models import AgentAuditLog

logger = logging.getLogger(__name__)

AUDITED_PATH_PREFIXES = ("/api/agent/", "/api/hooks/")
UNMATCHED_ROUTE = "<unmatched>"
AUDIT_LOG_RETENTION = timedelta(days=90)


def route_template(scope: Scope) -> str:
    """Return the full template of the matched route, or UNMATCHED_ROUTE.

    Older FastAPI flattens included routers, so ``route.path`` is the full
    template. Newer FastAPI keeps them nested and ``route.path`` is relative to
    the include prefix. Find the suffix of the request path that the route
    matches and put the prefix in front. The include prefixes in this app have
    no path parameters, so the prefix never carries IDs.
    """
    route = scope.get("route")
    route_path = getattr(route, "path", None)
    path_regex = getattr(route, "path_regex", None)
    if not route_path or path_regex is None:
        return UNMATCHED_ROUTE

    path = scope.get("path", "")
    for index, char in enumerate(path):
        if char == "/" and path_regex.match(path[index:]):
            return path[:index] + route_path
    return UNMATCHED_ROUTE


# Replaced in tests to point at the test database.
session_factory: Callable[[], Session] = lambda: Session(db.get_engine())  # noqa: E731


def write_audit_log(entry: AgentAuditLog) -> None:
    """Persist one audit row. Errors propagate to the caller."""
    with session_factory() as session:
        session.add(entry)
        session.commit()


def purge_expired_audit_logs(session: Session, now: datetime | None = None) -> int:
    """Delete audit rows older than ``AUDIT_LOG_RETENTION`` and return the count."""
    cutoff = (now or datetime.now(UTC)) - AUDIT_LOG_RETENTION
    result = session.exec(
        delete(AgentAuditLog).where(col(AgentAuditLog.created_at) < cutoff)
    )
    session.commit()
    return result.rowcount


def list_audit_logs_for_token(
    session: Session, token_id: UUID, user_id: UUID, limit: int
) -> list[AgentAuditLog]:
    """Return the newest audit rows of one token owned by ``user_id``."""
    statement = (
        select(AgentAuditLog)
        .where(
            AgentAuditLog.token_id == token_id,
            AgentAuditLog.user_id == user_id,
        )
        .order_by(col(AgentAuditLog.created_at).desc(), col(AgentAuditLog.id).desc())
        .limit(limit)
    )
    return list(session.exec(statement).all())


class AgentAuditMiddleware:
    """Record agent requests after the response has been sent.

    Pure ASGI so the write happens once the last body chunk has gone out,
    without delaying the response, and so exceptions from the app are seen in
    the same ``try/finally``.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(
            AUDITED_PATH_PREFIXES
        ):
            await self.app(scope, receive, send)
            return

        try:
            token = extract_agent_token(Request(scope))
        except HTTPException:
            # No token header: not recorded.
            await self.app(scope, receive, send)
            return

        status_code: int | None = None

        async def wrapped_send(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        start = time.monotonic()
        try:
            await self.app(scope, receive, wrapped_send)
        finally:
            duration_ms = int((time.monotonic() - start) * 1000)
            state = scope.get("state", {})
            if state.get(AUDIT_STATE):
                await self._record(scope, state, token, status_code, duration_ms)

    @staticmethod
    async def _record(
        scope: Scope,
        state: dict[str, Any],
        token: str,
        status_code: int | None,
        duration_ms: int,
    ) -> None:
        # Everything here runs in the caller's ``finally``; a failure must
        # neither replace the app's own exception nor surface after a response.
        try:
            principal = state.get("agent_principal")
            if isinstance(principal, AgentPrincipal):
                token_id = principal.token_id
                user_id = principal.user_id
                token_prefix: str | None = principal.token_prefix
            else:
                token_id = None
                user_id = None
                token_prefix = extract_token_prefix(token)

            entry = AgentAuditLog(
                id=uuid4(),
                token_id=token_id,
                user_id=user_id,
                token_prefix=token_prefix,
                method=scope["method"],
                route=route_template(scope),
                required_scope=state.get("required_scope"),
                # No response started means the app raised; the server returns 500.
                status_code=status_code if status_code is not None else 500,
                duration_ms=duration_ms,
                client_ip=resolve_client_ip(scope),
            )
            await run_in_threadpool(write_audit_log, entry)
        except Exception:
            logger.exception("Failed to write agent audit log")
