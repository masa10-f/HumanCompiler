from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)
from humancompiler_api.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"model": ErrorResponse, "description": "Project already exists"},
    },
)
async def create_project(
    project_data: ProjectCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProjectResponse:
    """Create a new project"""
    project = project_service.create_project(
        session, project_data, current_user.user_id
    )
    return ProjectResponse.model_validate(project)


@router.get(
    "/",
    response_model=list[ProjectResponse],
)
async def get_projects(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ProjectResponse]:
    """Get projects for current user"""
    import logging
    import time

    logger = logging.getLogger(__name__)

    start_time = time.time()
    logger.info(f"📋 Getting projects for user {current_user.user_id}")

    try:
        db_start = time.time()
        projects = project_service.get_projects(
            session, current_user.user_id, skip, limit
        )
        db_time = time.time() - db_start

        response_start = time.time()
        result = [ProjectResponse.model_validate(project) for project in projects]
        response_time = time.time() - response_start

        total_time = time.time() - start_time
        logger.info(
            f"✅ Found {len(projects)} projects | DB: {db_time:.3f}s | Response: {response_time:.3f}s | Total: {total_time:.3f}s"
        )

        return result
    except Exception as e:
        logger.error(f"❌ Error getting projects: {e}")
        raise


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def get_project(
    project_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProjectResponse:
    """Get specific project"""
    project = project_service.get_project(session, project_id, current_user.user_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorResponse.create(
                code="RESOURCE_NOT_FOUND",
                message="Project not found",
                details={"project_id": str(project_id)},
            ).model_dump(),
        )
    return ProjectResponse.model_validate(project)


@router.put(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def update_project(
    project_id: UUID,
    project_data: ProjectUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProjectResponse:
    """Update specific project"""
    project = project_service.update_project(
        session, project_id, current_user.user_id, project_data
    )
    return ProjectResponse.model_validate(project)


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def delete_project(
    project_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific project"""
    try:
        project_service.delete_project(session, project_id, current_user.user_id)
    except Exception as e:
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Project deletion error: {e}")
        logger.error(f"Project ID: {project_id}, User ID: {current_user.user_id}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="INTERNAL_SERVER_ERROR",
                message="Project deletion failed",
                details={"error_type": type(e).__name__, "project_id": str(project_id)},
            ).model_dump(),
        )
