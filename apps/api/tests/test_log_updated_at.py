# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""
Tests for the updated_at timestamp on work logs.
"""

from datetime import UTC, datetime
from time import sleep

from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import LogCreate, LogResponse, LogUpdate, TaskCreate
from humancompiler_api.services import LogService, TaskService


def _create_log(session: Session, user_id: str):
    test_data = create_test_data(session, user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Logged task",
            estimate_hours=1.0,
            priority=1,
        ),
        user_id,
    )
    log_service = LogService()
    log = log_service.create_log(
        session, LogCreate(task_id=task.id, actual_minutes=30), user_id
    )
    return log_service, log


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def test_new_log_has_updated_at(session: Session, test_user_id: str):
    """A new log carries updated_at and exposes it in the response."""
    _, log = _create_log(session, test_user_id)

    assert log.updated_at is not None
    dumped = LogResponse.model_validate(log).model_dump(mode="json")
    assert "updated_at" in dumped
    assert datetime.fromisoformat(dumped["updated_at"]).tzinfo is not None


def test_editing_log_advances_updated_at(session: Session, test_user_id: str):
    """Editing a log moves updated_at forward."""
    log_service, log = _create_log(session, test_user_id)
    before = _as_utc(log.updated_at)

    sleep(0.01)
    updated = log_service.update_log(
        session, log.id, test_user_id, LogUpdate(comment="edited")
    )

    assert _as_utc(updated.updated_at) > before
