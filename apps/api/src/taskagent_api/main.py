import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import ValidationError

from taskagent_api.config import settings
from taskagent_api.database import db
from taskagent_api.performance_monitor import performance_monitor
from taskagent_api.rate_limiter import configure_rate_limiting, limiter
from taskagent_api.exceptions import (
    TaskAgentException,
    general_exception_handler,
    http_exception_handler,
    pydantic_validation_exception_handler,
    task_agent_exception_handler,
    validation_exception_handler,
)
from taskagent_api.routers import (
    ai_planning,
    goals,
    logs,
    monitoring,
    progress,
    projects,
    scheduler,
    task_dependencies,
    tasks,
    users,
    user_settings,
    weekly_schedule,
    weekly_recurring_tasks,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("🚀 FastAPI server starting up...")

    # Log configuration info
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Host: {settings.host}, Port: {settings.port}")
    logger.info(f"Debug mode: {settings.debug}")

    # Test database connection (non-blocking)
    try:
        if await db.health_check():
            logger.info("✅ Database connection successful")

            # Run database migrations
            try:
                from taskagent_api.migrations import run_migrations

                await run_migrations()
                logger.info("✅ Database migrations completed")
            except Exception as migration_error:
                logger.warning(f"⚠️ Migration warning: {migration_error}")

            # Setup performance monitoring
            engine = db.get_engine()
            performance_monitor.setup_listeners(engine)
            logger.info("✅ Performance monitoring enabled")
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


# Custom CORS middleware for dynamic Vercel domains
@app.middleware("http")
async def cors_middleware(request, call_next):
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

    # Wrap call_next in try-catch to ensure CORS headers are always added
    try:
        response = await call_next(request)
    except Exception as e:
        # Create error response with CORS headers
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        logger = logging.getLogger(__name__)

        # Preserve original status code for HTTPException
        if isinstance(e, HTTPException):
            logger.warning(f"HTTP {e.status_code} error: {e.detail}")
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
app.add_exception_handler(TaskAgentException, task_agent_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Include API routers
app.include_router(users.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(task_dependencies.router)
app.include_router(logs.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(scheduler.router, prefix="/api")
app.include_router(weekly_schedule.router, prefix="/api")
app.include_router(weekly_recurring_tasks.router, prefix="/api")
app.include_router(ai_planning.router, prefix="/api")
app.include_router(user_settings.router)
app.include_router(monitoring.router)


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
    return JSONResponse({"message": "TaskAgent API", "status": "active"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "taskagent_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        reload_dirs=["./"],
    )
