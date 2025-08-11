import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
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
    monitoring,
    projects,
    scheduler,
    tasks,
    users,
    user_settings,
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

    response = await call_next(request)

    if origin and is_origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, DELETE, OPTIONS"
        )
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Max-Age"] = "86400"

    # Handle preflight requests
    if request.method == "OPTIONS":
        if origin and is_origin_allowed(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.headers["Access-Control-Max-Age"] = "86400"

    return response


# Add standard CORS middleware as fallback
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

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
app.include_router(scheduler.router, prefix="/api")
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
