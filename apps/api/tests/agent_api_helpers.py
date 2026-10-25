# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Shared helpers for the agent read API tests."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    AgentScope,
    ContextNote,
    Goal,
    GoalStatus,
    Log,
    Project,
    ProjectStatus,
    QuickTask,
    Task,
    TaskStatus,
    User,
    WorkSession,
)
from humancompiler_api.services import agent_token_service

client = TestClient(app)


def use_session(session: Session) -> None:
    """Make the app use ``session``. Pop the override in an autouse fixture."""

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session


def seed_user(session: Session, user_id: UUID) -> UUID:
    session.add(User(id=user_id, email=f"agent-read-{user_id}@example.com"))
    session.commit()
    return user_id


def issue_token(
    session: Session,
    user_id: UUID,
    scopes: list[AgentScope],
    name: str = "agent",
) -> str:
    """Create an agent token and return its secret."""
    _, secret = agent_token_service.create_token(session, user_id, name, scopes)
    session.commit()
    return secret


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def seed_project(
    session: Session,
    owner_id: UUID,
    *,
    status: ProjectStatus = ProjectStatus.PENDING,
    updated_at: datetime | None = None,
) -> Project:
    stamp = updated_at or datetime.now(UTC)
    project = Project(
        id=uuid4(),
        owner_id=owner_id,
        title="Project",
        status=status,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def seed_goal(
    session: Session,
    project: Project,
    *,
    status: GoalStatus = GoalStatus.PENDING,
    updated_at: datetime | None = None,
) -> Goal:
    stamp = updated_at or datetime.now(UTC)
    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Goal",
        status=status,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(goal)
    session.commit()
    session.refresh(goal)
    return goal


def seed_task(
    session: Session,
    goal: Goal,
    *,
    status: TaskStatus = TaskStatus.PENDING,
    estimate_hours: Decimal = Decimal("1"),
    updated_at: datetime | None = None,
) -> Task:
    stamp = updated_at or datetime.now(UTC)
    task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Task",
        status=status,
        estimate_hours=estimate_hours,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def seed_quick_task(
    session: Session,
    owner_id: UUID,
    *,
    status: TaskStatus = TaskStatus.PENDING,
    updated_at: datetime | None = None,
) -> QuickTask:
    stamp = updated_at or datetime.now(UTC)
    quick_task = QuickTask(
        id=uuid4(),
        owner_id=owner_id,
        title="Quick task",
        status=status,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(quick_task)
    session.commit()
    session.refresh(quick_task)
    return quick_task


def seed_log(
    session: Session,
    task: Task,
    *,
    updated_at: datetime | None = None,
) -> Log:
    stamp = updated_at or datetime.now(UTC)
    log = Log(
        id=uuid4(),
        task_id=task.id,
        actual_minutes=30,
        comment="Worked on it",
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


def seed_work_session(
    session: Session,
    user_id: UUID,
    task: Task,
    *,
    updated_at: datetime | None = None,
) -> WorkSession:
    stamp = updated_at or datetime.now(UTC)
    work_session = WorkSession(
        id=uuid4(),
        user_id=user_id,
        task_id=task.id,
        planned_checkout_at=stamp,
        started_at=stamp,
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(work_session)
    session.commit()
    session.refresh(work_session)
    return work_session


def seed_note(
    session: Session,
    user_id: UUID,
    *,
    project: Project | None = None,
    goal: Goal | None = None,
    task: Task | None = None,
    updated_at: datetime | None = None,
) -> ContextNote:
    stamp = updated_at or datetime.now(UTC)
    note = ContextNote(
        id=uuid4(),
        user_id=user_id,
        project_id=project.id if project else None,
        goal_id=goal.id if goal else None,
        task_id=task.id if task else None,
        content="Note",
        created_at=stamp,
        updated_at=stamp,
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note
