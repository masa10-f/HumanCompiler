"""
Rate limiting middleware for API protection
"""

import logging
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request, Response
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

logger = logging.getLogger(__name__)

# Create limiter instance with custom key function
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per minute", "1000 per hour"],
    headers_enabled=True,  # Include rate limit headers in responses
    storage_uri=None,  # In-memory storage for development (use Redis for production clustering)
)

# Custom rate limit configurations for different endpoints
RATE_LIMITS = {
    # Authentication endpoints - stricter limits
    "/api/auth/*": "5 per minute",
    "/api/login": "5 per minute",
    "/api/register": "3 per minute",
    # AI endpoints - expensive operations
    "/api/ai/weekly-plan": "10 per hour",
    "/api/ai/analyze-workload": "20 per hour",
    "/api/ai/suggest-priorities": "20 per hour",
    "/api/schedule/daily": "30 per hour",
    # CRUD operations - moderate limits
    "/api/projects/*": "60 per minute",
    "/api/goals/*": "60 per minute",
    "/api/tasks/*": "60 per minute",
    # Read-heavy endpoints - higher limits
    "/api/projects": "100 per minute",
    "/api/goals": "100 per minute",
    "/api/tasks": "100 per minute",
    # Health check - very high limit
    "/health": "1000 per minute",
    "/": "1000 per minute",
}


def get_rate_limit_for_path(path: str) -> str:
    """
    Get the appropriate rate limit for a given path
    """
    # Check exact matches first
    if path in RATE_LIMITS:
        return RATE_LIMITS[path]

    # Check wildcard patterns
    for pattern, limit in RATE_LIMITS.items():
        if "*" in pattern:
            base_path = pattern.replace("/*", "")
            if path.startswith(base_path):
                return limit

    # Return default limit
    return "60 per minute"


def configure_rate_limiting(app):
    """
    Configure rate limiting for the FastAPI application
    """
    # Add rate limit exceeded handler
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Log configuration
    logger.info("✅ Rate limiting configured with the following limits:")
    for path, limit in RATE_LIMITS.items():
        logger.info(f"  {path}: {limit}")

    return limiter


# Production Redis configuration example:
# For production deployment, replace storage_uri=None with:
# storage_uri="redis://localhost:6379"
#
# This ensures rate limits persist across server restarts and work correctly
# in multi-instance deployments (Fly.io scaling, Kubernetes, etc.)
