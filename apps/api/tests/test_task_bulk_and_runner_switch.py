from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from conftest import create_test_data
from humancompiler_api.models import (
    Schedule,
    SwitchDisposition,
    TaskCreate,
    TaskStatus,
    WeeklySchedule,
    WorkSessionStartRequest,
    WorkSessionSwitchRequest,
)
from humancompiler_api.routers.tasks import (
    BulkTaskApplyRequest,
    BulkTaskMutation,
    BulkTaskPatch,
    BulkTaskRequest,
    PlanMembershipMutation,
    NaturalLanguageBulkRequest,
    _preview_bulk,
    _sanitize_ai_bulk_mutations,
    apply_bulk_task_changes,
    preview_natural_language_bulk_changes,
)
from humancompiler_api.routers.weekly_schedule import (
    WeeklyScheduleDraftUpdate,
    update_weekly_schedule_draft,
)
from humancompiler_api.auth import AuthUser
from humancompiler_api.services import TaskService, WorkSessionService
from sqlmodel import select
from pydantic import ValidationError


def _auth(user_id):
    return AuthUser(user_id=user_id, email="test@example.com")


@pytest.mark.asyncio
async def test_bulk_preview_and_apply_updates_task_and_plan_membership(
    session, test_user_id
):
    data = create_test_data(session, test_user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Bulk task",
            estimate_hours=Decimal("2.5"),
        ),
        test_user_id,
    )
    request = BulkTaskRequest(
        mutations=[
            BulkTaskMutation(
                task_id=task.id,
                patch=BulkTaskPatch(priority=1, status=TaskStatus.IN_PROGRESS),
                plans=[
                    PlanMembershipMutation(
                        scope="daily", action="add", target_date="2030-01-02"
                    ),
                    PlanMembershipMutation(
                        scope="weekly", action="add", target_date="2029-12-31"
                    ),
                ],
            )
        ]
    )
    preview = _preview_bulk(session, test_user_id, request)
    assert preview.affected_count == 1
    assert {diff.field for diff in preview.items[0].diffs} == {
        "priority",
        "status",
        "plan:daily:2030-01-02",
        "plan:weekly:2029-12-31",
    }

    applied = await apply_bulk_task_changes(
        BulkTaskApplyRequest(
            mutations=request.mutations,
            expected_task_versions=preview.expected_task_versions,
            expected_plan_versions=preview.expected_plan_versions,
        ),
        session,
        _auth(test_user_id),
    )
    assert applied.affected_count == 1
    session.refresh(task)
    assert task.priority == 1
    assert task.status == TaskStatus.IN_PROGRESS
    daily = session.exec(select(Schedule)).one()
    weekly = session.exec(select(WeeklySchedule)).one()
    assert str(task.id) in daily.plan_json["planned_task_ids"]
    assert weekly.schedule_json["selected_tasks"][0]["task_id"] == str(task.id)


@pytest.mark.asyncio
async def test_bulk_apply_rejects_stale_task_version(session, test_user_id):
    data = create_test_data(session, test_user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Concurrent task",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    request = BulkTaskRequest(
        mutations=[BulkTaskMutation(task_id=task.id, patch=BulkTaskPatch(priority=2))]
    )
    preview = _preview_bulk(session, test_user_id, request)
    task.updated_at = datetime.now(UTC) + timedelta(seconds=1)
    session.add(task)
    session.commit()

    with pytest.raises(HTTPException) as error:
        await apply_bulk_task_changes(
            BulkTaskApplyRequest(
                mutations=request.mutations,
                expected_task_versions=preview.expected_task_versions,
                expected_plan_versions=preview.expected_plan_versions,
            ),
            session,
            _auth(test_user_id),
        )
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    ("disposition", "expected_status"),
    [
        (SwitchDisposition.COMPLETE, TaskStatus.COMPLETED),
        (SwitchDisposition.PAUSE, TaskStatus.IN_PROGRESS),
        (SwitchDisposition.DEFER, TaskStatus.PENDING),
    ],
)
def test_runner_switch_is_atomic_and_saves_resume_context(
    session, test_user_id, disposition, expected_status
):
    data = create_test_data(session, test_user_id)
    tasks = TaskService()
    current_task = tasks.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Current",
            estimate_hours=Decimal("2"),
        ),
        test_user_id,
    )
    next_task = tasks.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Next",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    service = WorkSessionService()
    service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=current_task.id,
            planned_checkout_at=datetime.now(UTC) + timedelta(hours=1),
        ),
        test_user_id,
    )
    note = None if disposition == SwitchDisposition.COMPLETE else "ここから再開"
    previous, current, log = service.switch_session(
        session,
        test_user_id,
        WorkSessionSwitchRequest(
            next_task_id=next_task.id,
            disposition=disposition,
            interruption_note=note,
            planned_checkout_at=datetime.now(UTC) + timedelta(hours=1),
        ),
    )
    session.refresh(current_task)
    assert current_task.status == expected_status
    assert previous.ended_at is not None
    assert current.task_id == next_task.id
    assert log.task_id == current_task.id
    if note:
        context = service.get_resume_context(session, test_user_id, current_task.id)
        assert context is not None
        assert context.interruption_note == note
        assert context.remaining_estimate_hours is not None


def test_bulk_request_rejects_more_than_one_hundred_items():
    mutation = {
        "task_id": "12345678-1234-1234-1234-123456789012",
        "patch": {"priority": 1},
    }
    with pytest.raises(ValidationError):
        BulkTaskRequest.model_validate({"mutations": [mutation] * 101})


def test_ai_sanitizer_discards_out_of_scope_ids_and_invalid_fields():
    task_id = uuid4()
    goal_id = uuid4()
    mutations, warnings = _sanitize_ai_bulk_mutations(
        {
            "mutations": [
                {
                    "task_id": str(task_id),
                    "patch": {
                        "priority": 2,
                        "status": "not-a-status",
                        "goal_id": str(uuid4()),
                        "title": "must not change",
                    },
                    "plans": [
                        {
                            "scope": "daily",
                            "action": "add",
                            "target_date": "2030-01-02",
                        },
                        {"scope": "daily", "action": "add", "target_date": "bad"},
                    ],
                },
                {"task_id": str(uuid4()), "patch": {"priority": 1}},
            ]
        },
        {task_id},
        {goal_id},
    )
    assert len(mutations) == 1
    assert mutations[0].patch.priority == 2
    assert mutations[0].patch.status is None
    assert mutations[0].patch.goal_id is None
    assert len(mutations[0].plans) == 1
    assert len(warnings) >= 4


@pytest.mark.asyncio
async def test_natural_language_preview_without_api_key_does_not_write(
    session, test_user_id
):
    data = create_test_data(session, test_user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="AI preview only",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    original_updated_at = task.updated_at
    with pytest.raises(HTTPException) as error:
        await preview_natural_language_bulk_changes(
            NaturalLanguageBulkRequest(
                instruction="優先度を上げる", task_ids=[task.id]
            ),
            session,
            _auth(test_user_id),
        )
    assert error.value.status_code == 503
    session.refresh(task)
    assert task.priority == 3
    assert task.updated_at == original_updated_at


def test_runner_rejects_completed_target_without_ending_current_session(
    session, test_user_id
):
    data = create_test_data(session, test_user_id)
    tasks = TaskService()
    current_task = tasks.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Current atomic",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    completed_task = tasks.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Completed target",
            estimate_hours=Decimal("1"),
            status=TaskStatus.COMPLETED,
        ),
        test_user_id,
    )
    service = WorkSessionService()
    active = service.start_session(
        session,
        WorkSessionStartRequest(
            task_id=current_task.id,
            planned_checkout_at=datetime.now(UTC) + timedelta(hours=1),
        ),
        test_user_id,
    )
    with pytest.raises(HTTPException) as error:
        service.switch_session(
            session,
            test_user_id,
            WorkSessionSwitchRequest(
                next_task_id=completed_task.id,
                disposition=SwitchDisposition.COMPLETE,
                planned_checkout_at=datetime.now(UTC) + timedelta(hours=1),
            ),
        )
    assert error.value.status_code == 409
    session.refresh(active)
    assert active.ended_at is None


@pytest.mark.asyncio
async def test_daily_remove_deletes_assignment_and_recalculates_total(
    session, test_user_id
):
    data = create_test_data(session, test_user_id)
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Placed today",
            estimate_hours=Decimal("2"),
        ),
        test_user_id,
    )
    plan = Schedule(
        id=uuid4(),
        user_id=test_user_id,
        date=datetime(2030, 1, 2),
        plan_json={
            "unknown": "preserve",
            "planned_task_ids": [str(task.id)],
            "assignments": [
                {"task_id": str(task.id), "duration_hours": 1.5},
                {"task_id": str(uuid4()), "duration_hours": 0.5},
            ],
            "total_scheduled_hours": 2,
        },
    )
    session.add(plan)
    session.commit()
    request = BulkTaskRequest(
        mutations=[
            BulkTaskMutation(
                task_id=task.id,
                plans=[
                    PlanMembershipMutation(
                        scope="daily", action="remove", target_date="2030-01-02"
                    )
                ],
            )
        ]
    )
    preview = _preview_bulk(session, test_user_id, request)
    await apply_bulk_task_changes(
        BulkTaskApplyRequest(
            mutations=request.mutations,
            expected_task_versions=preview.expected_task_versions,
            expected_plan_versions=preview.expected_plan_versions,
        ),
        session,
        _auth(test_user_id),
    )
    session.refresh(plan)
    assert plan.plan_json["unknown"] == "preserve"
    assert str(task.id) not in plan.plan_json["planned_task_ids"]
    assert len(plan.plan_json["assignments"]) == 1
    assert plan.plan_json["total_scheduled_hours"] == 0.5


@pytest.mark.asyncio
async def test_weekly_draft_preserves_unknown_fields_and_rejects_stale_version(
    session, test_user_id
):
    create_test_data(session, test_user_id)
    schedule = WeeklySchedule(
        id=uuid4(),
        user_id=test_user_id,
        week_start_date=datetime(2030, 1, 7),
        schedule_json={"selected_task_ids": [], "legacy_unknown": {"keep": True}},
    )
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    old_version = schedule.updated_at
    saved = await update_weekly_schedule_draft(
        "2030-01-07",
        WeeklyScheduleDraftUpdate(
            schedule_data={"selected_tasks": [], "capacity_hours": 20},
            expected_updated_at=old_version,
        ),
        str(test_user_id),
        session,
    )
    assert saved.schedule_json["legacy_unknown"] == {"keep": True}
    assert saved.schedule_json["capacity_hours"] == 20

    with pytest.raises(HTTPException) as error:
        await update_weekly_schedule_draft(
            "2030-01-07",
            WeeklyScheduleDraftUpdate(
                schedule_data={"capacity_hours": 30},
                expected_updated_at=old_version,
            ),
            str(test_user_id),
            session,
        )
    assert error.value.status_code == 409
