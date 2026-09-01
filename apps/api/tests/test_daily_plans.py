# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Tests for document-oriented daily planning."""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from humancompiler_api.models import (
    Goal,
    GoalDependency,
    Log,
    Project,
    QuickTask,
    Schedule,
    Task,
    TaskDependency,
    User,
    WorkType,
)
from humancompiler_api.routers.daily_plans import (
    AvailabilityWindow,
    DailyPlanDocumentV1,
    DailyPlanUpdateRequest,
    DirectiveFilter,
    DirectiveWindow,
    ScheduleDirectiveBlock,
    TaskActionRequest,
    TaskRef,
    TimedLineBlock,
    apply_task_action,
    generate_daily_plan,
    get_daily_plan,
    update_daily_plan,
)


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as value:
            yield value
    finally:
        engine.dispose()


@pytest.fixture
def planning_data(session: Session):
    user = User(id=uuid4(), email="daily-plan@example.com")
    project = Project(id=uuid4(), owner_id=user.id, title="Research")
    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Paper",
        estimate_hours=Decimal("20"),
    )
    first = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Read paper",
        estimate_hours=Decimal("2"),
        priority=4,
        work_type=WorkType.FOCUSED_WORK,
    )
    second = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Fix figure",
        estimate_hours=Decimal("1"),
        priority=1,
        work_type=WorkType.FOCUSED_WORK,
    )
    quick = QuickTask(
        id=uuid4(),
        owner_id=user.id,
        title="Inbox",
        estimate_hours=Decimal("0.5"),
    )
    session.add_all([user, project, goal, first, second, quick])
    session.commit()
    return user, project, goal, first, second, quick


@pytest.mark.asyncio
async def test_blank_plan_and_revision_conflict(
    session: Session, planning_data
) -> None:
    user = planning_data[0]
    blank = await get_daily_plan("2030-01-02", str(user.id), session)
    assert blank.revision == 0
    assert blank.document.blocks == []

    saved = await update_daily_plan(
        "2030-01-02",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(),
        ),
        str(user.id),
        session,
    )
    assert saved.revision == 1

    updated = await update_daily_plan(
        "2030-01-02",
        DailyPlanUpdateRequest(
            expected_revision=1,
            document=DailyPlanDocumentV1(
                blocks=[
                    TimedLineBlock(
                        id="meeting",
                        start="10:00",
                        end="10:30",
                        title="Meeting",
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )
    assert updated.revision == 2
    assert [block.id for block in updated.document.blocks] == ["meeting"]

    with pytest.raises(HTTPException) as exc_info:
        await update_daily_plan(
            "2030-01-02",
            DailyPlanUpdateRequest(
                expected_revision=0,
                document=DailyPlanDocumentV1(),
            ),
            str(user.id),
            session,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_document_rejects_task_owned_by_another_user(
    session: Session, planning_data
) -> None:
    user = planning_data[0]
    other_user = User(id=uuid4(), email="other-daily-plan@example.com")
    other_project = Project(id=uuid4(), owner_id=other_user.id, title="Private")
    other_goal = Goal(
        id=uuid4(),
        project_id=other_project.id,
        title="Private goal",
        estimate_hours=Decimal("1"),
    )
    other_task = Task(
        id=uuid4(),
        goal_id=other_goal.id,
        title="Private task",
        estimate_hours=Decimal("1"),
    )
    session.add_all([other_user, other_project, other_goal, other_task])
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await update_daily_plan(
            "2030-01-02",
            DailyPlanUpdateRequest(
                expected_revision=0,
                document=DailyPlanDocumentV1(
                    blocks=[
                        ScheduleDirectiveBlock(
                            id="foreign-task",
                            mode="task",
                            task_ref=TaskRef(source="task", id=other_task.id),
                        )
                    ]
                ),
            ),
            str(user.id),
            session,
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_document_validates_only_referenced_task_ids(
    session: Session,
    planning_data,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data

    def fail_full_graph_load(*_args, **_kwargs):
        raise AssertionError("autosave must not load the full task graph")

    monkeypatch.setattr(
        "humancompiler_api.routers.daily_plans._load_owned_tasks",
        fail_full_graph_load,
    )

    saved = await update_daily_plan(
        "2030-01-06",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="specific",
                        mode="task",
                        task_ref=TaskRef(source="task", id=first.id),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    assert saved.revision == 1


@pytest.mark.asyncio
async def test_generate_resolves_specific_and_filtered_directives(
    session: Session, planning_data
) -> None:
    user, project, goal, first, _second, _quick = planning_data
    document = DailyPlanDocumentV1(
        availability_windows=[
            AvailabilityWindow(start="09:00", end="12:00", work_type="focused_work")
        ],
        blocks=[
            TimedLineBlock(
                id="break",
                start="10:00",
                end="10:30",
                title="Break",
                kind="break",
            ),
            ScheduleDirectiveBlock(
                id="specific",
                mode="task",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
                duration_override_minutes=60,
            ),
            ScheduleDirectiveBlock(
                id="project",
                mode="filter",
                filter=DirectiveFilter(
                    work_types=["focused_work", "light_work"],
                    project_ids=[project.id, uuid4()],
                    goal_ids=[goal.id, uuid4()],
                ),
            ),
        ],
    )
    saved = await update_daily_plan(
        "2030-01-02",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(user.id),
        session,
    )

    generated = await generate_daily_plan("2030-01-02", str(user.id), session)

    assert generated.revision == saved.revision
    assert generated.schedule is not None
    assignments = generated.schedule["assignments"]
    assert assignments
    assert assignments[0]["directive_id"] == "specific"
    assert all(
        not (item["start_time"] < "10:30" and item["slot_end"] > "10:00")
        for item in assignments
    )
    assert generated.schedule["source_document_revision"] == 1
    project_diagnostic = next(
        item
        for item in generated.schedule["directive_diagnostics"]
        if item["directive_id"] == "project"
    )
    assert project_diagnostic["eligible_count"] == 2
    assert "unused_minutes" not in project_diagnostic
    assert generated.schedule["unused_minutes"] >= 0


@pytest.mark.asyncio
async def test_project_filter_excludes_quick_tasks_without_membership(
    session: Session, planning_data
) -> None:
    user, project, _goal, _first, _second, quick = planning_data
    document = DailyPlanDocumentV1(
        blocks=[
            ScheduleDirectiveBlock(
                id="project-only",
                mode="filter",
                filter=DirectiveFilter(project_ids=[project.id]),
            )
        ]
    )
    await update_daily_plan(
        "2030-01-03",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(user.id),
        session,
    )

    generated = await generate_daily_plan("2030-01-03", str(user.id), session)

    task_ids = {item["task_id"] for item in generated.schedule["assignments"]}
    assert f"quick_{quick.id}" not in task_ids


@pytest.mark.asyncio
async def test_filter_directive_limits_total_minutes_and_time_window(
    session: Session, planning_data
) -> None:
    user, _project, goal, _first, _second, _quick = planning_data
    document = DailyPlanDocumentV1(
        availability_windows=[
            AvailabilityWindow(
                start="09:00",
                end="18:00",
                work_type="focused_work",
            )
        ],
        blocks=[
            ScheduleDirectiveBlock(
                id="afternoon-goal",
                mode="filter",
                filter=DirectiveFilter(goal_ids=[goal.id]),
                duration_override_minutes=90,
                allowed_windows=[DirectiveWindow(start="13:00", end="15:00")],
            )
        ],
    )
    await update_daily_plan(
        "2030-01-09",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(user.id),
        session,
    )

    generated = await generate_daily_plan("2030-01-09", str(user.id), session)

    assignments = [
        item
        for item in generated.schedule["assignments"]
        if item["directive_id"] == "afternoon-goal"
    ]
    assert sum(round(item["duration_hours"] * 60) for item in assignments) == 90
    assert all(
        item["start_time"] >= "13:00" and item["slot_end"] <= "15:00"
        for item in assignments
    )


def test_document_rejects_overlapping_availability_windows() -> None:
    with pytest.raises(ValueError, match="availability windows must not overlap"):
        DailyPlanDocumentV1(
            availability_windows=[
                AvailabilityWindow(start="09:00", end="12:00"),
                AvailabilityWindow(start="11:00", end="13:00"),
            ]
        )


@pytest.mark.asyncio
async def test_task_dependency_outside_directive_is_reported_as_blocked(
    session: Session, planning_data
) -> None:
    user, _project, _goal, dependent, prerequisite, _quick = planning_data
    session.add(
        TaskDependency(
            id=uuid4(),
            task_id=dependent.id,
            depends_on_task_id=prerequisite.id,
        )
    )
    session.commit()
    await update_daily_plan(
        "2030-01-07",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="dependent-only",
                        mode="task",
                        task_ref=TaskRef(source="task", id=dependent.id),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    generated = await generate_daily_plan("2030-01-07", str(user.id), session)

    diagnostic = generated.schedule["directive_diagnostics"][0]
    assert diagnostic["eligible_count"] == 0
    assert diagnostic["generated_count"] == 0
    assert diagnostic["reason"] == "依存タスクまたは依存ゴールが未完了です"


@pytest.mark.asyncio
async def test_goal_dependency_outside_filter_is_reported_as_blocked(
    session: Session, planning_data
) -> None:
    user, project, prerequisite_goal, _first, _second, _quick = planning_data
    dependent_goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Dependent goal",
        estimate_hours=Decimal("1"),
    )
    dependent_task = Task(
        id=uuid4(),
        goal_id=dependent_goal.id,
        title="Dependent task",
        estimate_hours=Decimal("1"),
        work_type=WorkType.FOCUSED_WORK,
    )
    session.add_all(
        [
            dependent_goal,
            dependent_task,
            GoalDependency(
                id=uuid4(),
                goal_id=dependent_goal.id,
                depends_on_goal_id=prerequisite_goal.id,
            ),
        ]
    )
    session.commit()
    await update_daily_plan(
        "2030-01-08",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="dependent-goal-only",
                        mode="filter",
                        filter=DirectiveFilter(goal_ids=[dependent_goal.id]),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    generated = await generate_daily_plan("2030-01-08", str(user.id), session)

    diagnostic = generated.schedule["directive_diagnostics"][0]
    assert diagnostic["eligible_count"] == 0
    assert diagnostic["generated_count"] == 0
    assert diagnostic["reason"] == "依存タスクまたは依存ゴールが未完了です"


@pytest.mark.asyncio
async def test_generate_persists_structured_solver_error(
    session: Session, planning_data, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    await update_daily_plan(
        "2030-01-05",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="specific",
                        mode="task",
                        task_ref=TaskRef(source="task", id=first.id),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    def fail_solver(_fixture):
        raise RuntimeError("solver unavailable")

    monkeypatch.setattr(
        "humancompiler_api.routers.daily_plans.plan_daily_schedule",
        fail_solver,
    )

    generated = await generate_daily_plan("2030-01-05", str(user.id), session)

    assert generated.schedule is not None
    assert generated.schedule["success"] is False
    assert generated.schedule["optimization_status"] == "SOLVER_ERROR"
    assert generated.schedule["assignments"] == []
    assert generated.schedule["unscheduled_tasks"][0]["task_id"] == str(first.id)


@pytest.mark.asyncio
async def test_generate_preserves_existing_fixed_assignment(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    date_text = "2030-01-04"
    document = DailyPlanDocumentV1(
        blocks=[
            ScheduleDirectiveBlock(
                id="specific",
                mode="task",
                task_ref=TaskRef(source="task", id=first.id),
                duration_override_minutes=120,
            )
        ]
    )
    await update_daily_plan(
        date_text,
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(user.id),
        session,
    )
    session.add(
        Schedule(
            id=uuid4(),
            user_id=user.id,
            date=datetime(2030, 1, 4),
            plan_json={
                "assignments": [
                    {
                        "task_id": str(first.id),
                        "start_time": "09:00",
                        "slot_end": "12:00",
                        "duration_hours": 0.5,
                        "slot_index": 7,
                        "is_fixed": True,
                        "directive_id": "specific",
                    }
                ]
            },
        )
    )
    session.commit()

    generated = await generate_daily_plan(date_text, str(user.id), session)

    fixed = [
        item for item in generated.schedule["assignments"] if item["is_fixed"] is True
    ]
    assert [(item["start_time"], item["slot_end"]) for item in fixed] == [
        ("09:00", "09:30")
    ]


@pytest.mark.asyncio
async def test_regular_task_action_records_time_and_completion(
    session: Session, planning_data, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data

    def fail_full_graph_load(*_args, **_kwargs):
        raise AssertionError("task action must not load the full task graph")

    monkeypatch.setattr(
        "humancompiler_api.routers.daily_plans._load_owned_tasks",
        fail_full_graph_load,
    )

    response = await apply_task_action(
        datetime(2030, 1, 2).strftime("%Y-%m-%d"),
        TaskActionRequest(
            task_ref=TaskRef(source="task", id=first.id),
            action="complete",
            actual_minutes=45,
        ),
        str(user.id),
        session,
    )

    session.refresh(first)
    logs = session.exec(select(Log).where(Log.task_id == first.id)).all()
    assert response.status == "completed"
    assert first.status == "completed"
    assert [log.actual_minutes for log in logs] == [45]


@pytest.mark.asyncio
async def test_quick_task_action_only_completes(
    session: Session, planning_data
) -> None:
    user, _project, _goal, _first, _second, quick = planning_data

    response = await apply_task_action(
        "2030-01-02",
        TaskActionRequest(
            task_ref=TaskRef(source="quick_task", id=quick.id),
            action="complete",
        ),
        str(user.id),
        session,
    )

    assert response.status == "completed"
