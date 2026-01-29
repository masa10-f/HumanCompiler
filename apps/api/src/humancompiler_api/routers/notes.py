"""
Context Notes API router for rich text notes on projects, goals, and tasks
"""

import logging
from collections.abc import Generator
from datetime import datetime, UTC
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ContextNote,
    ContextNoteUpdate,
    ContextNoteResponse,
    ErrorResponse,
    Project,
    Goal,
    Task,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


# Helper functions to verify ownership
def verify_project_ownership(
    session: Session, project_id: UUID, user_id: str
) -> Project:
    """Verify that the user owns the project"""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    # Convert user_id string to UUID for comparison
    if str(project.owner_id) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this project",
        )
    return project


def verify_goal_ownership(session: Session, goal_id: UUID, user_id: str) -> Goal:
    """Verify that the user owns the goal (via project)"""
    goal = session.get(Goal, goal_id)
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )
    project = session.get(Project, goal.project_id)
    # Convert owner_id to string for comparison
    if not project or str(project.owner_id) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this goal",
        )
    return goal


def verify_task_ownership(session: Session, task_id: UUID, user_id: str) -> Task:
    """Verify that the user owns the task (via goal/project)"""
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    goal = session.get(Goal, task.goal_id)
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )
    project = session.get(Project, goal.project_id)
    # Convert owner_id to string for comparison
    if not project or str(project.owner_id) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this task",
        )
    return task


def get_or_create_note(
    session: Session,
    user_id: str,
    project_id: UUID | None = None,
    goal_id: UUID | None = None,
    task_id: UUID | None = None,
) -> ContextNote:
    """Get existing note or create a new one.

    Handles concurrent creation race conditions by catching IntegrityError
    and retrying the select query.
    """
    # Build query based on entity type
    query = select(ContextNote)

    if project_id:
        query = query.where(ContextNote.project_id == project_id)
    elif goal_id:
        query = query.where(ContextNote.goal_id == goal_id)
    elif task_id:
        query = query.where(ContextNote.task_id == task_id)
    else:
        raise ValueError("At least one entity ID must be provided")

    note = session.exec(query).first()

    if not note:
        # Create new note with user_id for RLS
        note = ContextNote(
            user_id=UUID(user_id),
            project_id=project_id,
            goal_id=goal_id,
            task_id=task_id,
            content="",
            content_type="markdown",
        )
        try:
            session.add(note)
            session.commit()
            session.refresh(note)
        except IntegrityError:
            # Race condition: another request created the note simultaneously
            # Rollback and fetch the existing note
            session.rollback()
            note = session.exec(query).first()
            if not note:
                # Should not happen, but handle gracefully
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create or retrieve note",
                )
            logger.info("Handled concurrent note creation race condition")

    return note


# Project Notes
@router.get(
    "/projects/{project_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_project_note(
    project_id: UUID,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Get or create a note for a project"""
    verify_project_ownership(session, project_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, project_id=project_id)
    return ContextNoteResponse.model_validate(note)


@router.put(
    "/projects/{project_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def update_project_note(
    project_id: UUID,
    note_data: ContextNoteUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Update a project's note (creates if doesn't exist)"""
    verify_project_ownership(session, project_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, project_id=project_id)

    # Update fields
    update_data = note_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(note, field, value)

    note.updated_at = datetime.now(UTC)
    session.add(note)
    session.commit()
    session.refresh(note)

    logger.info(f"Updated project note for project {project_id}")
    return ContextNoteResponse.model_validate(note)


# Goal Notes
@router.get(
    "/goals/{goal_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_goal_note(
    goal_id: UUID,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Get or create a note for a goal"""
    verify_goal_ownership(session, goal_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, goal_id=goal_id)
    return ContextNoteResponse.model_validate(note)


@router.put(
    "/goals/{goal_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def update_goal_note(
    goal_id: UUID,
    note_data: ContextNoteUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Update a goal's note (creates if doesn't exist)"""
    verify_goal_ownership(session, goal_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, goal_id=goal_id)

    # Update fields
    update_data = note_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(note, field, value)

    note.updated_at = datetime.now(UTC)
    session.add(note)
    session.commit()
    session.refresh(note)

    logger.info(f"Updated goal note for goal {goal_id}")
    return ContextNoteResponse.model_validate(note)


# Task Notes
@router.get(
    "/tasks/{task_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_task_note(
    task_id: UUID,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Get or create a note for a task"""
    verify_task_ownership(session, task_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, task_id=task_id)
    return ContextNoteResponse.model_validate(note)


@router.put(
    "/tasks/{task_id}",
    response_model=ContextNoteResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def update_task_note(
    task_id: UUID,
    note_data: ContextNoteUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteResponse:
    """Update a task's note (creates if doesn't exist)"""
    verify_task_ownership(session, task_id, current_user.user_id)
    note = get_or_create_note(session, current_user.user_id, task_id=task_id)

    # Update fields
    update_data = note_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(note, field, value)

    note.updated_at = datetime.now(UTC)
    session.add(note)
    session.commit()
    session.refresh(note)

    logger.info(f"Updated task note for task {task_id}")
    return ContextNoteResponse.model_validate(note)
