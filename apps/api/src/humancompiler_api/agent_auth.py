# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Authentication and scope checks for agent-facing endpoints.

Agent tokens are opaque, hashed secrets (``hc_agent_<public_id>_<secret>``).
Supabase JWTs are deliberately not accepted here.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from humancompiler_api.database import get_session
from humancompiler_api.models import AgentScope
from humancompiler_api.services import agent_token_service

# Lowercase header names, in lookup priority order after "Authorization: Bearer".
_FALLBACK_HEADERS = ("x-humancompiler-agent-token", "x-humancompiler-hook-token")

# public_id is always 8 URL-safe chars and may itself contain "_" or "-", so the
# prefix must be matched positionally, never by splitting on "_".
_TOKEN_PREFIX_PATTERN = re.compile(r"^(hc_agent_|hc_hook_)([A-Za-z0-9_-]{8})_")

# ``request.state`` attribute that, when truthy, tells AgentAuditMiddleware not
# to record the request.
SKIP_AUDIT_STATE = "skip_agent_audit"


@dataclass(frozen=True)
class AgentPrincipal:
    """The authenticated agent token. Scopes stay as raw strings on purpose so
    a scope unknown to this code version never breaks authentication."""

    token_id: UUID
    user_id: UUID
    scopes: frozenset[str]
    token_prefix: str


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def extract_agent_token(request: Request) -> str:
    """Extract the agent token from the supported headers, in priority order."""
    authorization = request.headers.get("authorization")
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()

    for header in _FALLBACK_HEADERS:
        header_token = request.headers.get(header)
        if header_token and header_token.strip():
            return header_token.strip()

    raise _unauthorized("Agent token required")


def extract_token_prefix(token: str) -> str | None:
    """Return the non-secret display prefix (namespace + public_id), if any."""
    match = _TOKEN_PREFIX_PATTERN.match(token)
    if match is None:
        return None
    return match.group(1) + match.group(2)


def get_agent_principal(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> AgentPrincipal:
    """Authenticate the request by agent token and expose the principal."""
    token = extract_agent_token(request)
    agent_token = agent_token_service.get_active_token_by_secret(session, token)
    if agent_token is None or agent_token.id is None:
        raise _unauthorized("Invalid agent token")

    # Build the principal before touch_last_used: its commit expires the instance.
    principal = AgentPrincipal(
        token_id=agent_token.id,
        user_id=agent_token.user_id,
        scopes=frozenset(agent_token.scopes),
        token_prefix=agent_token.token_prefix,
    )
    agent_token_service.touch_last_used(session, agent_token)
    request.state.agent_principal = principal
    return principal


def require_scope(scope: AgentScope) -> Callable[..., AgentPrincipal]:
    """Build a dependency that authenticates and requires ``scope``.

    The required scope is recorded before authentication runs so audit logging
    sees it even when the request is rejected with 401.
    """

    def dependency(
        request: Request,
        session: Annotated[Session, Depends(get_session)],
    ) -> AgentPrincipal:
        request.state.required_scope = scope.value
        principal = get_agent_principal(request, session)
        if scope.value not in principal.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required scope: {scope.value}",
            )
        return principal

    return dependency
