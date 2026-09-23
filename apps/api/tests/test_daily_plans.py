# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Tests for document-oriented daily planning."""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects import postgresql
from sqlmodel import Session, SQLModel, create_engine, select

from humancompiler_api.models import (
    DailyPlanDocument,
    Goal,
    GoalDependency,
    Log,
    Project,
    QuickTask,
    Schedule,
    Task,
    TaskDependency,
    TaskStatus,
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
    _build_scheduler_input,
    _directive_availability,
    _load_owned_tasks,
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
    assert exc_info.value.detail == {
        "message": "Referenced task was not found",
        "missing": [
            {
                "block_id": "foreign-task",
                "source": "task",
                "id": str(other_task.id),
            }
        ],
    }


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
async def test_explicit_two_three_two_hour_slots_ignore_legacy_global_window(
    session: Session, planning_data
) -> None:
    user, project, goal, first, second, _quick = planning_data
    first.estimate_hours = second.estimate_hours = Decimal("10")
    session.add_all([first, second])
    session.add_all(
        [
            Task(
                id=uuid4(),
                goal_id=goal.id,
                title=f"Long task {index}",
                estimate_hours=Decimal("10"),
            )
            for index in range(4)
        ]
    )
    session.commit()
    document = DailyPlanDocumentV1(
        availability_windows=[AvailabilityWindow(start="01:00", end="02:00")],
        blocks=[
            ScheduleDirectiveBlock(
                id=f"slot-{index}",
                mode="filter",
                filter=DirectiveFilter(project_ids=[project.id]),
                allowed_windows=[DirectiveWindow(start=start, end=end)],
                duration_override_minutes=minutes,
            )
            for index, (start, end, minutes) in enumerate(
                [
                    ("09:00", "11:00", 120),
                    ("12:00", "15:00", 180),
                    ("19:00", "21:00", 120),
                ]
            )
        ],
    )
    await update_daily_plan(
        "2030-01-12",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=document,
        ),
        str(user.id),
        session,
    )
    generated = generate_daily_plan("2030-01-12", str(user.id), session)
    assert generated.schedule is not None
    assert generated.schedule.success
    assert generated.schedule.total_scheduled_hours == 7
    assert [
        item.generated_minutes for item in generated.schedule.directive_diagnostics
    ] == [120, 180, 120]
    assert all(
        item.eligible_count == 6 for item in generated.schedule.directive_diagnostics
    )
    assert "availability_windows" not in generated.document.model_dump(mode="json")


@pytest.mark.asyncio
async def test_duration_only_draft_can_be_saved_but_cannot_generate(
    session: Session, planning_data
) -> None:
    user = planning_data[0]
    saved = await update_daily_plan(
        "2030-01-13",
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="no-time", mode="filter", duration_override_minutes=120
                    ),
                ]
            ),
        ),
        str(user.id),
        session,
    )
    assert saved.document.blocks[0].id == "no-time"
    with pytest.raises(HTTPException) as failure:
        generate_daily_plan("2030-01-13", str(user.id), session)
    assert failure.value.status_code == 422
    assert failure.value.detail["code"] == "SCHEDULE_TIME_REQUIRED"
    assert failure.value.detail["block_ids"] == ["no-time"]
    assert not session.exec(select(Schedule)).all()


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
                allowed_windows=[DirectiveWindow(start="09:00", end="12:00")],
                mode="task",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
                duration_override_minutes=60,
            ),
            ScheduleDirectiveBlock(
                id="project",
                allowed_windows=[DirectiveWindow(start="09:00", end="12:00")],
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

    generated = generate_daily_plan("2030-01-02", str(user.id), session)

    assert generated.revision == saved.revision
    assert generated.schedule is not None
    assignments = generated.schedule.assignments
    assert assignments
    assert assignments[0].directive_id == "specific"
    assert all(
        not (item.start_time < "10:30" and item.slot_end > "10:00")
        for item in assignments
    )
    assert generated.schedule.source_document_revision == 1
    project_diagnostic = next(
        item
        for item in generated.schedule.directive_diagnostics
        if item.directive_id == "project"
    )
    assert project_diagnostic.eligible_count == 2
    assert "unused_minutes" not in project_diagnostic.model_dump()
    assert generated.schedule.unused_minutes >= 0


@pytest.mark.asyncio
async def test_project_filter_excludes_quick_tasks_without_membership(
    session: Session, planning_data
) -> None:
    user, project, _goal, _first, _second, quick = planning_data
    document = DailyPlanDocumentV1(
        blocks=[
            ScheduleDirectiveBlock(
                id="project-only",
                allowed_windows=[DirectiveWindow(start="09:00", end="18:00")],
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

    generated = generate_daily_plan("2030-01-03", str(user.id), session)

    assert generated.schedule is not None
    task_ids = {item.task_id for item in generated.schedule.assignments}
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

    generated = generate_daily_plan("2030-01-09", str(user.id), session)

    assert generated.schedule is not None
    assignments = [
        item
        for item in generated.schedule.assignments
        if item.directive_id == "afternoon-goal"
    ]
    assert sum(round(item.duration_hours * 60) for item in assignments) == 90
    assert all(
        item.start_time >= "13:00" and item.slot_end <= "15:00" for item in assignments
    )


def test_directive_availability_unions_overlap_without_filling_gaps() -> None:
    document = DailyPlanDocumentV1(
        blocks=[
            ScheduleDirectiveBlock(
                id=str(index),
                mode="filter",
                allowed_windows=[
                    DirectiveWindow(start=start, end=end),
                ],
            )
            for index, (start, end) in enumerate(
                [
                    ("09:00", "11:00"),
                    ("10:00", "12:00"),
                    ("19:00", "21:00"),
                ]
            )
        ]
    )
    windows = _directive_availability(document)
    assert [
        (item.start.strftime("%H:%M"), item.end.strftime("%H:%M")) for item in windows
    ] == [
        ("09:00", "12:00"),
        ("19:00", "21:00"),
    ]


@pytest.mark.parametrize("reverse", [False, True])
def test_overlapping_work_kinds_prefer_narrower_window_not_row_order(
    reverse: bool,
) -> None:
    blocks = [
        ScheduleDirectiveBlock(
            id="focused",
            mode="filter",
            work_type="focused_work",
            allowed_windows=[DirectiveWindow(start="09:00", end="12:00")],
        ),
        ScheduleDirectiveBlock(
            id="light",
            mode="filter",
            work_type="light_work",
            allowed_windows=[DirectiveWindow(start="10:00", end="11:00")],
        ),
    ]
    if reverse:
        blocks.reverse()
    windows = _directive_availability(DailyPlanDocumentV1(blocks=blocks))
    assert [
        (item.start.strftime("%H:%M"), item.end.strftime("%H:%M"), item.work_kind.value)
        for item in windows
    ] == [
        ("09:00", "10:00", "focused_work"),
        ("10:00", "11:00", "light_work"),
        ("11:00", "12:00", "focused_work"),
    ]


@pytest.mark.parametrize(
    "second_start,second_end", [("09:00", "12:00"), ("10:00", "13:00")]
)
def test_equal_length_overlaps_are_order_independent(
    second_start: str, second_end: str
) -> None:
    first = ScheduleDirectiveBlock(
        id="first",
        mode="filter",
        work_type="focused_work",
        allowed_windows=[DirectiveWindow(start="09:00", end="12:00")],
    )
    second = ScheduleDirectiveBlock(
        id="second",
        mode="filter",
        work_type="light_work",
        allowed_windows=[DirectiveWindow(start=second_start, end=second_end)],
    )
    assert _directive_availability(DailyPlanDocumentV1(blocks=[first, second])) == (
        _directive_availability(DailyPlanDocumentV1(blocks=[second, first]))
    )


def test_document_metadata_uses_postgres_jsonb_and_unique_lookup_index() -> None:
    table = SQLModel.metadata.tables[DailyPlanDocument.__tablename__]
    assert table.c.document_json.type.compile(dialect=postgresql.dialect()) == "JSONB"
    assert not table.c.document_json.nullable
    assert not table.indexes
    unique = next(
        item
        for item in table.constraints
        if item.name == "uq_daily_plan_documents_user_date"
    )
    assert list(unique.columns.keys()) == ["user_id", "date"]


def test_document_ignores_legacy_global_availability() -> None:
    document = DailyPlanDocumentV1.model_validate(
        {
            "schema_version": 1,
            "availability_windows": [
                {"start": "09:00", "end": "12:00"},
                {"start": "11:00", "end": "13:00"},
            ],
            "blocks": [],
        }
    )
    assert document.model_dump() == {"schema_version": 1, "blocks": []}


def test_directive_collections_have_safe_size_limits() -> None:
    with pytest.raises(ValueError):
        DirectiveFilter(
            work_types=[
                "light_work",
                "focused_work",
                "study",
                "light_work",
            ]
        )

    with pytest.raises(ValueError):
        ScheduleDirectiveBlock(
            id="too-many-windows",
            mode="filter",
            allowed_windows=[
                DirectiveWindow(start="09:00", end="10:00") for _ in range(25)
            ],
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
                        allowed_windows=[DirectiveWindow(start="09:00", end="18:00")],
                        mode="task",
                        task_ref=TaskRef(source="task", id=dependent.id),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    generated = generate_daily_plan("2030-01-07", str(user.id), session)

    assert generated.schedule is not None
    diagnostic = generated.schedule.directive_diagnostics[0]
    assert diagnostic.eligible_count == 0
    assert diagnostic.generated_count == 0
    assert diagnostic.reason == "依存タスクまたは依存ゴールが未完了です"


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
                        allowed_windows=[DirectiveWindow(start="09:00", end="18:00")],
                        mode="filter",
                        filter=DirectiveFilter(goal_ids=[dependent_goal.id]),
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )

    generated = generate_daily_plan("2030-01-08", str(user.id), session)

    assert generated.schedule is not None
    diagnostic = generated.schedule.directive_diagnostics[0]
    assert diagnostic.eligible_count == 0
    assert diagnostic.generated_count == 0
    assert diagnostic.reason == "依存タスクまたは依存ゴールが未完了です"


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
                        allowed_windows=[DirectiveWindow(start="09:00", end="18:00")],
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

    generated = generate_daily_plan("2030-01-05", str(user.id), session)

    assert generated.schedule is not None
    assert generated.schedule.success is False
    assert generated.schedule.optimization_status == "SOLVER_ERROR"
    assert generated.schedule.assignments == []
    assert generated.schedule.unscheduled_tasks[0].task_id == str(first.id)


@pytest.mark.asyncio
async def test_generate_deduplicates_existing_fixed_assignment(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    date_text = "2030-01-04"
    document = DailyPlanDocumentV1(
        blocks=[
            TimedLineBlock(
                id="fixed-task",
                start="9:00",
                end="9:30",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
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

    generated = generate_daily_plan(date_text, str(user.id), session)

    assert generated.schedule is not None
    fixed = [item for item in generated.schedule.assignments if item.is_fixed is True]
    assert [(item.start_time, item.slot_end) for item in fixed] == [("09:00", "09:30")]


@pytest.mark.asyncio
async def test_editing_future_pin_replaces_previous_generated_time(
    session: Session, planning_data, monkeypatch
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    date_text = "2030-01-04"
    document = DailyPlanDocumentV1(
        blocks=[
            TimedLineBlock(
                id="pin",
                start="09:00",
                end="10:00",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
            )
        ]
    )
    await update_daily_plan(
        date_text,
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=document,
        ),
        str(user.id),
        session,
    )
    statements = []
    execute = session.exec

    def capture_statement(statement, *args, **kwargs):
        statements.append(str(statement.compile(dialect=postgresql.dialect())))
        return execute(statement, *args, **kwargs)

    monkeypatch.setattr(session, "exec", capture_statement)
    initial = generate_daily_plan(date_text, str(user.id), session)
    assert statements[0].endswith("FOR UPDATE")
    assert initial.schedule is not None
    assert all(item.is_fixed for item in initial.schedule.assignments)
    document.blocks[0].start = "09:30"
    document.blocks[0].end = "10:30"
    await update_daily_plan(
        date_text,
        DailyPlanUpdateRequest(
            expected_revision=1,
            document=document,
        ),
        str(user.id),
        session,
    )

    generated = generate_daily_plan(date_text, str(user.id), session)

    assert generated.schedule is not None
    assert generated.schedule.success
    assert [
        (item.start_time, item.slot_end) for item in generated.schedule.assignments
    ] == [
        ("09:30", "10:30"),
    ]


@pytest.mark.asyncio
async def test_generate_drops_deleted_future_fixed_assignment(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    date_text = "2030-01-10"
    await update_daily_plan(
        date_text,
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    ScheduleDirectiveBlock(
                        id="remaining-directive",
                        allowed_windows=[DirectiveWindow(start="09:00", end="18:00")],
                        mode="task",
                        task_ref=TaskRef(source="task", id=first.id),
                        duration_override_minutes=60,
                    )
                ]
            ),
        ),
        str(user.id),
        session,
    )
    session.add(
        Schedule(
            id=uuid4(),
            user_id=user.id,
            date=datetime(2030, 1, 10),
            plan_json={
                "assignments": [
                    {
                        "task_id": str(first.id),
                        "start_time": "09:00",
                        "slot_end": "10:00",
                        "duration_hours": 1,
                        "is_fixed": True,
                        "directive_id": "deleted-pin",
                    }
                ]
            },
        )
    )
    session.commit()

    generated = generate_daily_plan(date_text, str(user.id), session)

    assert generated.schedule is not None
    assert all(not assignment.is_fixed for assignment in generated.schedule.assignments)


def test_owned_task_loader_limits_history_but_can_target_completed_tasks(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, second, _quick = planning_data
    second.status = TaskStatus.COMPLETED
    session.add(second)
    session.commit()

    regular, _quick = _load_owned_tasks(session, user.id)
    assert str(first.id) in regular
    assert str(second.id) not in regular

    regular, _quick = _load_owned_tasks(
        session,
        user.id,
        additional_regular_ids={second.id},
    )
    assert str(second.id) in regular


def test_multiple_frozen_lines_accumulate_requested_minutes(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    first.estimate_hours = Decimal("0.5")
    session.add(first)
    session.commit()
    document = DailyPlanDocumentV1(
        blocks=[
            TimedLineBlock(
                id="morning",
                start="09:00",
                end="10:00",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
            ),
            TimedLineBlock(
                id="afternoon",
                start="14:00",
                end="15:00",
                title=first.title,
                task_ref=TaskRef(source="task", id=first.id),
            ),
        ]
    )

    fixture, _metadata, _counts, _blocked = _build_scheduler_input(
        session,
        user.id,
        "2030-01-11",
        document,
    )

    task = next(item for item in fixture.tasks if item.id == str(first.id))
    assert task.remaining_minutes == 120
    assert len(fixture.frozen_blocks) == 2


@pytest.mark.asyncio
async def test_generate_surfaces_overlapping_frozen_block_violations(
    session: Session, planning_data
) -> None:
    user, _project, _goal, first, second, _quick = planning_data
    date_text = "2030-01-12"
    await update_daily_plan(
        date_text,
        DailyPlanUpdateRequest(
            expected_revision=0,
            document=DailyPlanDocumentV1(
                blocks=[
                    TimedLineBlock(
                        id="first-pin",
                        start="09:00",
                        end="11:00",
                        title=first.title,
                        task_ref=TaskRef(source="task", id=first.id),
                    ),
                    TimedLineBlock(
                        id="second-pin",
                        start="10:00",
                        end="12:00",
                        title=second.title,
                        task_ref=TaskRef(source="task", id=second.id),
                    ),
                ]
            ),
        ),
        str(user.id),
        session,
    )

    generated = generate_daily_plan(date_text, str(user.id), session)

    assert generated.schedule is not None
    assert generated.schedule.success is False
    assert generated.schedule.violations
    assert generated.schedule.violations[0].code == "overlapping_frozen_blocks"


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
@pytest.mark.parametrize(
    "initial_status,expected_status",
    [
        (TaskStatus.PENDING, TaskStatus.IN_PROGRESS),
        (TaskStatus.IN_PROGRESS, TaskStatus.IN_PROGRESS),
        (TaskStatus.COMPLETED, TaskStatus.COMPLETED),
        (TaskStatus.CANCELLED, TaskStatus.CANCELLED),
    ],
)
async def test_continue_records_work_and_advances_only_pending_tasks(
    session: Session,
    planning_data,
    initial_status: TaskStatus,
    expected_status: TaskStatus,
) -> None:
    user, _project, _goal, first, _second, _quick = planning_data
    first.status = initial_status
    session.add(first)
    session.commit()
    response = await apply_task_action(
        "2030-01-02",
        TaskActionRequest(
            task_ref=TaskRef(source="task", id=first.id),
            action="continue",
            actual_minutes=25,
        ),
        str(user.id),
        session,
    )
    session.refresh(first)
    assert response.status == expected_status
    assert first.status == expected_status
    assert [
        log.actual_minutes
        for log in session.exec(select(Log).where(Log.task_id == first.id)).all()
    ] == [25]


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


@pytest.mark.asyncio
async def test_rich_daily_note_round_trip_preserves_formatting_and_schedule(
    session: Session, planning_data
) -> None:
    from humancompiler_api.routers.daily_plans import TextBlock

    user = planning_data[0]
    document = DailyPlanDocumentV1(
        blocks=[
            ScheduleDirectiveBlock(
                id="morning",
                mode="filter",
                allowed_windows=[DirectiveWindow(start="09:00", end="12:00")],
            ),
            TextBlock(
                id="note",
                text="振り返り",
                content={
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [
                        {
                            "type": "text",
                            "text": "振り返り",
                            "marks": [{"type": "bold"}],
                        }
                    ],
                },
            ),
        ]
    )
    await update_daily_plan(
        "2030-01-02",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(user.id),
        session,
    )
    generated = generate_daily_plan("2030-01-02", str(user.id), session)
    assert generated.schedule is not None
    assert generated.schedule.source_scheduling_blocks == document.blocks[:1]

    document.blocks.append(
        TextBlock(
            id="progress",
            text="完了",
            content={
                "type": "taskList",
                "content": [
                    {
                        "type": "taskItem",
                        "attrs": {"checked": True},
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "完了"}],
                            }
                        ],
                    }
                ],
            },
        )
    )
    await update_daily_plan(
        "2030-01-02",
        DailyPlanUpdateRequest(expected_revision=1, document=document),
        str(user.id),
        session,
    )
    loaded = await get_daily_plan("2030-01-02", str(user.id), session)
    assert loaded.document == document
    assert loaded.schedule == generated.schedule


def test_rich_daily_note_rejects_oversized_and_embedded_schedule_nodes() -> None:
    from pydantic import ValidationError
    from humancompiler_api.routers.daily_plans import TextBlock

    with pytest.raises(ValidationError):
        TextBlock(id="oversized", content={"type": "text", "text": "a" * 50001})
    with pytest.raises(ValidationError):
        TextBlock(id="hidden-schedule", content={"type": "dailyPlanBlock", "attrs": {}})


@pytest.mark.asyncio
async def test_notebook_history_search_is_owned_literal_and_paginated(
    session: Session, planning_data
) -> None:
    from datetime import date
    from humancompiler_api.routers.daily_plans import TextBlock, list_daily_plans

    user = planning_data[0]
    other = User(id=uuid4(), email="other-note@example.com")
    session.add(other)
    session.commit()
    for owner, day, body in [
        (user, "2030-01-01", "論文を調査"),
        (user, "2030-01-02", "進捗 100%_完了"),
        (user, "2030-01-03", "論文の結果"),
        (other, "2030-01-04", "論文 他のユーザーの秘密"),
    ]:
        await update_daily_plan(
            day,
            DailyPlanUpdateRequest(
                expected_revision=0,
                document=DailyPlanDocumentV1(
                    blocks=[TextBlock(id="paragraph", text=body)]
                ),
            ),
            str(owner.id),
            session,
        )
    await update_daily_plan(
        "2030-01-05",
        DailyPlanUpdateRequest(expected_revision=0, document=DailyPlanDocumentV1()),
        str(user.id),
        session,
    )

    page = await list_daily_plans(limit=2, user_id=str(user.id), session=session)
    assert [item.date for item in page.items] == ["2030-01-03", "2030-01-02"]
    assert page.next_cursor == "2030-01-02"
    older = await list_daily_plans(
        before=date.fromisoformat(page.next_cursor),
        limit=2,
        user_id=str(user.id),
        session=session,
    )
    assert [item.date for item in older.items] == ["2030-01-01"]
    assert older.next_cursor is None
    matched = await list_daily_plans(
        query="論文", user_id=str(user.id), session=session
    )
    assert [item.date for item in matched.items] == ["2030-01-03", "2030-01-01"]
    literal = await list_daily_plans(query="%_", user_id=str(user.id), session=session)
    assert [item.date for item in literal.items] == ["2030-01-02"]
    ranged = await list_daily_plans(
        date_from=date(2030, 1, 2),
        date_to=date(2030, 1, 2),
        user_id=str(user.id),
        session=session,
    )
    assert [item.date for item in ranged.items] == ["2030-01-02"]
    with pytest.raises(HTTPException) as exc:
        await list_daily_plans(
            date_from=date(2030, 2, 1),
            date_to=date(2030, 1, 1),
            user_id=str(user.id),
            session=session,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_notebook_history_updates_search_and_shows_match_context(
    session: Session, planning_data
) -> None:
    from humancompiler_api.routers.daily_plans import TextBlock, list_daily_plans

    user = planning_data[0]
    for revision, text in [
        (0, "old keyword"),
        (1, "導入 " * 100 + "調査結果 Match TARGET"),
    ]:
        await update_daily_plan(
            "2030-01-02",
            DailyPlanUpdateRequest(
                expected_revision=revision,
                document=DailyPlanDocumentV1(
                    blocks=[TextBlock(id="internal-only-id", text=text)]
                ),
            ),
            str(user.id),
            session,
        )
    assert (
        await list_daily_plans(
            query="old keyword", user_id=str(user.id), session=session
        )
    ).items == []
    assert (
        await list_daily_plans(
            query="internal-only-id", user_id=str(user.id), session=session
        )
    ).items == []
    result = await list_daily_plans(
        query="match target", user_id=str(user.id), session=session
    )
    assert len(result.items) == 1
    assert "Match TARGET" in result.items[0].preview
    assert result.items[0].preview.startswith("…")
    assert result.items[0].revision == 2


@pytest.mark.asyncio
async def test_long_notebook_paragraph_is_saved_without_truncation(
    session, planning_data
):
    from humancompiler_api.routers.daily_plans import TextBlock

    body = "研究" * 4000
    content = {"type": "paragraph", "content": [{"type": "text", "text": body}]}
    document = DailyPlanDocumentV1(
        blocks=[TextBlock(id="long", text=body, content=content)]
    )
    saved = await update_daily_plan(
        "2030-02-01",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(planning_data[0].id),
        session,
    )
    assert saved.document.blocks[0].text == body
    loaded = await get_daily_plan("2030-02-01", str(planning_data[0].id), session)
    assert loaded.document.blocks[0].content == content


def test_notebook_limits_have_machine_readable_errors():
    from pydantic import ValidationError
    from humancompiler_api.routers.daily_plans import TextBlock

    with pytest.raises(ValidationError) as error:
        TextBlock(id="too-long", text="x" * 50001)
    assert error.value.errors()[0]["type"] == "string_too_long"
    with pytest.raises(ValidationError) as error:
        TextBlock(id="rich-long", content={"type": "text", "text": "x" * 50000})
    assert error.value.errors()[0]["type"] == "note_content_too_large"
    content = {"type": "paragraph", "content": []}
    for _ in range(22):
        content = {"type": "blockquote", "content": [content]}
    with pytest.raises(ValidationError) as error:
        TextBlock(id="deep", content=content)
    assert error.value.errors()[0]["type"] == "note_too_deep"
    with pytest.raises(ValidationError) as error:
        DailyPlanDocumentV1(
            blocks=[
                TextBlock(
                    id=str(index),
                    text="x" * 49000,
                    content={"type": "text", "text": "x" * 49000},
                )
                for index in range(60)
            ]
        )
    assert error.value.errors()[0]["type"] == "note_document_too_large"


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "java\nscript:alert(1)",
        "\x00javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
    ],
)
def test_notebook_rejects_unsafe_links_from_json(href):
    from pydantic import ValidationError
    from humancompiler_api.routers.daily_plans import TextBlock

    with pytest.raises(ValidationError) as error:
        TextBlock(
            id="link",
            content={
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "link",
                        "marks": [{"type": "link", "attrs": {"href": href}}],
                    }
                ],
            },
        )
    assert error.value.errors()[0]["type"] == "note_unsafe_link"


@pytest.mark.parametrize(
    "href",
    [
        "https://example.com/path",
        "http://example.com",
        "mailto:a@example.com",
        "tel:+81123456",
        "/notes",
        "#section",
    ],
)
def test_notebook_preserves_supported_link_and_formatting_marks(href):
    from humancompiler_api.routers.daily_plans import TextBlock

    content = {
        "type": "paragraph",
        "content": [
            {
                "type": "text",
                "text": "link",
                "marks": [
                    {"type": "bold"},
                    {"type": "italic"},
                    {
                        "type": "link",
                        "attrs": {
                            "href": href,
                            "target": "_blank",
                            "rel": "noopener noreferrer nofollow",
                            "class": None,
                        },
                    },
                ],
            }
        ],
    }
    assert TextBlock(id="link", content=content).content == content


@pytest.mark.parametrize(
    "node",
    [
        {"type": "paragraph", "attrs": {"onclick": "alert(1)"}},
        {"type": "text", "text": "memo", "marks": [{"type": "script"}]},
        {
            "type": "text",
            "text": "memo",
            "marks": [
                {
                    "type": "link",
                    "attrs": {"href": "https://example.com", "onclick": "alert(1)"},
                }
            ],
        },
    ],
)
def test_notebook_rejects_unsupported_marks_and_attributes(node):
    from pydantic import ValidationError
    from humancompiler_api.routers.daily_plans import TextBlock

    with pytest.raises(ValidationError):
        TextBlock(id="invalid", content=node)


def test_history_preview_keeps_original_offsets_for_length_changing_lowercase():
    from humancompiler_api.routers.daily_plans import _history_preview

    text = "İ" * 160 + "TARGET" + "あ" * 200
    preview = _history_preview(text, "target")
    assert "TARGET" in preview
    assert preview.startswith("…" + "İ" * 45 + "TARGET")


@pytest.mark.parametrize(
    "node_type", ["bulletList", "orderedList", "taskList", "blockquote"]
)
@pytest.mark.asyncio
async def test_editor_nested_metadata_is_normalized_on_save_and_load(
    session, planning_data, node_type
):
    from copy import deepcopy
    from humancompiler_api.routers.daily_plans import TextBlock

    paragraph = {
        "type": "paragraph",
        "attrs": {"planId": None},
        "content": [{"type": "text", "text": "追記メモ"}],
    }
    children = (
        [paragraph]
        if node_type == "blockquote"
        else [
            {
                "type": "taskItem" if node_type == "taskList" else "listItem",
                **({"attrs": {"checked": True}} if node_type == "taskList" else {}),
                "content": [paragraph],
            }
        ]
    )
    raw = {"type": node_type, "attrs": {"planId": "editor-only"}, "content": children}
    original = deepcopy(raw)
    document = DailyPlanDocumentV1(
        blocks=[TextBlock(id="stable-id", text="追記メモ", content=raw)]
    )
    saved = await update_daily_plan(
        "2030-02-02",
        DailyPlanUpdateRequest(expected_revision=0, document=document),
        str(planning_data[0].id),
        session,
    )
    assert saved.document.blocks[0].id == "stable-id"
    assert "planId" not in str(saved.document.model_dump())
    assert raw == original  # validation must not mutate caller-owned/stored JSON
    loaded = await get_daily_plan("2030-02-02", str(planning_data[0].id), session)
    assert loaded.document == saved.document
    if node_type == "taskList":
        assert (
            loaded.document.blocks[0].content["content"][0]["attrs"]["checked"] is True
        )


@pytest.mark.asyncio
async def test_loads_existing_notebook_with_nested_editor_metadata(
    session, planning_data
):
    from datetime import date

    content = {
        "type": "blockquote",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"planId": "old-editor-id"},
                "content": [{"type": "text", "text": "過去の引用"}],
            }
        ],
    }
    session.add(
        DailyPlanDocument(
            user_id=planning_data[0].id,
            date=date(2030, 2, 3),
            revision=1,
            document_json={
                "schema_version": 1,
                "blocks": [
                    {
                        "id": "existing",
                        "type": "text",
                        "text": "過去の引用",
                        "content": content,
                    }
                ],
            },
        )
    )
    session.commit()
    loaded = await get_daily_plan("2030-02-03", str(planning_data[0].id), session)
    assert loaded.document.blocks[0].id == "existing"
    assert "planId" not in str(loaded.document.model_dump())
    assert loaded.document.blocks[0].text == "過去の引用"
