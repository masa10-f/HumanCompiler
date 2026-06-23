from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from humancompiler_api.models import (
    Goal,
    Project,
    QuickTask,
    Task,
    TaskStatus,
    TaskTriageRun,
    TriageCapacitySettingsUpdate,
    TriageRecommendation,
    User,
    WorkType,
)
from humancompiler_api.triage.service import (
    AiAdjustment,
    TriageService,
    triage_service,
)


@pytest.fixture
def triage_user(session: Session):
    user = User(id=uuid4(), email="triage@example.com")
    session.add(user)

    project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="Main Project",
        description=None,
    )
    other_project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="Other Project",
        description=None,
    )
    session.add(project)
    session.add(other_project)

    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Main Goal",
        description=None,
        estimate_hours=Decimal("10.00"),
    )
    other_goal = Goal(
        id=uuid4(),
        project_id=other_project.id,
        title="Other Goal",
        description=None,
        estimate_hours=Decimal("10.00"),
    )
    session.add(goal)
    session.add(other_goal)
    session.commit()

    return {
        "user": user,
        "project": project,
        "other_project": other_project,
        "goal": goal,
        "other_goal": other_goal,
    }


def add_task(
    session: Session,
    goal_id,
    title: str,
    estimate_hours: str,
    priority: int,
    status: TaskStatus = TaskStatus.PENDING,
):
    task = Task(
        id=uuid4(),
        goal_id=goal_id,
        title=title,
        description=None,
        estimate_hours=Decimal(estimate_hours),
        due_date=datetime.now(UTC) + timedelta(days=10),
        status=status,
        work_type=WorkType.FOCUSED_WORK,
        priority=priority,
    )
    session.add(task)
    session.commit()
    return task


def add_quick_task(
    session: Session,
    user_id,
    title: str,
    estimate_hours: str,
    priority: int,
):
    task = QuickTask(
        id=uuid4(),
        owner_id=user_id,
        title=title,
        description=None,
        estimate_hours=Decimal(estimate_hours),
        due_date=None,
        status=TaskStatus.PENDING,
        work_type=WorkType.LIGHT_WORK,
        priority=priority,
    )
    session.add(task)
    session.commit()
    return task


def save_settings(session: Session, user_id, project_allocations, inbox=0, capacity=10):
    return triage_service.update_settings(
        session,
        user_id,
        TriageCapacitySettingsUpdate(
            weekly_capacity_hours=Decimal(str(capacity)),
            meeting_buffer_hours=Decimal("0.00"),
            project_allocations={str(k): v for k, v in project_allocations.items()},
            inbox_allocation_percent=inbox,
            work_type_caps={},
            cadence_days=7,
            auto_generate_enabled=False,
            use_ai_rank_adjustment=False,
        ),
    )


def test_capacity_selection_recommends_overflow_cancel(session: Session, triage_user):
    user = triage_user["user"]
    project = triage_user["project"]
    other_project = triage_user["other_project"]
    goal = triage_user["goal"]
    other_goal = triage_user["other_goal"]

    keep_task = add_task(session, goal.id, "Keep me", "4.00", priority=1)
    cancel_task = add_task(session, goal.id, "Overflow", "4.00", priority=5)
    other_task = add_task(session, other_goal.id, "Other", "4.00", priority=2)
    quick_task = add_quick_task(session, user.id, "Inbox overflow", "2.00", priority=1)
    save_settings(
        session,
        user.id,
        {project.id: 50, other_project.id: 50},
        inbox=0,
        capacity=10,
    )

    run = triage_service.create_run(session, user.id)
    recommendations = {
        item.task_id or item.quick_task_id: item.recommendation for item in run.items
    }

    assert recommendations[keep_task.id] == TriageRecommendation.KEEP
    assert recommendations[cancel_task.id] == TriageRecommendation.CANCEL
    assert recommendations[other_task.id] == TriageRecommendation.KEEP
    assert recommendations[quick_task.id] == TriageRecommendation.CANCEL
    assert run.summary["cancel_candidate_items"] == 2


def test_triage_enums_persist_lowercase_values(session: Session, triage_user):
    user = triage_user["user"]
    project = triage_user["project"]
    goal = triage_user["goal"]
    add_task(session, goal.id, "Persisted enum task", "2.00", priority=1)
    save_settings(session, user.id, {project.id: 100}, capacity=4)

    run = triage_service.create_run(session, user.id)

    run_row = session.exec(
        text("SELECT source, status FROM task_triage_runs LIMIT 1")
    ).one()
    item_row = session.exec(
        text(
            "SELECT item_type, status_at_generation, work_type, recommendation, "
            "user_override, applied_action FROM task_triage_items LIMIT 1"
        )
    ).one()

    assert run_row == ("manual", "ready")
    assert item_row == ("task", "pending", "focused_work", "keep", None, None)
    assert run.source == "manual"
    assert run.status == "ready"


def test_ai_delta_is_clipped():
    service = TriageService()

    assert service._clip_ai_delta(Decimal("99")) == Decimal("15.00")
    assert service._clip_ai_delta(Decimal("-99")) == Decimal("-15.00")
    assert service._clip_ai_delta(Decimal("3.25")) == Decimal("3.25")


def test_ai_adjustment_can_change_capacity_order(session: Session, triage_user):
    user = triage_user["user"]
    project = triage_user["project"]
    goal = triage_user["goal"]
    first_task = add_task(session, goal.id, "Normally first", "4.00", priority=2)
    boosted_task = add_task(session, goal.id, "Boosted", "4.00", priority=3)
    save_settings(session, user.id, {project.id: 100}, capacity=4)

    settings = triage_service.get_or_create_settings(session, user.id)
    candidates = triage_service.collect_candidates(session, user.id)
    adjustments = {
        f"task:{boosted_task.id}": AiAdjustment(delta=Decimal("15.00"), reason="boost")
    }

    selected = triage_service._select_with_capacity(settings, candidates, adjustments)
    by_id = {
        candidate.task_id: recommendation for candidate, recommendation, *_ in selected
    }

    assert by_id[boosted_task.id] == TriageRecommendation.KEEP
    assert by_id[first_task.id] == TriageRecommendation.CANCEL


def test_apply_cancels_regular_and_quick_tasks(session: Session, triage_user):
    user = triage_user["user"]
    project = triage_user["project"]
    goal = triage_user["goal"]
    task = add_task(session, goal.id, "Regular", "4.00", priority=5)
    quick_task = add_quick_task(session, user.id, "Quick", "4.00", priority=5)
    save_settings(session, user.id, {project.id: 0}, inbox=100, capacity=4)

    run = triage_service.create_run(session, user.id)
    item_ids = [
        item.id
        for item in run.items
        if item.recommendation == TriageRecommendation.CANCEL
    ]
    result = triage_service.apply_run(session, user.id, run.id, item_ids)

    session.refresh(task)
    session.refresh(quick_task)
    assert result.applied_count == 1
    assert task.status == TaskStatus.CANCELLED
    assert quick_task.status == TaskStatus.PENDING


def test_settings_validation_requires_total_100(session: Session, triage_user):
    with pytest.raises(HTTPException):
        triage_service.update_settings(
            session,
            triage_user["user"].id,
            TriageCapacitySettingsUpdate(
                weekly_capacity_hours=Decimal("40.00"),
                meeting_buffer_hours=Decimal("5.00"),
                project_allocations={str(triage_user["project"].id): 50},
                inbox_allocation_percent=0,
                work_type_caps={},
                cadence_days=7,
                auto_generate_enabled=False,
                use_ai_rank_adjustment=False,
            ),
        )


def test_settings_normalizes_prefixed_project_allocation_keys(
    session: Session, triage_user
):
    user = triage_user["user"]
    project = triage_user["project"]

    response = triage_service.update_settings(
        session,
        user.id,
        TriageCapacitySettingsUpdate(
            weekly_capacity_hours=Decimal("40.00"),
            meeting_buffer_hours=Decimal("5.00"),
            project_allocations={f"project:{project.id}": 100},
            inbox_allocation_percent=0,
            work_type_caps={},
            cadence_days=7,
            auto_generate_enabled=False,
            use_ai_rank_adjustment=False,
        ),
    )

    settings = triage_service.get_or_create_settings(session, user.id)
    assert response.project_allocations[str(project.id)] == 100
    assert settings.project_allocations_json == {str(project.id): 100}


def test_scheduled_generation_creates_run_without_applying(
    session: Session, triage_user
):
    user = triage_user["user"]
    project = triage_user["project"]
    goal = triage_user["goal"]
    task = add_task(session, goal.id, "Scheduled overflow", "4.00", priority=5)
    triage_service.update_settings(
        session,
        user.id,
        TriageCapacitySettingsUpdate(
            weekly_capacity_hours=Decimal("2.00"),
            meeting_buffer_hours=Decimal("0.00"),
            project_allocations={str(project.id): 100},
            inbox_allocation_percent=0,
            work_type_caps={},
            cadence_days=7,
            auto_generate_enabled=True,
            use_ai_rank_adjustment=False,
        ),
    )

    generated = triage_service.generate_due_scheduled_runs(session)
    runs = session.exec(
        select(TaskTriageRun).where(TaskTriageRun.user_id == user.id)
    ).all()

    session.refresh(task)
    assert generated == 1
    assert len(runs) == 1
    assert task.status == TaskStatus.PENDING
