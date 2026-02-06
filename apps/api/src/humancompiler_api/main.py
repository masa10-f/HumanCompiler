# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from humancompiler_api.config import settings
from humancompiler_api.database import db
from humancompiler_api.performance_monitor import performance_monitor
from humancompiler_api.rate_limiter import configure_rate_limiting, limiter
from humancompiler_api.exceptions import (
    HumanCompilerException,
    general_exception_handler,
    http_exception_handler,
    humancompiler_exception_handler,
    pydantic_validation_exception_handler,
    validation_exception_handler,
)
from humancompiler_api.routers import (
    ai_planning,
    data_export,
    goal_dependencies,
    goals,
    logs,
    monitoring,
    notes,
    notifications,
    progress,
    projects,
    quick_tasks,
    reports,
    reschedule,
    scheduler,
    simple_backup_api,
    slot_templates,
    task_dependencies,
    tasks,
    timeline,
    users,
    user_settings,
    websocket,
    weekly_schedule,
    weekly_recurring_tasks,
    work_sessions,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("🚀 FastAPI server starting up...")

    # Database migrations are now run manually before deployment
    # Use: python migrate.py apply
    # Auto-migration disabled for faster startup (Fly.io health check timeout)
    logger.info("💡 Migrations should be run manually: python migrate.py apply")

    # Log configuration info
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Host: {settings.host}, Port: {settings.port}")
    logger.info(f"Debug mode: {settings.debug}")

    # Test database connection (non-blocking)
    try:
        if await db.health_check():
            logger.info("✅ Database connection successful")

            # Run database migrations (使用の際はmigration_manager.pyを利用してください)
            logger.info(
                "💡 マイグレーション実行時は 'python migrate.py apply' を使用してください"
            )

            # Setup performance monitoring
            engine = db.get_engine()
            performance_monitor.setup_listeners(engine)
            logger.info("✅ Performance monitoring enabled")

            # Pre-warm connection pool to trigger dialect initialization
            # (select pg_catalog.version()) during startup with retries,
            # instead of failing on the first user request.
            if db.warm_pool(max_retries=3, retry_delay=2.0):
                logger.info("✅ Connection pool pre-warmed")
            else:
                logger.warning(
                    "⚠️ Connection pool warm-up failed — first request may be slow"
                )

            # Simple backup system (ローカル定期バックアップはcronで実行)
            logger.info(
                "💡 バックアップ設定は docs/dev/local-backup-guide.md を参照してください"
            )

            # Start notification scheduler (Issue #228)
            try:
                from humancompiler_api.scheduler.notification_scheduler import (
                    start_notification_scheduler,
                )

                start_notification_scheduler()
                logger.info("✅ Notification scheduler started")
            except Exception as e:
                logger.warning(f"⚠️ Failed to start notification scheduler: {e}")
        else:
            logger.warning("⚠️ Database connection failed, continuing in degraded mode")
    except Exception as e:
        logger.warning(
            f"⚠️ Database health check error: {e}, continuing in degraded mode"
        )

    logger.info("✅ FastAPI server startup complete")
    yield
    # Shutdown
    logger.info("🔄 FastAPI server shutting down...")

    # Stop notification scheduler (Issue #228)
    try:
        from humancompiler_api.scheduler.notification_scheduler import (
            stop_notification_scheduler,
        )

        stop_notification_scheduler()
        logger.info("✅ Notification scheduler stopped")
    except Exception as e:
        logger.warning(f"⚠️ Failed to stop notification scheduler: {e}")

    # Simple backup system - no scheduler to stop
    logger.info("✅ Server shutdown complete")


# Initialize FastAPI app
app = FastAPI(
    title=settings.api_title,
    description=settings.api_description,
    version=settings.api_version,
    lifespan=lifespan,
)


# Configure CORS with dynamic Vercel domain support
def is_origin_allowed(origin: str) -> bool:
    """Check if origin is allowed based on our CORS policy"""
    logger = logging.getLogger(__name__)

    # Enhanced logging for debugging
    logger.info(f"CORS: Checking origin: {origin}")

    # Extract domain info for debugging
    if origin.endswith(".vercel.app"):
        subdomain = (
            origin.replace("https://", "")
            .replace("http://", "")
            .replace(".vercel.app", "")
        )
        logger.info(f"CORS: Vercel subdomain extracted: '{subdomain}'")

    # Check static allowed origins
    if origin in settings.cors_origins_list:
        logger.info(f"CORS: Origin {origin} allowed by static list")
        return True

    # Check dynamic Vercel domains
    if settings.is_vercel_domain_allowed(origin):
        logger.info(f"CORS: Origin {origin} allowed by Vercel domain check")
        return True

    # Check Fly.io API domains (for cross-environment access)
    if settings.is_fly_domain_allowed(origin):
        logger.info(f"CORS: Origin {origin} allowed by Fly.io domain check")
        return True

    logger.warning(
        f"CORS: Origin {origin} BLOCKED - not in allowed list or domain patterns"
    )
    logger.info(f"CORS: Available static origins: {settings.cors_origins_list}")
    return False


# Slow request threshold in seconds
SLOW_REQUEST_THRESHOLD = 1.0


# Custom CORS middleware for dynamic Vercel domains + request timing
@app.middleware("http")
async def cors_middleware(request, call_next):
    perf_logger = logging.getLogger("humancompiler.perf")
    origin = request.headers.get("origin")

    # Handle preflight requests first
    if request.method == "OPTIONS":
        if origin and is_origin_allowed(origin):
            # Create a successful OPTIONS response
            from fastapi.responses import Response

            preflight_response = Response(status_code=200)
            preflight_response.headers["Access-Control-Allow-Origin"] = origin
            preflight_response.headers["Access-Control-Allow-Credentials"] = "true"
            preflight_response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, DELETE, OPTIONS"
            )
            preflight_response.headers["Access-Control-Allow-Headers"] = "*"
            preflight_response.headers["Access-Control-Max-Age"] = "86400"
            return preflight_response

    # Start timing
    start_time = time.monotonic()

    # Wrap call_next in try-catch to ensure CORS headers are always added
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception as e:
        # Create error response with CORS headers
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        logger = logging.getLogger(__name__)

        # Preserve original status code for HTTPException
        if isinstance(e, HTTPException):
            logger.warning(f"HTTP {e.status_code} error: {e.detail}")
            status_code = e.status_code
            response = JSONResponse(
                status_code=e.status_code,
                content={"detail": e.detail, "error_code": None},
            )
        else:
            # Only use 500 for unexpected errors
            import traceback

            logger.error(f"Unexpected error: {type(e).__name__}: {e}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "error_code": None,
                    "error_type": type(e).__name__,
                    "debug_message": str(e) if str(e) else "No details available",
                },
            )

    # Log request timing
    duration = time.monotonic() - start_time
    method = request.method
    path = request.url.path

    if duration >= SLOW_REQUEST_THRESHOLD:
        perf_logger.warning("SLOW %s %s %d %.3fs", method, path, status_code, duration)
    else:
        perf_logger.info("%s %s %d %.3fs", method, path, status_code, duration)

    # Add timing header for client-side observability
    response.headers["X-Response-Time"] = f"{duration:.3f}s"

    # Always add CORS headers for allowed origins
    if origin and is_origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, DELETE, OPTIONS"
        )
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Max-Age"] = "86400"

    return response


# Remove standard CORS middleware - using custom CORS middleware only
# The custom cors_middleware function above handles all CORS processing

# Configure rate limiting
configure_rate_limiting(app)

# Add exception handlers
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(ValidationError, pydantic_validation_exception_handler)
app.add_exception_handler(HumanCompilerException, humancompiler_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Include API routers
app.include_router(users.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(task_dependencies.router)
app.include_router(goal_dependencies.router)
app.include_router(logs.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(scheduler.router, prefix="/api")
app.include_router(timeline.router, prefix="/api/timeline", tags=["timeline"])
app.include_router(weekly_schedule.router, prefix="/api")
app.include_router(weekly_recurring_tasks.router, prefix="/api")
app.include_router(quick_tasks.router, prefix="/api")
app.include_router(ai_planning.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(user_settings.router)
app.include_router(monitoring.router)
app.include_router(simple_backup_api.router)
app.include_router(data_export.router, tags=["data-export"])
app.include_router(work_sessions.router, prefix="/api")
# Issue #227: Reschedule router
app.include_router(reschedule.router, prefix="/api")
# Issue #228: Notification/Escalation routers
app.include_router(notifications.router, prefix="/api")
app.include_router(websocket.router)
# Context notes router
app.include_router(notes.router, prefix="/api")
# Slot templates router
app.include_router(slot_templates.router, prefix="/api")


# Health check endpoint
@app.get("/health")
@limiter.limit("1000 per minute")
async def health_check(request: Request):
    """Health check endpoint"""
    db_healthy = await db.health_check()

    # Minimal information exposure for security
    if db_healthy:
        return JSONResponse({"status": "healthy", "message": "OK"})
    else:
        return JSONResponse(
            {"status": "unhealthy", "message": "Service temporarily unavailable"},
            status_code=503,
        )


# Root endpoint
@app.get("/")
@limiter.limit("1000 per minute")
async def root(request: Request):
    """Root endpoint with API information"""
    # Minimal information exposure for security
    return JSONResponse({"message": "HumanCompiler API", "status": "active"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "humancompiler_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        reload_dirs=["./"],
    )
