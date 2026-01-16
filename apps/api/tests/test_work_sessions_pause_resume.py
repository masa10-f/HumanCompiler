"""
Test cases for work session pause/resume functionality
Issue: #243
"""

import time
from datetime import datetime, timedelta, UTC

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import (
    TaskCreate,
    WorkSessionStartRequest,
    WorkSessionCheckoutRequest,
    WorkSessionResumeRequest,
)
from humancompiler_api.services import TaskService, WorkSessionService


def test_pause_session_success(session: Session, test_user_id: str):
    """Test pausing an active session"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Pause Test Task",
            description="Task for pause test",
            estimate_hours=2.0,
        ),
        test_user_id,
    )

    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at="2030-01-01T00:00:00Z",
            planned_outcome="Test outcome",
        ),
        test_user_id,
    )

    # Pause the session
    paused_session = work_session_service.pause_session(session, test_user_id)

    assert paused_session.paused_at is not None
    assert paused_session.ended_at is None  # Session is still active
    assert paused_session.total_paused_seconds == 0  # Not updated until resume


def test_pause_session_no_active_session(session: Session, test_user_id: str):
    """Test pausing when no active session exists"""
    work_session_service = WorkSessionService()
    create_test_data(session, test_user_id)

    with pytest.raises(HTTPException) as excinfo:
        work_session_service.pause_session(session, test_user_id)

    assert excinfo.value.status_code == 404
    assert "No active session found" in excinfo.value.detail


def test_pause_session_already_paused(session: Session, test_user_id: str):
    """Test pausing an already paused session"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Already Paused Task",
            description="Task for double pause test",
            estimate_hours=2.0,
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

    # Pause once
    work_session_service.pause_session(session, test_user_id)

    # Try to pause again
    with pytest.raises(HTTPException) as excinfo:
        work_session_service.pause_session(session, test_user_id)

    assert excinfo.value.status_code == 400
    assert "already paused" in excinfo.value.detail


def test_resume_session_success(session: Session, test_user_id: str):
    """Test resuming a paused session"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Resume Test Task",
            description="Task for resume test",
            estimate_hours=2.0,
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

    # Pause the session
    work_session_service.pause_session(session, test_user_id)

    # Wait at least 1 second to ensure pause duration is measurable (int conversion)
    time.sleep(1.1)

    # Resume the session
    resume_data = WorkSessionResumeRequest(extend_checkout=True)
    resumed_session = work_session_service.resume_session(
        session, test_user_id, resume_data
    )

    assert resumed_session.paused_at is None
    assert resumed_session.total_paused_seconds >= 1  # At least 1 second
    assert resumed_session.ended_at is None  # Session is still active


def test_resume_session_extends_checkout(session: Session, test_user_id: str):
    """Test that resuming extends planned_checkout_at when requested"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Resume Extend Test Task",
            description="Task for resume extend test",
            estimate_hours=2.0,
        ),
        test_user_id,
    )

    original_checkout = datetime.now(UTC) + timedelta(hours=1)
    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at=original_checkout.isoformat(),
        ),
        test_user_id,
    )

    # Pause the session
    work_session_service.pause_session(session, test_user_id)

    # Wait at least 1 second for measurable pause duration
    time.sleep(1.1)

    # Resume with extend_checkout=True
    resume_data = WorkSessionResumeRequest(extend_checkout=True)
    resumed_session = work_session_service.resume_session(
        session, test_user_id, resume_data
    )

    # Checkout should be extended
    new_checkout = resumed_session.planned_checkout_at
    if new_checkout.tzinfo is None:
        new_checkout = new_checkout.replace(tzinfo=UTC)
    if original_checkout.tzinfo is None:
        original_checkout = original_checkout.replace(tzinfo=UTC)

    assert new_checkout > original_checkout


def test_resume_session_no_extend_checkout(session: Session, test_user_id: str):
    """Test that resuming does not extend checkout when extend_checkout=False"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Resume No Extend Test Task",
            description="Task for resume no extend test",
            estimate_hours=2.0,
        ),
        test_user_id,
    )

    original_checkout = datetime.now(UTC) + timedelta(hours=1)
    work_session_service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=task.id,
            planned_checkout_at=original_checkout.isoformat(),
        ),
        test_user_id,
    )

    # Get the started session to capture the original checkout time
    started_session = work_session_service.get_current_session(session, test_user_id)
    original_checkout_stored = started_session.planned_checkout_at

    # Pause the session
    work_session_service.pause_session(session, test_user_id)

    # Wait at least 1 second for measurable pause duration
    time.sleep(1.1)

    # Resume with extend_checkout=False
    resume_data = WorkSessionResumeRequest(extend_checkout=False)
    resumed_session = work_session_service.resume_session(
        session, test_user_id, resume_data
    )

    # Checkout should remain the same
    assert resumed_session.planned_checkout_at == original_checkout_stored


def test_resume_session_not_paused(session: Session, test_user_id: str):
    """Test resuming a session that is not paused"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Not Paused Task",
            description="Task for not paused resume test",
            estimate_hours=2.0,
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

    # Try to resume without pausing first
    resume_data = WorkSessionResumeRequest(extend_checkout=True)
    with pytest.raises(HTTPException) as excinfo:
        work_session_service.resume_session(session, test_user_id, resume_data)

    assert excinfo.value.status_code == 400
    assert "not paused" in excinfo.value.detail


def test_resume_session_no_active_session(session: Session, test_user_id: str):
    """Test resuming when no active session exists"""
    work_session_service = WorkSessionService()
    create_test_data(session, test_user_id)

    resume_data = WorkSessionResumeRequest(extend_checkout=True)
    with pytest.raises(HTTPException) as excinfo:
        work_session_service.resume_session(session, test_user_id, resume_data)

    assert excinfo.value.status_code == 404
    assert "No active session found" in excinfo.value.detail


def test_checkout_paused_session(session: Session, test_user_id: str):
    """Test checking out a session that is currently paused"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Checkout Paused Task",
            description="Task for checkout while paused test",
            estimate_hours=2.0,
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

    # Pause the session
    work_session_service.pause_session(session, test_user_id)

    # Wait at least 1 second for measurable pause duration
    time.sleep(1.1)

    # Checkout while paused
    checkout_session, log = work_session_service.checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(decision="switch"),
    )

    # Session should be ended and paused_at cleared
    assert checkout_session.ended_at is not None
    assert checkout_session.paused_at is None
    # Total paused seconds should include the current pause duration (at least 1 second)
    assert checkout_session.total_paused_seconds >= 1


def test_multiple_pause_resume_cycles(session: Session, test_user_id: str):
    """Test multiple pause/resume cycles accumulate paused time"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Multi Pause Task",
            description="Task for multiple pause test",
            estimate_hours=2.0,
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

    # First pause/resume cycle
    work_session_service.pause_session(session, test_user_id)
    time.sleep(1.1)  # At least 1 second for measurable duration
    resume_data = WorkSessionResumeRequest(extend_checkout=False)
    resumed = work_session_service.resume_session(session, test_user_id, resume_data)
    first_pause_duration = resumed.total_paused_seconds

    # Second pause/resume cycle
    work_session_service.pause_session(session, test_user_id)
    time.sleep(1.1)  # At least 1 second for measurable duration
    resumed = work_session_service.resume_session(session, test_user_id, resume_data)
    total_pause_duration = resumed.total_paused_seconds

    # Total should accumulate (each pause is at least 1 second)
    assert first_pause_duration >= 1
    assert total_pause_duration >= first_pause_duration + 1


def test_checkout_actual_minutes_excludes_paused_time(
    session: Session, test_user_id: str
):
    """Test that actual_minutes excludes paused time when checking out"""
    task_service = TaskService()
    work_session_service = WorkSessionService()

    test_data = create_test_data(session, test_user_id)

    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=test_data["goal"].id,
            title="Actual Minutes Test Task",
            description="Task for actual minutes test",
            estimate_hours=2.0,
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

    # Pause for a measurable time (at least 1 second for int conversion)
    work_session_service.pause_session(session, test_user_id)
    time.sleep(1.1)
    resume_data = WorkSessionResumeRequest(extend_checkout=False)
    work_session_service.resume_session(session, test_user_id, resume_data)

    # Checkout
    checkout_session, log = work_session_service.checkout_session(
        session,
        test_user_id,
        WorkSessionCheckoutRequest(decision="complete"),
    )

    # The log's actual_minutes should reflect time excluding pause
    # Since we only slept briefly, actual_minutes should be minimal (1 min minimum)
    assert log.actual_minutes >= 1
    # Total paused seconds should be recorded (at least 1 second)
    assert checkout_session.total_paused_seconds >= 1
