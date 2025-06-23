import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from config import settings
from database import db
from exceptions import (
    TaskAgentException,
    general_exception_handler,
    http_exception_handler,
    pydantic_validation_exception_handler,
    task_agent_exception_handler,
    validation_exception_handler,
)
from routers import goals, projects, tasks, scheduler, ai_planning


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("🚀 FastAPI server starting up...")

    # Test database connection
    if await db.health_check():
        logger.info("✅ Database connection successful")
    else:
        logger.error("❌ Database connection failed")

    yield
    # Shutdown
    logger.info("🔄 FastAPI server shutting down...")

# Initialize FastAPI app
app = FastAPI(
    title=settings.api_title,
    description=settings.api_description,
    version=settings.api_version,
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Add exception handlers
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(ValidationError, pydantic_validation_exception_handler)
app.add_exception_handler(TaskAgentException, task_agent_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Include API routers
app.include_router(projects.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(scheduler.router, prefix="/api")
app.include_router(ai_planning.router, prefix="/api")

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    db_healthy = await db.health_check()

    return {
        "status": "healthy" if db_healthy else "unhealthy",
        "message": "TaskAgent API is running",
        "version": settings.api_version,
        "database": "connected" if db_healthy else "disconnected"
    }

# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Welcome to TaskAgent API",
        "version": settings.api_version,
        "docs": "/docs",
        "health": "/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        reload_dirs=["./"]
    )
