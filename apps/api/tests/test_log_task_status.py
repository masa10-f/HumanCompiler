# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""
Tests for task status transitions triggered by work log creation.
"""

import pytest
from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import (
    LogCreate,
    TaskCreate,
    TaskStatus,
    WorkSessionCheckoutRequest,
    WorkSessionStartRequest,
)
from humancompiler_api.services import LogService, TaskService, WorkSessionService


@pytest.mark.parametrize(
    ("initial_status", "expected_status"),
    [
        (TaskStatus.PENDING, TaskStatus.IN_PROGRESS),
        (TaskStatus.IN_PROGRESS, TaskStatus.IN_PROGRESS),
        (TaskStatus.COMPLETED, TaskStatus.COMPLETED),
        (TaskStatus.CANCELLED, TaskStatus.CANCELLED),
    ],
)
def test_create_log_starts_pending_task(
    session: Session,
    test_user_id: str,
    initial_status: TaskStatus,
    expected_status: TaskStatus,
):
    """Only pending tasks move to in_progress when work is logged."""
    test_data = create_test_data(session, test_user_id)
    task_service = TaskService()
    log_service = LogService()

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Logged task",
            estimate_hours=1.0,
            status=initial_status,
            priority=1,
        ),
        test_user_id,
    )

    log_service.create_log(
        session,
        LogCreate(task_id=task.id, actual_minutes=30, comment="worked"),
        test_user_id,
    )

    session.refresh(task)
    assert task.status == expected_status


def test_checkout_starts_pending_task(session: Session, test_user_id: str):
    """Checkout auto-creates a log, so a pending task moves to in_progress."""
    test_data = create_test_data(session, test_user_id)
    task_service = TaskService()
    work_session_service = WorkSessionService()

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Checkout task",
            estimate_hours=1.0,
            status=TaskStatus.PENDING,
            priority=1,
        ),
        test_user_id,
    )

    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at="2030-01-01T00:00:00Z",
        ),
        test_user_id,
    )
    work_session_service.checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(decision="switch"),
    )

    session.refresh(task)
    assert task.status == TaskStatus.IN_PROGRESS
