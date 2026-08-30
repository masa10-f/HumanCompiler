# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Lightweight, document-oriented daily planning endpoints."""

from __future__ import annotations

import logging
from datetime import UTC, date as date_type, datetime, time
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import update as sqlalchemy_update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from humancompiler_scheduler.human import (
    HumanAvailabilityWindow,
    HumanCandidatePool,
    HumanFixedEvent,
    HumanFlexibleDailyFixture,
    HumanFrozenTaskBlock,
    HumanTask,
    HumanWorkKind,
    compile_human_flexible_daily_fixture,
    plan_daily_schedule,
)

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import db
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
    WorkType,
)

router = APIRouter(prefix="/daily-plans", tags=["daily-plans"])
logger = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")
ACTIVE_TASK_STATUSES = {TaskStatus.PENDING, TaskStatus.IN_PROGRESS}


def _parse_time(value: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise ValueError("time must use HH:MM format") from exc


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _time_text(value: time) -> str:
    return value.strftime("%H:%M")


class TaskRef(BaseModel):
    source: Literal["task", "quick_task"]
    id: UUID

    @property
    def scheduler_id(self) -> str:
        return str(self.id) if self.source == "task" else f"quick_{self.id}"


class AvailabilityWindow(BaseModel):
    start: str = "09:00"
    end: str = "18:00"
    work_type: Literal["light_work", "focused_work", "study"] = "light_work"

    @field_validator("start", "end")
    @classmethod
    def validate_time(cls, value: str) -> str:
        _parse_time(value)
        return value

    @model_validator(mode="after")
    def validate_range(self) -> AvailabilityWindow:
        if _minutes(_parse_time(self.start)) >= _minutes(_parse_time(self.end)):
            raise ValueError("availability start must be before end")
        return self


class TimedLineBlock(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["timed_line"] = "timed_line"
    start: str
    end: str
    title: str = Field(min_length=1, max_length=500)
    task_ref: TaskRef | None = None
    pinned: bool = True

    @field_validator("start", "end")
    @classmethod
    def validate_time(cls, value: str) -> str:
        _parse_time(value)
        return value

    @model_validator(mode="after")
    def validate_range(self) -> TimedLineBlock:
        if _minutes(_parse_time(self.start)) >= _minutes(_parse_time(self.end)):
            raise ValueError("timed line start must be before end")
        return self


class DirectiveFilter(BaseModel):
    work_types: list[Literal["light_work", "focused_work", "study"]] = Field(
        default_factory=list
    )
    project_ids: list[UUID] = Field(default_factory=list)
    goal_ids: list[UUID] = Field(default_factory=list)


class ScheduleDirectiveBlock(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["schedule_directive"] = "schedule_directive"
    mode: Literal["task", "filter"]
    title: str | None = Field(default=None, max_length=500)
    task_ref: TaskRef | None = None
    filter: DirectiveFilter | None = None
    duration_override_minutes: int | None = Field(default=None, gt=0, le=1440)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> ScheduleDirectiveBlock:
        if self.mode == "task" and self.task_ref is None:
            raise ValueError("task mode requires task_ref")
        if self.mode == "filter" and self.filter is None:
            self.filter = DirectiveFilter()
        return self


class ChecklistItemBlock(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["checklist_item"] = "checklist_item"
    title: str = Field(min_length=1, max_length=500)
    checked: bool = False
    task_ref: TaskRef | None = None
    duration_override_minutes: int | None = Field(default=None, gt=0, le=1440)


class TextBlock(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["text"] = "text"
    text: str = Field(default="", max_length=5000)


DailyPlanBlock = Annotated[
    TimedLineBlock | ScheduleDirectiveBlock | ChecklistItemBlock | TextBlock,
    Field(discriminator="type"),
]


class DailyPlanDocumentV1(BaseModel):
    schema_version: Literal[1] = 1
    availability_windows: list[AvailabilityWindow] = Field(
        default_factory=lambda: [AvailabilityWindow()]
    )
    blocks: list[DailyPlanBlock] = Field(default_factory=list)

    @field_validator("availability_windows")
    @classmethod
    def require_availability(
        cls, value: list[AvailabilityWindow]
    ) -> list[AvailabilityWindow]:
        if not value:
            raise ValueError("at least one availability window is required")
        return value

    @field_validator("blocks")
    @classmethod
    def unique_block_ids(cls, value: list[DailyPlanBlock]) -> list[DailyPlanBlock]:
        ids = [block.id for block in value]
        if len(ids) != len(set(ids)):
            raise ValueError("daily plan block ids must be unique")
        return value


class DailyPlanUpdateRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    document: DailyPlanDocumentV1


class DailyPlanResponse(BaseModel):
    id: UUID | None = None
    date: str
    revision: int
    document: DailyPlanDocumentV1
    schedule: dict | None = None
    updated_at: datetime | None = None


class TaskActionRequest(BaseModel):
    task_ref: TaskRef
    action: Literal["continue", "complete"]
    actual_minutes: int | None = Field(default=None, ge=1, le=1440)


class TaskActionResponse(BaseModel):
    task_ref: TaskRef
    status: TaskStatus
    actual_minutes: int | None = None


def _parse_date(value: str) -> date_type:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Date must be in YYYY-MM-DD format",
        ) from exc


def _get_document(
    session: Session, user_id: UUID, date_value: date_type
) -> DailyPlanDocument | None:
    return session.exec(
        select(DailyPlanDocument).where(
            DailyPlanDocument.user_id == user_id,
            DailyPlanDocument.date == date_value,
        )
    ).first()


def _get_schedule(
    session: Session, user_id: UUID, date_value: date_type
) -> Schedule | None:
    schedule_date = datetime.combine(date_value, time.min)
    return session.exec(
        select(Schedule).where(
            Schedule.user_id == user_id,
            Schedule.date == schedule_date,
        )
    ).first()


def _response(
    session: Session,
    user_id: UUID,
    date_text: str,
    document: DailyPlanDocument | None,
) -> DailyPlanResponse:
    date_value = _parse_date(date_text)
    schedule = _get_schedule(session, user_id, date_value)
    if document is None:
        return DailyPlanResponse(
            date=date_text,
            revision=0,
            document=DailyPlanDocumentV1(),
            schedule=schedule.plan_json if schedule else None,
        )
    return DailyPlanResponse(
        id=document.id,
        date=date_text,
        revision=document.revision,
        document=DailyPlanDocumentV1.model_validate(document.document_json),
        schedule=schedule.plan_json if schedule else None,
        updated_at=document.updated_at,
    )


@router.get("/{date}", response_model=DailyPlanResponse)
async def get_daily_plan(
    date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
) -> DailyPlanResponse:
    date_value = _parse_date(date)
    owner_id = UUID(user_id)
    return _response(
        session, owner_id, date, _get_document(session, owner_id, date_value)
    )


@router.put("/{date}", response_model=DailyPlanResponse)
async def update_daily_plan(
    date: str,
    request: DailyPlanUpdateRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
) -> DailyPlanResponse:
    date_value = _parse_date(date)
    owner_id = UUID(user_id)
    task_refs = [
        task_ref
        for block in request.document.blocks
        if (task_ref := getattr(block, "task_ref", None)) is not None
    ]
    if task_refs:
        regular, quick, _actual_minutes = _load_owned_tasks(
            session, owner_id, include_actual_minutes=False
        )
        for task_ref in task_refs:
            _validate_task_ref(task_ref, regular, quick)
    existing = _get_document(session, owner_id, date_value)
    if existing is None:
        if request.expected_revision != 0:
            raise HTTPException(status_code=409, detail="Daily plan revision conflict")
        existing = DailyPlanDocument(
            user_id=owner_id,
            date=date_value,
            revision=1,
            document_json=request.document.model_dump(mode="json"),
        )
        session.add(existing)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Daily plan revision conflict",
            ) from exc
        session.refresh(existing)
    else:
        result = session.exec(
            sqlalchemy_update(DailyPlanDocument)
            .where(
                DailyPlanDocument.id == existing.id,
                DailyPlanDocument.revision == request.expected_revision,
            )
            .values(
                revision=request.expected_revision + 1,
                document_json=request.document.model_dump(mode="json"),
                updated_at=datetime.now(UTC),
            )
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            session.rollback()
            current = _get_document(session, owner_id, date_value)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Daily plan revision conflict",
                    "current_revision": current.revision if current else None,
                },
            )
        session.commit()
        existing = _get_document(session, owner_id, date_value)
        if existing is None:  # pragma: no cover - guarded by the update above
            raise HTTPException(status_code=409, detail="Daily plan disappeared")
    return _response(session, owner_id, date, existing)


def _work_kind(value: str | WorkType) -> HumanWorkKind:
    raw = value.value if isinstance(value, WorkType) else value
    return {
        "focused_work": HumanWorkKind.FOCUSED_WORK,
        "study": HumanWorkKind.STUDY,
    }.get(raw, HumanWorkKind.LIGHT_WORK)


def _load_owned_tasks(
    session: Session,
    owner_id: UUID,
    *,
    include_actual_minutes: bool = True,
) -> tuple[
    dict[str, tuple[Task, Goal, Project]],
    dict[str, QuickTask],
    dict[str, int],
]:
    rows = session.exec(
        select(Task, Goal, Project)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(Project.owner_id == owner_id)
    ).all()
    regular = {str(task.id): (task, goal, project) for task, goal, project in rows}
    quick_rows = session.exec(
        select(QuickTask).where(QuickTask.owner_id == owner_id)
    ).all()
    quick = {f"quick_{task.id}": task for task in quick_rows}
    actual_minutes: dict[str, int] = {}
    if include_actual_minutes and rows:
        log_rows = session.exec(
            select(Log).where(Log.task_id.in_([row[0].id for row in rows]))
        ).all()
        for log in log_rows:
            task_id = str(log.task_id)
            actual_minutes[task_id] = (
                actual_minutes.get(task_id, 0) + log.actual_minutes
            )
    return regular, quick, actual_minutes


def _matches_filter(
    scheduler_id: str,
    filter_value: DirectiveFilter,
    regular: dict[str, tuple[Task, Goal, Project]],
    quick: dict[str, QuickTask],
) -> bool:
    if scheduler_id.startswith("quick_"):
        task = quick[scheduler_id]
        if filter_value.project_ids or filter_value.goal_ids:
            return False
        return (
            not filter_value.work_types
            or task.work_type.value in filter_value.work_types
        )

    task, goal, project = regular[scheduler_id]
    return (
        (not filter_value.work_types or task.work_type.value in filter_value.work_types)
        and (not filter_value.project_ids or project.id in filter_value.project_ids)
        and (not filter_value.goal_ids or goal.id in filter_value.goal_ids)
    )


def _task_status(
    scheduler_id: str,
    regular: dict[str, tuple[Task, Goal, Project]],
    quick: dict[str, QuickTask],
) -> TaskStatus:
    if scheduler_id.startswith("quick_"):
        return quick[scheduler_id].status
    return regular[scheduler_id][0].status


def _validate_task_ref(
    ref: TaskRef,
    regular: dict[str, tuple[Task, Goal, Project]],
    quick: dict[str, QuickTask],
) -> str:
    scheduler_id = ref.scheduler_id
    if scheduler_id not in regular and scheduler_id not in quick:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Referenced task was not found",
        )
    return scheduler_id


def _build_task_dependencies(
    session: Session,
    selected_ids: set[str],
    regular: dict[str, tuple[Task, Goal, Project]],
) -> dict[str, list[str]]:
    regular_ids = [
        UUID(task_id) for task_id in selected_ids if not task_id.startswith("quick_")
    ]
    dependencies: dict[str, set[str]] = {}
    if regular_ids:
        rows = session.exec(
            select(TaskDependency).where(TaskDependency.task_id.in_(regular_ids))
        ).all()
        for dependency in rows:
            dependent_id = str(dependency.task_id)
            prerequisite_id = str(dependency.depends_on_task_id)
            prerequisite = regular.get(prerequisite_id)
            if prerequisite and prerequisite[0].status == TaskStatus.COMPLETED:
                continue
            dependencies.setdefault(dependent_id, set()).add(prerequisite_id)

    selected_goal_ids = {
        str(regular[task_id][1].id) for task_id in selected_ids if task_id in regular
    }
    if selected_goal_ids:
        goal_dependencies = session.exec(
            select(GoalDependency).where(
                GoalDependency.goal_id.in_([UUID(item) for item in selected_goal_ids])
            )
        ).all()
        tasks_by_goal: dict[str, list[str]] = {}
        for task_id in selected_ids:
            if task_id in regular:
                tasks_by_goal.setdefault(str(regular[task_id][1].id), []).append(
                    task_id
                )
        active_tasks_by_goal: dict[str, list[str]] = {}
        for task_id, (task, goal, _project) in regular.items():
            if task.status in ACTIVE_TASK_STATUSES:
                active_tasks_by_goal.setdefault(str(goal.id), []).append(task_id)
        for dependency in goal_dependencies:
            dependent_tasks = tasks_by_goal.get(str(dependency.goal_id), [])
            prerequisite_tasks = active_tasks_by_goal.get(
                str(dependency.depends_on_goal_id), []
            )
            if not prerequisite_tasks:
                continue
            for task_id in dependent_tasks:
                dependencies.setdefault(task_id, set()).update(prerequisite_tasks)

    return {task_id: sorted(values) for task_id, values in dependencies.items()}


def _build_scheduler_input(
    session: Session,
    owner_id: UUID,
    date_text: str,
    document: DailyPlanDocumentV1,
) -> tuple[HumanFlexibleDailyFixture, dict[str, dict], dict[str, int]]:
    regular, quick, actual_minutes = _load_owned_tasks(session, owner_id)
    active_ids = {
        task_id
        for task_id in [*regular, *quick]
        if _task_status(task_id, regular, quick) in ACTIVE_TASK_STATUSES
    }
    selected_ids: set[str] = set()
    requested_by_task: dict[str, int] = {}
    candidate_pools: list[HumanCandidatePool] = []
    frozen_blocks: list[HumanFrozenTaskBlock] = []
    fixed_events: list[HumanFixedEvent] = []
    eligible_counts: dict[str, int] = {}
    schedule_date = _parse_date(date_text)
    current_jst = datetime.now(JST)
    now = current_jst if current_jst.date() == schedule_date else None
    frozen_keys: set[tuple[str, str, str]] = set()

    for block in document.blocks:
        if isinstance(block, TimedLineBlock):
            if block.task_ref is None:
                fixed_events.append(
                    HumanFixedEvent(
                        title=block.title,
                        start=_parse_time(block.start),
                        end=_parse_time(block.end),
                        metadata={"block_id": block.id},
                    )
                )
                continue
            scheduler_id = _validate_task_ref(block.task_ref, regular, quick)
            selected_ids.add(scheduler_id)
            duration = _minutes(_parse_time(block.end)) - _minutes(
                _parse_time(block.start)
            )
            requested_by_task[scheduler_id] = max(
                requested_by_task.get(scheduler_id, 0), duration
            )
            frozen_blocks.append(
                HumanFrozenTaskBlock(
                    task_id=scheduler_id,
                    start=_parse_time(block.start),
                    end=_parse_time(block.end),
                    directive_id=block.id,
                    metadata={"title": block.title},
                )
            )
            frozen_keys.add((scheduler_id, block.start, block.end))
        elif isinstance(block, ScheduleDirectiveBlock):
            if block.mode == "task" and block.task_ref is not None:
                scheduler_id = _validate_task_ref(block.task_ref, regular, quick)
                if (
                    _task_status(scheduler_id, regular, quick)
                    not in ACTIVE_TASK_STATUSES
                ):
                    eligible_ids: set[str] = set()
                else:
                    eligible_ids = {scheduler_id}
                    selected_ids.add(scheduler_id)
                    if block.duration_override_minutes:
                        requested_by_task[scheduler_id] = max(
                            requested_by_task.get(scheduler_id, 0),
                            block.duration_override_minutes,
                        )
                candidate_pools.append(
                    HumanCandidatePool(
                        id=block.id,
                        eligible_task_ids=frozenset(eligible_ids),
                        required_task_id=scheduler_id if eligible_ids else None,
                        requested_minutes=block.duration_override_minutes,
                    )
                )
                eligible_counts[block.id] = len(eligible_ids)
            elif block.mode == "filter":
                filter_value = block.filter or DirectiveFilter()
                eligible_ids = {
                    task_id
                    for task_id in active_ids
                    if _matches_filter(task_id, filter_value, regular, quick)
                }
                selected_ids.update(eligible_ids)
                candidate_pools.append(
                    HumanCandidatePool(
                        id=block.id,
                        eligible_task_ids=frozenset(eligible_ids),
                    )
                )
                eligible_counts[block.id] = len(eligible_ids)

    existing_schedule = _get_schedule(
        session,
        owner_id,
        _parse_date(date_text),
    )
    existing_assignments = (
        existing_schedule.plan_json.get("assignments", [])
        if existing_schedule and isinstance(existing_schedule.plan_json, dict)
        else []
    )
    for assignment in existing_assignments:
        if not isinstance(assignment, dict):
            continue
        scheduler_id = str(assignment.get("task_id", ""))
        start_text = str(assignment.get("start_time", ""))
        end_text = str(assignment.get("slot_end", ""))
        if scheduler_id not in regular and scheduler_id not in quick:
            continue
        try:
            start_value = _parse_time(start_text)
            end_value = _parse_time(end_text)
        except ValueError:
            continue
        is_past = now is not None and start_value < now.time()
        if not is_past and not bool(assignment.get("is_fixed")):
            continue
        key = (scheduler_id, start_text, end_text)
        if key in frozen_keys:
            continue
        duration = _minutes(end_value) - _minutes(start_value)
        if duration <= 0:
            continue
        selected_ids.add(scheduler_id)
        requested_by_task[scheduler_id] = max(
            requested_by_task.get(scheduler_id, 0),
            duration,
        )
        frozen_blocks.append(
            HumanFrozenTaskBlock(
                task_id=scheduler_id,
                start=start_value,
                end=end_value,
                directive_id=(
                    str(assignment["directive_id"])
                    if assignment.get("directive_id")
                    else None
                ),
                slot_index=0,
                metadata={"source": "previous_schedule"},
            )
        )
        frozen_keys.add(key)

    task_metadata: dict[str, dict] = {}
    scheduler_tasks: list[HumanTask] = []
    for scheduler_id in sorted(selected_ids):
        if scheduler_id.startswith("quick_"):
            quick_task = quick[scheduler_id]
            remaining = int(Decimal(quick_task.estimate_hours) * 60)
            remaining = max(remaining, requested_by_task.get(scheduler_id, 0))
            scheduler_tasks.append(
                HumanTask(
                    id=scheduler_id,
                    title=quick_task.title,
                    remaining_minutes=remaining,
                    priority=quick_task.priority,
                    work_kind=_work_kind(quick_task.work_type),
                    due_at=quick_task.due_date,
                    source="quick_task",
                )
            )
            task_metadata[scheduler_id] = {
                "title": quick_task.title,
                "goal_id": "",
                "project_id": "",
                "source": "quick_task",
            }
        else:
            task, goal, project = regular[scheduler_id]
            estimate_minutes = int(Decimal(task.estimate_hours) * 60)
            remaining = max(0, estimate_minutes - actual_minutes.get(scheduler_id, 0))
            remaining = max(remaining, requested_by_task.get(scheduler_id, 0))
            scheduler_tasks.append(
                HumanTask(
                    id=scheduler_id,
                    title=task.title,
                    remaining_minutes=remaining,
                    priority=task.priority,
                    work_kind=_work_kind(task.work_type),
                    due_at=task.due_date,
                    project_id=str(project.id),
                    goal_id=str(goal.id),
                    source="task",
                )
            )
            task_metadata[scheduler_id] = {
                "title": task.title,
                "goal_id": str(goal.id),
                "project_id": str(project.id),
                "project_title": project.title,
                "source": "task",
            }

    fixture = HumanFlexibleDailyFixture(
        date=schedule_date,
        tasks=scheduler_tasks,
        availability_windows=[
            HumanAvailabilityWindow(
                start=_parse_time(window.start),
                end=_parse_time(window.end),
                work_kind=_work_kind(window.work_type),
            )
            for window in document.availability_windows
        ],
        fixed_events=fixed_events,
        frozen_blocks=frozen_blocks,
        candidate_pools=candidate_pools,
        now=now,
        task_dependencies=_build_task_dependencies(session, selected_ids, regular),
        metadata={"source": "daily_plan_document"},
    )
    return fixture, task_metadata, eligible_counts


def _save_generated_schedule(
    session: Session,
    owner_id: UUID,
    date_value: date_type,
    plan_json: dict,
) -> None:
    schedule = _get_schedule(session, owner_id, date_value)
    if schedule is None:
        schedule = Schedule(
            id=uuid4(),
            user_id=owner_id,
            date=datetime.combine(date_value, time.min),
            plan_json=plan_json,
        )
    else:
        schedule.plan_json = plan_json
        schedule.updated_at = datetime.now(UTC)
    session.add(schedule)
    session.commit()


@router.post("/{date}/generate", response_model=DailyPlanResponse)
async def generate_daily_plan(
    date: str,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
) -> DailyPlanResponse:
    date_value = _parse_date(date)
    owner_id = UUID(user_id)
    source_document = _get_document(session, owner_id, date_value)
    if source_document is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Save the daily plan document before generating",
        )
    document = DailyPlanDocumentV1.model_validate(source_document.document_json)
    fixture, task_metadata, eligible_counts = _build_scheduler_input(
        session, owner_id, date, document
    )
    try:
        compiled_fixture = compile_human_flexible_daily_fixture(fixture)
        report = plan_daily_schedule(compiled_fixture)
    except Exception:
        logger.exception("humancompiler-scheduler failed for daily plan %s", date)
        plan_json = {
            "success": False,
            "assignments": [],
            "planned_task_ids": [],
            "total_scheduled_hours": 0.0,
            "optimization_status": "SOLVER_ERROR",
            "solve_time_seconds": 0.0,
            "objective_value": None,
            "generated_at": datetime.now(UTC).isoformat(),
            "source": "daily_plan_document",
            "source_document_revision": source_document.revision,
            "directive_diagnostics": [],
            "unused_minutes": 0,
            "unscheduled_tasks": [
                {
                    "task_id": task.id,
                    "title": task.title,
                    "reason": "solver_error",
                }
                for task in fixture.tasks
            ],
        }
        _save_generated_schedule(session, owner_id, date_value, plan_json)
        return _response(session, owner_id, date, source_document)
    slots_by_index = {slot.index: slot for slot in compiled_fixture.time_slots}

    assignments: list[dict] = []
    generated_counts: dict[str, int] = {}
    generated_minutes: dict[str, int] = {}
    for block in report.plan.blocks:
        metadata = task_metadata.get(block.task_id)
        if metadata is None:
            continue
        if block.directive_id:
            generated_counts[block.directive_id] = (
                generated_counts.get(block.directive_id, 0) + 1
            )
            generated_minutes[block.directive_id] = (
                generated_minutes.get(block.directive_id, 0) + block.duration_minutes
            )
        slot = slots_by_index.get(block.slot_index)
        assignments.append(
            {
                "task_id": block.task_id,
                "task_title": metadata["title"],
                "goal_id": metadata["goal_id"],
                "project_id": metadata["project_id"],
                "slot_index": block.slot_index,
                "start_time": _time_text(block.start),
                "duration_hours": block.duration_minutes / 60,
                "slot_start": _time_text(block.start),
                "slot_end": _time_text(block.end),
                "slot_kind": (
                    slot.work_kind.value
                    if slot is not None
                    else next(
                        (
                            task.work_kind.value
                            for task in compiled_fixture.tasks
                            if task.id == block.task_id
                        ),
                        "light_work",
                    )
                ),
                "is_fixed": block.is_fixed,
                "directive_id": block.directive_id,
                "source": metadata["source"],
            }
        )

    residual_capacity_minutes = sum(
        slot.effective_capacity_minutes for slot in compiled_fixture.time_slots
    )
    generated_capacity_minutes = sum(
        block.duration_minutes for block in report.plan.blocks if not block.is_fixed
    )
    unused_minutes = max(0, residual_capacity_minutes - generated_capacity_minutes)
    diagnostics = []
    for block in document.blocks:
        if not isinstance(block, ScheduleDirectiveBlock):
            continue
        eligible_count = eligible_counts.get(block.id, 0)
        generated_count = generated_counts.get(block.id, 0)
        reason = None
        generated_for_directive = generated_minutes.get(block.id, 0)
        if generated_count == 0:
            reason = (
                "候補がありません"
                if eligible_count == 0
                else "利用可能な時間が不足しています"
            )
        elif (
            block.mode == "task"
            and block.duration_override_minutes
            and generated_for_directive < block.duration_override_minutes
        ):
            reason = "要求時間の一部だけを配置しました"
        diagnostics.append(
            {
                "directive_id": block.id,
                "eligible_count": eligible_count,
                "generated_count": generated_count,
                "generated_minutes": generated_for_directive,
                "reason": reason,
            }
        )

    plan_json = {
        "success": report.plan.status in {"ok", "partial"},
        "assignments": assignments,
        "planned_task_ids": list(
            dict.fromkeys(item["task_id"] for item in assignments)
        ),
        "total_scheduled_hours": sum(item["duration_hours"] for item in assignments),
        "optimization_status": report.plan.status.upper(),
        "solve_time_seconds": 0.0,
        "objective_value": None,
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "daily_plan_document",
        "source_document_revision": source_document.revision,
        "directive_diagnostics": diagnostics,
        "unused_minutes": unused_minutes,
        "unscheduled_tasks": [
            {
                "task_id": item.task_id,
                "title": item.title,
                "reason": item.reason,
            }
            for item in report.unscheduled_tasks
        ],
    }
    _save_generated_schedule(session, owner_id, date_value, plan_json)
    return _response(session, owner_id, date, source_document)


@router.post("/{date}/task-action", response_model=TaskActionResponse)
async def apply_task_action(
    date: str,
    request: TaskActionRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
) -> TaskActionResponse:
    _parse_date(date)
    owner_id = UUID(user_id)
    regular, quick, _actual = _load_owned_tasks(
        session, owner_id, include_actual_minutes=False
    )
    scheduler_id = _validate_task_ref(request.task_ref, regular, quick)

    if request.task_ref.source == "quick_task":
        if request.action != "complete":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Quick Tasks only support completion from the daily plan",
            )
        quick_task = quick[scheduler_id]
        quick_task.status = TaskStatus.COMPLETED
        quick_task.updated_at = datetime.now(UTC)
        session.add(quick_task)
        session.commit()
        return TaskActionResponse(
            task_ref=request.task_ref,
            status=quick_task.status,
        )

    if request.actual_minutes is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="actual_minutes is required for regular tasks",
        )
    task = regular[scheduler_id][0]
    log = Log(
        id=uuid4(),
        task_id=task.id,
        actual_minutes=request.actual_minutes,
        comment=f"Daily plan {date}",
    )
    if request.action == "complete":
        task.status = TaskStatus.COMPLETED
    task.updated_at = datetime.now(UTC)
    session.add(log)
    session.add(task)
    session.commit()
    return TaskActionResponse(
        task_ref=request.task_ref,
        status=task.status,
        actual_minutes=request.actual_minutes,
    )
