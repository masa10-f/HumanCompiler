# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Authentication and scope checks for agent-facing endpoints.

Agent tokens are opaque, hashed secrets (``hc_agent_<public_id>_<secret>``).
Supabase JWTs are deliberately not accepted here.
"""

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from humancompiler_api.agent_rate_limit import agent_rate_limiter
from humancompiler_api.client_ip import get_client_ip
from humancompiler_api.database import get_session
from humancompiler_api.models import AgentScope
from humancompiler_api.services import agent_token_service

logger = logging.getLogger(__name__)

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


def _too_many_requests(detail: str, retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(retry_after)},
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
    """Authenticate the request by agent token and expose the principal.

    A request without a token header is rejected before any rate limit is
    consulted, so it never counts as an authentication failure.
    """
    token = extract_agent_token(request)

    # Reject an IP over the failure limit before the hash lookup, even when the
    # token is valid. These 429s are not audited.
    client_ip = get_client_ip(request)
    retry_after = agent_rate_limiter.auth_failure_retry_after(client_ip)
    if retry_after is not None:
        setattr(request.state, SKIP_AUDIT_STATE, True)
        # Not audited, so this is the only server-side trace of the lockout.
        logger.warning("Agent auth failure limit exceeded for IP: %s", client_ip)
        raise _too_many_requests(
            "Too many failed agent authentication attempts", retry_after
        )

    agent_token = agent_token_service.get_active_token_by_secret(session, token)
    if agent_token is None or agent_token.id is None:
        agent_rate_limiter.record_auth_failure(client_ip)
        raise _unauthorized("Invalid agent token")

    # Build the principal before touch_last_used: its commit expires the instance.
    principal = AgentPrincipal(
        token_id=agent_token.id,
        user_id=agent_token.user_id,
        scopes=frozenset(agent_token.scopes),
        token_prefix=agent_token.token_prefix,
    )
    # Expose the principal before the token limit so its 429 is audited with it.
    request.state.agent_principal = principal

    retry_after = agent_rate_limiter.hit_token(principal.token_id)
    if retry_after is not None:
        raise _too_many_requests("Agent token rate limit exceeded", retry_after)

    agent_token_service.touch_last_used(session, agent_token)
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
