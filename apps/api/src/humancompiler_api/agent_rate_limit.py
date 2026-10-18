# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Rate limits for agent tokens.

Two in-memory moving-window limits sit on top of the per-IP default limit:

- ``TOKEN_LIMIT`` per verified agent token id.
- ``AUTH_FAILURE_LIMIT`` per client IP for failed token lookups. Once reached,
  the IP is rejected before any hash lookup, even with a valid token.
"""

import math
import time
from uuid import UUID

from limits import RateLimitItem, parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter

from humancompiler_api.config import settings

TOKEN_LIMIT = parse("120 per minute")
AUTH_FAILURE_LIMIT = parse("20 per minute")

# Key scopes (namespaces) so the two limits never share counters.
_PER_AGENT_SCOPE = "agent_token"
_AUTH_FAILURE_SCOPE = "agent_auth_failure"


class AgentRateLimiter:
    """Per-token and per-IP auth-failure limits. While ``enabled`` is False the
    counting and checking methods do nothing and return None; ``reset`` always
    clears the counters."""

    def __init__(self) -> None:
        self.storage = MemoryStorage()
        self.limiter = MovingWindowRateLimiter(self.storage)
        # The whole test suite shares one client address and token counters.
        self.enabled: bool = settings.environment != "test"

    def _retry_after(self, item: RateLimitItem, *identifiers: str) -> int:
        reset_at, _ = self.limiter.get_window_stats(item, *identifiers)
        # Round up so clients never retry inside the window (as rate_limiter.py).
        return max(1, math.ceil(reset_at - time.time()))

    def hit_token(self, token_id: UUID) -> int | None:
        """Count one request; return Retry-After seconds when over the limit."""
        if not self.enabled:
            return None
        key = str(token_id)
        if self.limiter.hit(TOKEN_LIMIT, _PER_AGENT_SCOPE, key):
            return None
        return self._retry_after(TOKEN_LIMIT, _PER_AGENT_SCOPE, key)

    def auth_failure_retry_after(self, client_ip: str) -> int | None:
        """Without counting, return Retry-After seconds if the IP is blocked."""
        if not self.enabled:
            return None
        if self.limiter.test(AUTH_FAILURE_LIMIT, _AUTH_FAILURE_SCOPE, client_ip):
            return None
        return self._retry_after(AUTH_FAILURE_LIMIT, _AUTH_FAILURE_SCOPE, client_ip)

    def record_auth_failure(self, client_ip: str) -> None:
        """Count one failed authentication for the IP."""
        if not self.enabled:
            return
        self.limiter.hit(AUTH_FAILURE_LIMIT, _AUTH_FAILURE_SCOPE, client_ip)

    def reset(self) -> None:
        """Clear every counter."""
        self.storage.reset()


agent_rate_limiter = AgentRateLimiter()
