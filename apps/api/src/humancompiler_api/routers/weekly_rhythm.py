# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Weekly rhythm: a weekday template of daily note blocks.

The template holds, for each weekday, the /schedule lines, fixed events and
breaks that a daily note starts from. The note copies them in; after that the
note is the source of truth and the template is not read again for that day.

The summary adds up the /schedule time per project, so the same template can
set the capacity triage allocation.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlmodel import Session, col, delete, select

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    Project,
    ProjectStatus,
    TriageCapacitySettingsResponse,
    TriageCapacitySettingsUpdate,
    User,
    WeeklyRhythmBlock,
)
from humancompiler_api.triage import triage_service

router = APIRouter(prefix="/weekly-rhythm", tags=["weekly-rhythm"])

MAX_BLOCKS = 200
MAX_BLOCKS_PER_DAY = 48
WEEKDAY_LABELS = ("月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜")
MAX_TRIAGE_CAPACITY_HOURS = Decimal("999.99")

BlockKind = Literal["schedule", "event", "break"]
BlockWorkType = Literal["light_work", "focused_work", "study"]


def _parse_clock(value: str) -> time:
    try:
        parsed = datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise ValueError("time must use HH:MM format") from exc
    if len(value) != 5:
        raise ValueError("time must use HH:MM format")
    return parsed


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _clock(value: time) -> str:
    return value.strftime("%H:%M")


class WeeklyRhythmBlockInput(BaseModel):
    weekday: int = Field(ge=0, le=6, description="0 = Monday ... 6 = Sunday")
    start: str = Field(description="HH:MM")
    end: str = Field(description="HH:MM, after start on the same day")
    kind: BlockKind = "schedule"
    title: str | None = Field(default=None, max_length=200)
    project_id: UUID | None = None
    work_type: BlockWorkType = "light_work"
    locked: bool = False

    @field_validator("start", "end")
    @classmethod
    def validate_clock(cls, value: str) -> str:
        _parse_clock(value)
        return value

    # Before validation, so max_length applies to the trimmed title like the editor.
    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def validate_block(self) -> WeeklyRhythmBlockInput:
        if _parse_clock(self.start) >= _parse_clock(self.end):
            raise ValueError("start must be before end")
        if self.kind != "schedule":
            if not self.title:
                raise ValueError("fixed events and breaks need a title")
            if self.project_id is not None:
                raise ValueError("only schedule blocks can have a project")
        return self


class WeeklyRhythmUpdate(BaseModel):
    blocks: list[WeeklyRhythmBlockInput] = Field(
        default_factory=list, max_length=MAX_BLOCKS
    )


class WeeklyRhythmBlockResponse(BaseModel):
    id: UUID
    weekday: int
    start: str
    end: str
    kind: BlockKind
    title: str | None
    project_id: UUID | None
    work_type: BlockWorkType
    locked: bool


class WeeklyRhythmDaySummary(BaseModel):
    weekday: int
    schedule_minutes: int
    event_minutes: int
    break_minutes: int


class WeeklyRhythmProjectSummary(BaseModel):
    # None: /schedule lines without a project (counted as Inbox in triage).
    project_id: UUID | None
    project_title: str | None
    project_status: str | None
    minutes: int
    locked_minutes: int


class WeeklyRhythmTriageAllocation(BaseModel):
    effective_capacity_hours: float
    project_allocations: dict[str, int]
    inbox_allocation_percent: int


class WeeklyRhythmSummary(BaseModel):
    days: list[WeeklyRhythmDaySummary]
    projects: list[WeeklyRhythmProjectSummary]
    total_schedule_minutes: int
    triage_allocation: WeeklyRhythmTriageAllocation | None


class WeeklyRhythmResponse(BaseModel):
    blocks: list[WeeklyRhythmBlockResponse]
    summary: WeeklyRhythmSummary
    updated_at: datetime | None = None


def _sorted_blocks(session: Session, user_id: UUID) -> list[WeeklyRhythmBlock]:
    return list(
        session.exec(
            select(WeeklyRhythmBlock)
            .where(WeeklyRhythmBlock.user_id == user_id)
            .order_by(
                col(WeeklyRhythmBlock.weekday),
                col(WeeklyRhythmBlock.start_time),
                col(WeeklyRhythmBlock.end_time),
            )
        ).all()
    )


def _union_minutes(intervals: list[tuple[int, int]]) -> int:
    total = 0
    current: tuple[int, int] | None = None
    for start, end in sorted(intervals):
        if current is None or start > current[1]:
            if current is not None:
                total += current[1] - current[0]
            current = (start, end)
        else:
            current = (current[0], max(current[1], end))
    if current is not None:
        total += current[1] - current[0]
    return total


def _overlap_minutes(start: int, end: int, intervals: list[tuple[int, int]]) -> int:
    clipped = [
        (max(start, other_start), min(end, other_end))
        for other_start, other_end in intervals
        if other_start < end and other_end > start
    ]
    return _union_minutes(clipped)


def _schedule_minutes(
    block: WeeklyRhythmBlock, blocked: dict[int, list[tuple[int, int]]]
) -> int:
    """Time a /schedule line offers to tasks: its window minus events and breaks.

    The daily note does not place tasks over fixed events or breaks, so the
    template counts the same way.
    """
    start, end = _minutes(block.start_time), _minutes(block.end_time)
    return end - start - _overlap_minutes(start, end, blocked.get(block.weekday, []))


def _largest_remainder_percent(minutes: dict[str, int]) -> dict[str, int]:
    total = sum(minutes.values())
    if total <= 0:
        return {}
    exact = {
        key: Decimal(value * 100) / Decimal(total) for key, value in minutes.items()
    }
    floors = {key: int(value) for key, value in exact.items()}
    remaining = 100 - sum(floors.values())
    # Ties keep the input order (projects by weekly time, Inbox last).
    order = sorted(exact, key=lambda key: exact[key] - floors[key], reverse=True)
    for key in order[:remaining]:
        floors[key] += 1
    return floors


def _summarize(
    blocks: list[WeeklyRhythmBlock], projects: dict[UUID, Project]
) -> WeeklyRhythmSummary:
    blocked: dict[int, list[tuple[int, int]]] = {}
    events: dict[int, list[tuple[int, int]]] = {}
    breaks: dict[int, list[tuple[int, int]]] = {}
    for block in blocks:
        if block.kind == "schedule":
            continue
        interval = (_minutes(block.start_time), _minutes(block.end_time))
        blocked.setdefault(block.weekday, []).append(interval)
        target = breaks if block.kind == "break" else events
        target.setdefault(block.weekday, []).append(interval)

    day_minutes = dict.fromkeys(range(7), 0)
    project_minutes: dict[UUID | None, int] = {}
    project_locked: dict[UUID | None, int] = {}
    for block in blocks:
        if block.kind != "schedule":
            continue
        minutes = _schedule_minutes(block, blocked)
        day_minutes[block.weekday] += minutes
        project_minutes[block.project_id] = (
            project_minutes.get(block.project_id, 0) + minutes
        )
        if block.locked:
            project_locked[block.project_id] = (
                project_locked.get(block.project_id, 0) + minutes
            )

    days = [
        WeeklyRhythmDaySummary(
            weekday=weekday,
            schedule_minutes=day_minutes[weekday],
            event_minutes=_union_minutes(events.get(weekday, [])),
            break_minutes=_union_minutes(breaks.get(weekday, [])),
        )
        for weekday in range(7)
    ]
    # Projects by weekly time; /schedule lines without a project come last.
    ordered = sorted(
        (key for key in project_minutes if key is not None),
        key=lambda key: (-project_minutes[key], str(key)),
    )
    if None in project_minutes:
        ordered.append(None)
    project_rows = [
        WeeklyRhythmProjectSummary(
            project_id=key,
            project_title=projects[key].title if key in projects else None,
            project_status=(str(projects[key].status) if key in projects else None),
            minutes=project_minutes[key],
            locked_minutes=project_locked.get(key, 0),
        )
        for key in ordered
    ]
    total = sum(project_minutes.values())

    allocation: WeeklyRhythmTriageAllocation | None = None
    if total > 0:
        percents = _largest_remainder_percent(
            {str(key) if key else "": project_minutes[key] for key in ordered}
        )
        allocation = WeeklyRhythmTriageAllocation(
            effective_capacity_hours=float(_hours(total)),
            project_allocations={
                key: value for key, value in percents.items() if key and value > 0
            },
            inbox_allocation_percent=percents.get("", 0),
        )
    return WeeklyRhythmSummary(
        days=days,
        projects=project_rows,
        total_schedule_minutes=total,
        triage_allocation=allocation,
    )


def _hours(minutes: int) -> Decimal:
    return (Decimal(minutes) / Decimal(60)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def _owned_projects(
    session: Session, user_id: UUID, project_ids: set[UUID]
) -> dict[UUID, Project]:
    if not project_ids:
        return {}
    rows = session.exec(
        select(Project).where(
            Project.owner_id == user_id,
            col(Project.id).in_(project_ids),
        )
    ).all()
    return {project.id: project for project in rows if project.id is not None}


def _response(session: Session, user_id: UUID) -> WeeklyRhythmResponse:
    blocks = _sorted_blocks(session, user_id)
    projects = _owned_projects(
        session,
        user_id,
        {block.project_id for block in blocks if block.project_id is not None},
    )
    return WeeklyRhythmResponse(
        blocks=[
            WeeklyRhythmBlockResponse(
                id=block.id,
                weekday=block.weekday,
                start=_clock(block.start_time),
                end=_clock(block.end_time),
                kind=block.kind,  # type: ignore[arg-type]
                title=block.title,
                project_id=block.project_id,
                work_type=block.work_type,  # type: ignore[arg-type]
                locked=block.locked,
            )
            for block in blocks
        ],
        summary=_summarize(blocks, projects),
        updated_at=max((block.updated_at for block in blocks), default=None),
    )


def _validate_days(blocks: list[WeeklyRhythmBlockInput]) -> None:
    """Reject overlapping /schedule lines on the same weekday.

    The note counts overlapping windows once, so overlapping lines would make
    the weekly totals (and the triage allocation) disagree with the note.
    Fixed events and breaks may sit inside a /schedule line.
    """
    by_day: dict[int, list[WeeklyRhythmBlockInput]] = {}
    for block in blocks:
        by_day.setdefault(block.weekday, []).append(block)
    for weekday, day_blocks in by_day.items():
        label = WEEKDAY_LABELS[weekday]
        if len(day_blocks) > MAX_BLOCKS_PER_DAY:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label}の枠は{MAX_BLOCKS_PER_DAY}件までです",
            )
        schedules = sorted(
            (block for block in day_blocks if block.kind == "schedule"),
            key=lambda block: (block.start, block.end),
        )
        for previous, current in zip(schedules, schedules[1:], strict=False):
            if current.start < previous.end:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"{label}の予定枠 {previous.start}-{previous.end} と "
                        f"{current.start}-{current.end} が重なっています"
                    ),
                )


@router.get("", response_model=WeeklyRhythmResponse)
async def get_weekly_rhythm(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> WeeklyRhythmResponse:
    """Get the current user's weekday template and its weekly totals."""
    return _response(session, UUID(str(user_id)))


@router.put("", response_model=WeeklyRhythmResponse)
async def replace_weekly_rhythm(
    request: WeeklyRhythmUpdate,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> WeeklyRhythmResponse:
    """Replace the whole weekday template. An empty list clears it."""
    owner_id = UUID(str(user_id))
    _validate_days(request.blocks)
    project_ids = {
        block.project_id for block in request.blocks if block.project_id is not None
    }
    owned = _owned_projects(session, owner_id, project_ids)
    if missing := project_ids - owned.keys():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "プロジェクトが見つかりません: "
                + ", ".join(sorted(str(project_id) for project_id in missing))
            ),
        )

    # Serialize replacements per user. Under READ COMMITTED a concurrent
    # DELETE does not see rows another request inserted, so two PUTs could
    # both survive and merge into one template. SQLite ignores FOR UPDATE.
    session.exec(select(User.id).where(User.id == owner_id).with_for_update()).first()
    now = datetime.now(UTC)
    session.exec(  # type: ignore[call-overload]
        delete(WeeklyRhythmBlock).where(col(WeeklyRhythmBlock.user_id) == owner_id)
    )
    for block in request.blocks:
        session.add(
            WeeklyRhythmBlock(
                user_id=owner_id,
                weekday=block.weekday,
                start_time=_parse_clock(block.start),
                end_time=_parse_clock(block.end),
                kind=block.kind,
                title=block.title,
                project_id=block.project_id,
                work_type=block.work_type,
                locked=block.locked,
                created_at=now,
                updated_at=now,
            )
        )
    session.commit()
    return _response(session, owner_id)


@router.post("/apply-to-triage", response_model=TriageCapacitySettingsResponse)
async def apply_weekly_rhythm_to_triage(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> TriageCapacitySettingsResponse:
    """Set the triage capacity and project allocation from the template.

    The effective triage capacity (weekly capacity minus the meeting buffer)
    becomes the template's weekly /schedule time, so the weekly capacity is
    that time plus the current buffer. Lines without a project go to Inbox.
    Every other triage setting is kept.
    """
    owner_id = UUID(str(user_id))
    rhythm = _response(session, owner_id)
    allocation = rhythm.summary.triage_allocation
    if allocation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="週のリズムに予定枠がありません",
        )
    inactive = [
        row.project_title or str(row.project_id)
        for row in rhythm.summary.projects
        if row.project_id is not None
        and row.project_status != ProjectStatus.IN_PROGRESS
    ]
    if inactive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "進行中ではないプロジェクトの予定枠があります: " + "、".join(inactive)
            ),
        )

    settings = triage_service.get_or_create_settings(session, owner_id)
    buffer = Decimal(str(settings.meeting_buffer_hours))
    weekly_capacity = _hours(rhythm.summary.total_schedule_minutes) + buffer
    if weekly_capacity > MAX_TRIAGE_CAPACITY_HOURS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="週の容量が上限（999.99時間）を超えます。会議バッファを減らしてください",
        )
    return triage_service.update_settings(
        session,
        owner_id,
        TriageCapacitySettingsUpdate(
            weekly_capacity_hours=weekly_capacity,
            meeting_buffer_hours=buffer,
            project_allocations=allocation.project_allocations,
            inbox_allocation_percent=allocation.inbox_allocation_percent,
            work_type_caps={
                key: float(value)
                for key, value in (settings.work_type_caps_json or {}).items()
            },
            cadence_days=settings.cadence_days,
            auto_generate_enabled=settings.auto_generate_enabled,
            use_ai_rank_adjustment=settings.use_ai_rank_adjustment,
        ),
    )
