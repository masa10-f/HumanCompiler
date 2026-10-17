"""
Rate limiting middleware for API protection
"""

import logging
import math
import time

from fastapi import FastAPI
from limits import parse_many
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from humancompiler_api.client_ip import get_client_ip, resolve_client_ip
from humancompiler_api.config import settings

logger = logging.getLogger(__name__)

# Applied per client IP to every HTTP request by DefaultRateLimitMiddleware.
# Routes with an @limiter.limit decorator are additionally subject to their own.
DEFAULT_LIMITS = ["200 per minute"]
_DEFAULT_LIMIT_ITEMS = [item for spec in DEFAULT_LIMITS for item in parse_many(spec)]
_DEFAULT_LIMIT_SCOPE = "default"

# Create limiter instance with custom key function
limiter = Limiter(
    key_func=get_client_ip,
    headers_enabled=True,  # Include rate limit headers in responses
    storage_uri=None,  # In-memory storage for development (use Redis for production clustering)
    # The whole test suite shares one client address and in-memory buckets
    enabled=settings.environment != "test",
)


class DefaultRateLimitMiddleware:
    """
    Enforce DEFAULT_LIMITS per client IP on every HTTP request.

    slowapi's own middleware only applies default_limits to routes it finds in
    the top-level app.routes. Current FastAPI keeps included routers nested, so
    it would treat every /api route as exempt.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not limiter.enabled:
            await self.app(scope, receive, send)
            return

        key = resolve_client_ip(scope)
        for item in _DEFAULT_LIMIT_ITEMS:
            if not limiter.limiter.hit(item, _DEFAULT_LIMIT_SCOPE, key):
                reset_at, _ = limiter.limiter.get_window_stats(
                    item, _DEFAULT_LIMIT_SCOPE, key
                )
                logger.warning("🔒 Default rate limit exceeded for IP: %s", key)
                response = JSONResponse(
                    {"error": f"Rate limit exceeded: {item}"},
                    status_code=429,
                    # Round up so clients never retry inside the window
                    headers={
                        "Retry-After": str(max(1, math.ceil(reset_at - time.time())))
                    },
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


def configure_rate_limiting(app: FastAPI) -> Limiter:
    """
    Configure rate limiting for the FastAPI application.

    Call this before registering the CORS middleware so that the limiter sits
    inside it and 429 responses still carry CORS headers.
    """
    # Add rate limit exceeded handler
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(DefaultRateLimitMiddleware)

    logger.info(
        "✅ Rate limiting configured (per client IP): default %s, enabled=%s",
        ", ".join(DEFAULT_LIMITS),
        limiter.enabled,
    )

    return limiter


# Production Redis configuration example:
# For production deployment, replace storage_uri=None with:
# storage_uri="redis://localhost:6379"
#
# This ensures rate limits persist across server restarts and work correctly
# in multi-instance deployments (Fly.io scaling, Kubernetes, etc.)
