"""
Context Notes API router for rich text notes on projects, goals, and tasks
"""

import logging
from collections.abc import Generator
from datetime import datetime, UTC
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, and_, col, func, select

from humancompiler_api import proposal_service
from humancompiler_api.agent_write_service import check_expected_updated_at
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ContextNote,
    ContextNoteUpdate,
    ContextNoteWithLogResponse,
    ErrorResponse,
    NoteLogSummary,
    NoteSection,
    Project,
    Goal,
    Task,
)
from humancompiler_api.note_markdown_out import note_html_to_markdown
from humancompiler_api.proposal_payloads import NoteTarget

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])

# Which of the item's two notes a request is about; the overview when left out.
SectionQuery = Annotated[
    NoteSection,
    Query(description="The item's overview (default) or its log."),
]


class TaskNoteMarkdownResponse(BaseModel):
    """A task's title and its note as Markdown, to paste into an AI chat."""

    title: str
    markdown: str


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
    """Verify that the user owns the goal (via project) using a single JOIN query"""
    result = session.exec(
        select(Goal)
        .join(Project, Goal.project_id == Project.id)
        .where(and_(Goal.id == goal_id, Project.owner_id == UUID(user_id)))
    ).first()
    if not result:
        # Determine whether goal doesn't exist or user lacks access
        goal_exists = session.get(Goal, goal_id)
        if not goal_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this goal",
        )
    return result


def verify_task_ownership(session: Session, task_id: UUID, user_id: str) -> Task:
    """Verify that the user owns the task (via goal/project) using a single JOIN query"""
    result = session.exec(
        select(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(and_(Task.id == task_id, Project.owner_id == UUID(user_id)))
    ).first()
    if not result:
        # Determine whether task doesn't exist or user lacks access
        task_exists = session.get(Task, task_id)
        if not task_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this task",
        )
    return result


def get_or_create_note(
    session: Session,
    user_id: str,
    project_id: UUID | None = None,
    goal_id: UUID | None = None,
    task_id: UUID | None = None,
    section: NoteSection = NoteSection.OVERVIEW,
) -> ContextNote:
    """Get the item's existing note of ``section`` or create a new one.

    Handles concurrent creation race conditions by catching IntegrityError
    and retrying the select query.
    """
    # Build query based on entity type
    query = select(ContextNote).where(ContextNote.section == section.value)

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
            section=section.value,
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


def update_note(
    session: Session,
    user_id: str,
    target: NoteTarget,
    note_data: ContextNoteUpdate,
    section: NoteSection = NoteSection.OVERVIEW,
) -> ContextNote:
    """Write the editor's fields to the target's note of ``section`` (created
    if missing).

    The note row is locked (a no-op on SQLite) before ``expected_updated_at`` is
    compared, so an agent write cannot land between the check and the save. A
    mismatch gives 409 ``{message, current_updated_at}`` and writes nothing;
    without ``expected_updated_at`` the note is overwritten, as before."""
    get_or_create_note(
        session,
        user_id,
        project_id=target.project_id,
        goal_id=target.goal_id,
        task_id=target.task_id,
        section=section,
    )
    try:
        note = proposal_service.lock_note(session, target, section)
        if note is None or note.updated_at is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create or retrieve note",
            )
        if note_data.expected_updated_at is not None:
            check_expected_updated_at(note.updated_at, note_data.expected_updated_at)

        update_data = note_data.model_dump(
            exclude_unset=True, exclude={"expected_updated_at"}
        )
        for field, value in update_data.items():
            setattr(note, field, value)

        note.updated_at = datetime.now(UTC)
        session.add(note)
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(note)
    return note


def note_response(session: Session, note: ContextNote) -> ContextNoteWithLogResponse:
    """The note as the web reads it: an overview says whether its item has a
    log with text, so the page can show that without loading the log."""
    response = ContextNoteWithLogResponse.model_validate(note)
    if note.section != NoteSection.OVERVIEW:
        return response
    query = select(ContextNote.updated_at, func.length(ContextNote.content_text)).where(
        ContextNote.section == NoteSection.LOG.value,
        col(ContextNote.content_text) != "",
    )
    if note.project_id is not None:
        query = query.where(ContextNote.project_id == note.project_id)
    elif note.goal_id is not None:
        query = query.where(ContextNote.goal_id == note.goal_id)
    else:
        query = query.where(ContextNote.task_id == note.task_id)
    row = session.exec(query).first()
    if row is not None and row[0] is not None:
        response.log = NoteLogSummary(updated_at=row[0], characters=row[1])
    return response


# Project Notes
@router.get(
    "/projects/{project_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_project_note(
    project_id: UUID,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Get or create a project's overview, or its log with ``section=log``"""
    verify_project_ownership(session, project_id, current_user.user_id)
    note = get_or_create_note(
        session, current_user.user_id, project_id=project_id, section=section
    )
    return note_response(session, note)


@router.put(
    "/projects/{project_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
        409: {"description": "The note changed since expected_updated_at"},
    },
)
async def update_project_note(
    project_id: UUID,
    note_data: ContextNoteUpdate,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Update a project's overview, or its log with ``section=log`` (creates if
    doesn't exist)"""
    verify_project_ownership(session, project_id, current_user.user_id)
    note = update_note(
        session,
        current_user.user_id,
        NoteTarget(project_id=project_id),
        note_data,
        section,
    )

    logger.info(f"Updated project {section.value} note for project {project_id}")
    return note_response(session, note)


# Goal Notes
@router.get(
    "/goals/{goal_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_goal_note(
    goal_id: UUID,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Get or create a goal's overview, or its log with ``section=log``"""
    verify_goal_ownership(session, goal_id, current_user.user_id)
    note = get_or_create_note(
        session, current_user.user_id, goal_id=goal_id, section=section
    )
    return note_response(session, note)


@router.put(
    "/goals/{goal_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
        409: {"description": "The note changed since expected_updated_at"},
    },
)
async def update_goal_note(
    goal_id: UUID,
    note_data: ContextNoteUpdate,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Update a goal's overview, or its log with ``section=log`` (creates if
    doesn't exist)"""
    verify_goal_ownership(session, goal_id, current_user.user_id)
    note = update_note(
        session,
        current_user.user_id,
        NoteTarget(goal_id=goal_id),
        note_data,
        section,
    )

    logger.info(f"Updated goal {section.value} note for goal {goal_id}")
    return note_response(session, note)


# Task Notes
@router.get(
    "/tasks/{task_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_task_note(
    task_id: UUID,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Get or create a task's overview, or its log with ``section=log``"""
    verify_task_ownership(session, task_id, current_user.user_id)
    note = get_or_create_note(
        session, current_user.user_id, task_id=task_id, section=section
    )
    return note_response(session, note)


@router.put(
    "/tasks/{task_id}",
    response_model=ContextNoteWithLogResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
        409: {"description": "The note changed since expected_updated_at"},
    },
)
async def update_task_note(
    task_id: UUID,
    note_data: ContextNoteUpdate,
    section: SectionQuery = NoteSection.OVERVIEW,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> ContextNoteWithLogResponse:
    """Update a task's overview, or its log with ``section=log`` (creates if
    doesn't exist)"""
    verify_task_ownership(session, task_id, current_user.user_id)
    note = update_note(
        session,
        current_user.user_id,
        NoteTarget(task_id=task_id),
        note_data,
        section,
    )

    logger.info(f"Updated task {section.value} note for task {task_id}")
    return note_response(session, note)


@router.get(
    "/tasks/{task_id}/markdown",
    response_model=TaskNoteMarkdownResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        403: {"model": ErrorResponse, "description": "Not authorized"},
    },
)
async def get_task_note_markdown(
    task_id: UUID,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> TaskNoteMarkdownResponse:
    """The task's overview as Markdown, the way agents read it.

    A task's overview is its body and often holds the prompt for an AI
    assistant; this is the text the web copies to the clipboard. The task's log
    is not part of it. A task without a note gives an empty string, and reading
    does not create the note."""
    task = verify_task_ownership(session, task_id, current_user.user_id)
    note = session.exec(
        select(ContextNote).where(
            ContextNote.task_id == task_id,
            ContextNote.section == NoteSection.OVERVIEW.value,
        )
    ).first()
    content = note.content if note is not None else ""
    markdown = (
        note_html_to_markdown(content)
        if note is not None and note.content_type == "html"
        else content.strip()
    )
    return TaskNoteMarkdownResponse(title=task.title, markdown=markdown)
