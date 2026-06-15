"""
Tests for batched log retrieval semantics.
"""

from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import LogCreate, TaskCreate
from humancompiler_api.services import LogService, TaskService


def test_get_logs_batch_applies_limit_per_task(session: Session, test_user_id: str):
    """A noisy task must not starve quieter tasks in batch results."""
    test_data = create_test_data(session, test_user_id)
    task_service = TaskService()
    log_service = LogService()

    noisy_task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Noisy task",
            estimate_hours=1.0,
            status="pending",
            priority=1,
        ),
        test_user_id,
    )
    quiet_task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Quiet task",
            estimate_hours=1.0,
            status="pending",
            priority=1,
        ),
        test_user_id,
    )

    base_time = datetime(2026, 1, 1, tzinfo=UTC)
    for index in range(3):
        log = log_service.create_log(
            session,
            LogCreate(
                task_id=noisy_task.id,
                actual_minutes=10 + index,
                comment=f"noisy-{index}",
            ),
            test_user_id,
        )
        log.created_at = base_time + timedelta(minutes=10 + index)

    quiet_log = log_service.create_log(
        session,
        LogCreate(task_id=quiet_task.id, actual_minutes=60, comment="quiet"),
        test_user_id,
    )
    quiet_log.created_at = base_time
    session.flush()

    result = log_service.get_logs_batch(
        session,
        [noisy_task.id, quiet_task.id],
        test_user_id,
        skip=0,
        limit=2,
    )

    assert [log.comment for log in result[str(noisy_task.id)]] == [
        "noisy-2",
        "noisy-1",
    ]
    assert [log.comment for log in result[str(quiet_task.id)]] == ["quiet"]


def test_get_logs_batch_applies_skip_per_task(session: Session, test_user_id: str):
    """Pagination offset is applied independently for every requested task."""
    test_data = create_test_data(session, test_user_id)
    task_service = TaskService()
    log_service = LogService()

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Paged task",
            estimate_hours=1.0,
            status="pending",
            priority=1,
        ),
        test_user_id,
    )

    base_time = datetime(2026, 1, 1, tzinfo=UTC)
    for index in range(3):
        log = log_service.create_log(
            session,
            LogCreate(
                task_id=task.id,
                actual_minutes=10 + index,
                comment=f"log-{index}",
            ),
            test_user_id,
        )
        log.created_at = base_time + timedelta(minutes=index)
    session.flush()

    result = log_service.get_logs_batch(
        session,
        [task.id],
        test_user_id,
        skip=1,
        limit=1,
    )

    assert [log.comment for log in result[str(task.id)]] == ["log-1"]
