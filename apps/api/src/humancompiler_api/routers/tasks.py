import json
import logging
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from openai import OpenAI
from pydantic import BaseModel, Field
from sqlmodel import Session, or_, select

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
    TaskDependencyCreate,
    TaskDependency,
    TaskDependencyContext,
    TaskDependencyContextTask,
    TaskDependencyGraphEdge,
    TaskDependencyGraphNode,
    TaskDependencyGraphResponse,
    TaskDependencyResponse,
    TaskDependencyTaskInfo,
    SortBy,
    SortOrder,
    Task,
    TaskRecommendation,
    TaskStatus,
    ProjectStatus,
    TaskWorkspaceItem,
    TaskWorkspacePage,
    TaskWorkspaceSummary,
    TaskWorkspacePlanFilter,
    TaskWorkspaceSortBy,
    Schedule,
    WeeklySchedule,
    Goal,
    Project,
    UserSettings,
)
from humancompiler_api.crypto import get_crypto_service
from humancompiler_api.services import task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])
APP_TIMEZONE = ZoneInfo("Asia/Tokyo")
DEPENDENCY_GRAPH_NODE_LIMIT = 200
ACTIONABLE_TASK_STATUSES = {TaskStatus.PENDING, TaskStatus.IN_PROGRESS}


def get_session() -> Generator[Session, None, None]:
    """Database session dependency."""
    with Session(db.get_engine()) as session:
        yield session


class BulkTaskPatch(BaseModel):
    """Whitelisted fields supported by manual and AI bulk changes."""

    status: TaskStatus | None = None
    priority: int | None = Field(None, ge=1, le=5)
    due_date: datetime | None = None
    goal_id: UUID | None = None


class PlanMembershipMutation(BaseModel):
    scope: Literal["daily", "weekly"]
    action: Literal["add", "remove"]
    target_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class BulkTaskMutation(BaseModel):
    task_id: UUID
    patch: BulkTaskPatch = Field(default_factory=BulkTaskPatch)
    plans: list[PlanMembershipMutation] = Field(default_factory=list, max_length=4)


class BulkTaskRequest(BaseModel):
    mutations: list[BulkTaskMutation] = Field(min_length=1, max_length=100)


class BulkTaskApplyRequest(BulkTaskRequest):
    expected_task_versions: dict[str, str]
    expected_plan_versions: dict[str, str | None] = Field(default_factory=dict)


class BulkFieldDiff(BaseModel):
    field: str
    before: object | None = None
    after: object | None = None


class BulkTaskPreviewItem(BaseModel):
    task_id: UUID
    title: str
    diffs: list[BulkFieldDiff]


class BulkTaskPreviewResponse(BaseModel):
    mutations: list[BulkTaskMutation]
    items: list[BulkTaskPreviewItem]
    affected_count: int
    warnings: list[str] = Field(default_factory=list)
    expected_task_versions: dict[str, str]
    expected_plan_versions: dict[str, str | None]
    interpretation: str | None = None


class NaturalLanguageBulkRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    task_ids: list[UUID] = Field(min_length=1, max_length=100)


def _version_value(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _parse_plan_date(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid plan date") from exc


def _load_bulk_tasks(
    session: Session, owner_id: str | UUID, mutations: list[BulkTaskMutation]
) -> dict[UUID, tuple[Task, Goal, Project]]:
    task_ids = {mutation.task_id for mutation in mutations}
    rows = _owned_task_hierarchy(session, owner_id, task_ids)
    if len(rows) != len(task_ids):
        raise HTTPException(status_code=404, detail="One or more tasks were not found")

    goal_ids = {
        mutation.patch.goal_id
        for mutation in mutations
        if mutation.patch.goal_id is not None
    }
    if goal_ids:
        owned_goal_ids = set(
            session.exec(
                select(Goal.id)
                .join(Project, Goal.project_id == Project.id)
                .where(
                    Project.owner_id == UUID(str(owner_id)),
                    Goal.id.in_(goal_ids),
                )
            ).all()
        )
        if owned_goal_ids != goal_ids:
            raise HTTPException(status_code=404, detail="Target goal was not found")
    return rows


def _get_plan(
    session: Session, owner_id: UUID, scope: str, target_date: str
) -> Schedule | WeeklySchedule | None:
    parsed = _parse_plan_date(target_date)
    model = Schedule if scope == "daily" else WeeklySchedule
    date_column = Schedule.date if scope == "daily" else WeeklySchedule.week_start_date
    return session.exec(
        select(model).where(model.user_id == owner_id, date_column == parsed)
    ).first()


def _plan_key(scope: str, target_date: str) -> str:
    return f"{scope}:{target_date}"


def _daily_members(plan: Schedule | None) -> set[str]:
    payload = (plan.plan_json if plan else {}) or {}
    members = {str(task_id) for task_id in payload.get("planned_task_ids", [])}
    members.update(
        str(item.get("task_id") or item.get("taskId"))
        for item in payload.get("assignments", [])
        if item.get("task_id") or item.get("taskId")
    )
    return members


def _weekly_members(plan: WeeklySchedule | None) -> set[str]:
    payload = (plan.schedule_json if plan else {}) or {}
    members = {str(task_id) for task_id in payload.get("selected_task_ids", [])}
    for item in payload.get("selected_tasks", []):
        if isinstance(item, dict):
            task_id = item.get("task_id") or item.get("taskId")
        else:
            task_id = item
        if task_id:
            members.add(str(task_id))
    return members


def _preview_bulk(
    session: Session,
    owner_id: str | UUID,
    request: BulkTaskRequest,
    *,
    interpretation: str | None = None,
    initial_warnings: list[str] | None = None,
) -> BulkTaskPreviewResponse:
    rows = _load_bulk_tasks(session, owner_id, request.mutations)
    expected_plan_versions: dict[str, str | None] = {}
    items: list[BulkTaskPreviewItem] = []
    warnings = list(initial_warnings or [])
    plan_cache: dict[str, Schedule | WeeklySchedule | None] = {}

    for mutation in request.mutations:
        task, _goal, _project = rows[mutation.task_id]
        diffs: list[BulkFieldDiff] = []
        patch_values = mutation.patch.model_dump(exclude_unset=True)
        for field_name, after in patch_values.items():
            before = getattr(task, field_name)
            before_value = before.value if hasattr(before, "value") else before
            after_value = after.value if hasattr(after, "value") else after
            if str(before_value) != str(after_value):
                diffs.append(
                    BulkFieldDiff(
                        field=field_name, before=before_value, after=after_value
                    )
                )

        for plan_change in mutation.plans:
            key = _plan_key(plan_change.scope, plan_change.target_date)
            if key not in plan_cache:
                plan_cache[key] = _get_plan(
                    session,
                    UUID(str(owner_id)),
                    plan_change.scope,
                    plan_change.target_date,
                )
                plan = plan_cache[key]
                expected_plan_versions[key] = (
                    _version_value(plan.updated_at) if plan else None
                )
            plan = plan_cache[key]
            members = (
                _daily_members(plan if isinstance(plan, Schedule) else None)
                if plan_change.scope == "daily"
                else _weekly_members(plan if isinstance(plan, WeeklySchedule) else None)
            )
            is_member = str(task.id) in members
            after_member = plan_change.action == "add"
            if is_member == after_member:
                warnings.append(
                    f"{task.title}: {plan_change.target_date} の{plan_change.scope}計画は変更不要です"
                )
            else:
                diffs.append(
                    BulkFieldDiff(
                        field=f"plan:{plan_change.scope}:{plan_change.target_date}",
                        before=is_member,
                        after=after_member,
                    )
                )

        items.append(
            BulkTaskPreviewItem(task_id=mutation.task_id, title=task.title, diffs=diffs)
        )

    return BulkTaskPreviewResponse(
        mutations=request.mutations,
        items=items,
        affected_count=sum(bool(item.diffs) for item in items),
        warnings=warnings,
        expected_task_versions={
            str(task_id): _version_value(task.updated_at)
            for task_id, (task, _goal, _project) in rows.items()
        },
        expected_plan_versions=expected_plan_versions,
        interpretation=interpretation,
    )


def _sanitize_ai_bulk_mutations(
    payload: object,
    allowed_task_ids: set[UUID],
    allowed_goal_ids: set[UUID],
) -> tuple[list[BulkTaskMutation], list[str]]:
    """Discard unsafe AI output field-by-field while preserving valid changes."""
    warnings: list[str] = []
    if not isinstance(payload, dict):
        return [], ["AI応答がJSONオブジェクトではないため、変更を破棄しました"]
    raw_mutations = payload.get("mutations", [])
    if not isinstance(raw_mutations, list):
        return [], ["AI応答のmutationsが配列ではないため、変更を破棄しました"]

    allowed_task_id_strings = {str(task_id) for task_id in allowed_task_ids}
    allowed_goal_id_strings = {str(goal_id) for goal_id in allowed_goal_ids}
    merged: dict[str, dict[str, object]] = {}
    allowed_patch_fields = {"status", "priority", "due_date", "goal_id"}
    for index, raw in enumerate(raw_mutations, start=1):
        if not isinstance(raw, dict):
            warnings.append(f"AI変更案{index}: オブジェクトではないため破棄しました")
            continue
        for field_name in set(raw) - {"task_id", "patch", "plans"}:
            warnings.append(f"AI変更案{index}: 未許可項目 {field_name} を破棄しました")
        task_id = str(raw.get("task_id") or "")
        if task_id not in allowed_task_id_strings:
            warnings.append(f"AI変更案{index}: 選択範囲外のタスクIDを破棄しました")
            continue

        clean_patch: dict[str, object] = {}
        raw_patch = raw.get("patch", {})
        if not isinstance(raw_patch, dict):
            warnings.append(f"AI変更案{index}: patchが不正なため破棄しました")
            raw_patch = {}
        for field_name, value in raw_patch.items():
            if field_name not in allowed_patch_fields:
                warnings.append(
                    f"AI変更案{index}: 未許可の変更項目 {field_name} を破棄しました"
                )
                continue
            try:
                validated_patch = BulkTaskPatch.model_validate({field_name: value})
                validated_value = validated_patch.model_dump(exclude_unset=True)[
                    field_name
                ]
            except Exception:
                warnings.append(
                    f"AI変更案{index}: {field_name} の値が不正なため破棄しました"
                )
                continue
            if (
                field_name == "goal_id"
                and str(validated_value) not in allowed_goal_id_strings
            ):
                warnings.append(
                    f"AI変更案{index}: 所有していないゴールIDを破棄しました"
                )
                continue
            clean_patch[field_name] = validated_value

        clean_plans: list[PlanMembershipMutation] = []
        raw_plans = raw.get("plans", [])
        if not isinstance(raw_plans, list):
            warnings.append(f"AI変更案{index}: plansが不正なため破棄しました")
            raw_plans = []
        for plan_index, raw_plan in enumerate(raw_plans, start=1):
            try:
                plan_change = PlanMembershipMutation.model_validate(raw_plan)
                _parse_plan_date(plan_change.target_date)
            except Exception:
                warnings.append(
                    f"AI変更案{index}の計画変更{plan_index}: 値が不正なため破棄しました"
                )
                continue
            if plan_change not in clean_plans:
                clean_plans.append(plan_change)

        if not clean_patch and not clean_plans:
            continue
        target = merged.setdefault(
            task_id,
            {"task_id": task_id, "patch": {}, "plans": []},
        )
        target_patch = target["patch"]
        if isinstance(target_patch, dict):
            target_patch.update(clean_patch)
        target_plans = target["plans"]
        if isinstance(target_plans, list):
            for plan_change in clean_plans:
                serialized = plan_change.model_dump()
                if serialized not in target_plans:
                    target_plans.append(serialized)

    mutations = [BulkTaskMutation.model_validate(item) for item in merged.values()]
    return mutations, warnings


def _apply_daily_membership(
    session: Session,
    owner_id: UUID,
    target_date: str,
    task: Task,
    action: str,
) -> None:
    plan = _get_plan(session, owner_id, "daily", target_date)
    if plan is None:
        plan = Schedule(
            id=uuid4(),
            user_id=owner_id,
            date=_parse_plan_date(target_date),
            plan_json={"assignments": [], "planned_task_ids": []},
        )
    payload = dict(plan.plan_json or {})
    assignments = list(payload.get("assignments", []))
    members = list(dict.fromkeys([*_daily_members(plan), str(task.id)]))
    if action == "remove":
        members = [task_id for task_id in members if task_id != str(task.id)]
        assignments = [
            assignment
            for assignment in assignments
            if str(assignment.get("task_id") or assignment.get("taskId"))
            != str(task.id)
        ]
    payload["planned_task_ids"] = members
    payload["assignments"] = assignments
    payload["total_scheduled_hours"] = sum(
        float(assignment.get("duration_hours", 0) or 0) for assignment in assignments
    )
    plan.plan_json = payload
    plan.updated_at = datetime.now(UTC)
    session.add(plan)


def _apply_weekly_membership(
    session: Session,
    owner_id: UUID,
    target_date: str,
    task: Task,
    action: str,
) -> None:
    plan = _get_plan(session, owner_id, "weekly", target_date)
    if plan is None:
        plan = WeeklySchedule(
            id=uuid4(),
            user_id=owner_id,
            week_start_date=_parse_plan_date(target_date),
            schedule_json={"selected_tasks": [], "assigned_task_hours": {}},
        )
    payload = dict(plan.schedule_json or {})
    selected = list(payload.get("selected_tasks", []))
    assigned = dict(payload.get("assigned_task_hours", {}))
    pinned = list(payload.get("pinned_task_ids", []))
    selected = [
        item
        for item in selected
        if str(
            (item.get("task_id") or item.get("taskId"))
            if isinstance(item, dict)
            else item
        )
        != str(task.id)
    ]
    if action == "add":
        selected.append(
            {
                "task_id": str(task.id),
                "task_title": task.title,
                "estimated_hours": float(task.estimate_hours),
                "priority": task.priority,
                "rationale": "タスクワークスペースから手動追加",
            }
        )
        assigned[str(task.id)] = float(task.estimate_hours)
    else:
        assigned.pop(str(task.id), None)
        pinned = [task_id for task_id in pinned if str(task_id) != str(task.id)]
    payload["selected_tasks"] = selected
    if "selected_task_ids" in payload:
        payload["selected_task_ids"] = [
            str(item.get("task_id") or item.get("taskId"))
            if isinstance(item, dict)
            else str(item)
            for item in selected
        ]
    payload["assigned_task_hours"] = assigned
    payload["pinned_task_ids"] = pinned
    payload["total_allocated_hours"] = sum(float(value) for value in assigned.values())
    plan.schedule_json = payload
    plan.updated_at = datetime.now(UTC)
    session.add(plan)


@router.post("/bulk/preview", response_model=BulkTaskPreviewResponse)
async def preview_bulk_task_changes(
    request: BulkTaskRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> BulkTaskPreviewResponse:
    """Validate a bulk change and return its exact, non-mutating diff."""
    return _preview_bulk(session, current_user.user_id, request)


@router.post("/bulk/apply", response_model=BulkTaskPreviewResponse)
async def apply_bulk_task_changes(
    request: BulkTaskApplyRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> BulkTaskPreviewResponse:
    """Apply a previously previewed bulk change atomically."""
    owner_id = UUID(str(current_user.user_id))
    preview_request = BulkTaskRequest(mutations=request.mutations)
    preview = _preview_bulk(session, owner_id, preview_request)
    if preview.expected_task_versions != request.expected_task_versions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more tasks changed after the preview",
        )
    if preview.expected_plan_versions != request.expected_plan_versions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A daily or weekly plan changed after the preview",
        )

    rows = _load_bulk_tasks(session, owner_id, request.mutations)
    now = datetime.now(UTC)
    try:
        for mutation in request.mutations:
            task = rows[mutation.task_id][0]
            for field_name, value in mutation.patch.model_dump(
                exclude_unset=True
            ).items():
                setattr(task, field_name, value)
            if mutation.patch.model_fields_set:
                task.updated_at = now
                session.add(task)

            for plan_change in mutation.plans:
                existing = _get_plan(
                    session,
                    owner_id,
                    plan_change.scope,
                    plan_change.target_date,
                )
                members = (
                    _daily_members(existing if isinstance(existing, Schedule) else None)
                    if plan_change.scope == "daily"
                    else _weekly_members(
                        existing if isinstance(existing, WeeklySchedule) else None
                    )
                )
                should_add = plan_change.action == "add"
                if (str(task.id) in members) == should_add:
                    continue
                if plan_change.scope == "daily":
                    _apply_daily_membership(
                        session,
                        owner_id,
                        plan_change.target_date,
                        task,
                        plan_change.action,
                    )
                else:
                    _apply_weekly_membership(
                        session,
                        owner_id,
                        plan_change.target_date,
                        task,
                        plan_change.action,
                    )
        session.commit()
    except Exception:
        session.rollback()
        raise

    return preview


@router.post("/bulk/natural-language/preview", response_model=BulkTaskPreviewResponse)
async def preview_natural_language_bulk_changes(
    request: NaturalLanguageBulkRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> BulkTaskPreviewResponse:
    """Translate a bounded natural-language instruction into a safe bulk preview."""
    owner_id = UUID(str(current_user.user_id))
    placeholder_mutations = [
        BulkTaskMutation(task_id=task_id) for task_id in request.task_ids
    ]
    rows = _load_bulk_tasks(session, owner_id, placeholder_mutations)
    settings = session.exec(
        select(UserSettings).where(UserSettings.user_id == owner_id)
    ).first()
    if not settings or not settings.openai_api_key_encrypted:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API key is not configured",
        )
    try:
        api_key = get_crypto_service().decrypt(settings.openai_api_key_encrypted)
        if not api_key:
            raise ValueError("OpenAI API key could not be decrypted")
        goals = session.exec(
            select(Goal, Project)
            .join(Project, Goal.project_id == Project.id)
            .where(Project.owner_id == owner_id)
        ).all()
        allowed_goal_ids = {goal.id for goal, _project in goals if goal.id is not None}
        client = OpenAI(api_key=api_key, timeout=30.0)
        model = settings.openai_model or "gpt-5.5"
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Return JSON only. Never invent task or goal IDs. Only use the "
                        "allowed fields and task IDs supplied by the user. Omit unchanged tasks."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "instruction": request.instruction,
                            "today_jst": datetime.now(UTC)
                            .astimezone(APP_TIMEZONE)
                            .date()
                            .isoformat(),
                            "schema": {
                                "interpretation": "short Japanese summary",
                                "mutations": [
                                    {
                                        "task_id": "one supplied UUID",
                                        "patch": {
                                            "status": "pending|in_progress|completed|cancelled",
                                            "priority": "integer 1..5",
                                            "due_date": "ISO datetime or null",
                                            "goal_id": "one supplied goal UUID",
                                        },
                                        "plans": [
                                            {
                                                "scope": "daily|weekly",
                                                "action": "add|remove",
                                                "target_date": "YYYY-MM-DD",
                                            }
                                        ],
                                    }
                                ],
                            },
                            "tasks": [
                                {
                                    "id": str(task.id),
                                    "title": task.title,
                                    "status": task.status.value,
                                    "priority": task.priority,
                                    "due_date": task.due_date.isoformat()
                                    if task.due_date
                                    else None,
                                    "goal_id": str(task.goal_id),
                                }
                                for task, _goal, _project in rows.values()
                            ],
                            "goals": [
                                {
                                    "id": str(goal.id),
                                    "title": goal.title,
                                    "project": project.title,
                                }
                                for goal, project in goals
                            ],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=2500,
            **(
                {"reasoning_effort": "high"}
                if model.startswith(("gpt-5.5", "gpt-5.4"))
                else {}
            ),
        )
        payload = json.loads(response.choices[0].message.content or "{}")
        mutations, ai_warnings = _sanitize_ai_bulk_mutations(
            payload,
            set(request.task_ids),
            allowed_goal_ids,
        )
        if not mutations:
            mutations = [
                BulkTaskMutation(task_id=task_id)
                for task_id in dict.fromkeys(request.task_ids)
            ]
        bulk_request = BulkTaskRequest(mutations=mutations)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Natural language bulk preview failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI instruction could not be converted into safe changes",
        ) from exc

    return _preview_bulk(
        session,
        owner_id,
        bulk_request,
        interpretation=str(
            payload.get("interpretation")
            if isinstance(payload, dict) and payload.get("interpretation")
            else request.instruction
        )[:1000],
        initial_warnings=ai_warnings,
    )


def build_task_responses_with_dependencies(
    session: Session, tasks: list[Task], owner_id: str | UUID
) -> list[TaskResponse]:
    """Build task responses with batch-loaded dependencies."""
    if not tasks:
        return []

    task_ids = [task.id for task in tasks]
    deps_by_task = task_service.get_task_dependencies_batch(session, task_ids, owner_id)

    task_responses = []
    for task in tasks:
        task_response = TaskResponse.model_validate(task)

        dependencies = deps_by_task.get(str(task.id), [])
        dependency_responses = []
        for dep in dependencies:
            dep_response = TaskDependencyResponse.model_validate(dep)
            if dep.depends_on_task:
                dep_response.depends_on_task = TaskDependencyTaskInfo.model_validate(
                    dep.depends_on_task
                )
            dependency_responses.append(dep_response)

        task_response.dependencies = dependency_responses
        task_responses.append(task_response)

    return task_responses


def _plan_date_windows(
    now: datetime | None = None,
) -> tuple[datetime, datetime, datetime, datetime]:
    """Return naive date boundaries matching stored JST schedule dates."""
    instant = now or datetime.now(UTC)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    local_date = instant.astimezone(APP_TIMEZONE).date()
    day_start = datetime.combine(local_date, datetime.min.time())
    day_end = day_start + timedelta(days=1)
    week_start = day_start - timedelta(days=day_start.weekday())
    week_end = week_start + timedelta(days=7)
    return day_start, day_end, week_start, week_end


def _extract_planned_task_ids(
    session: Session, owner_id: str | UUID
) -> tuple[set[str], set[str], set[str]]:
    """Return today's plan IDs, weekly IDs, and today's placed assignment IDs."""
    owner_uuid = UUID(str(owner_id))
    day_start, day_end, week_start, week_end = _plan_date_windows()

    daily_schedules = session.exec(
        select(Schedule).where(
            Schedule.user_id == owner_uuid,
            Schedule.date >= day_start,
            Schedule.date < day_end,
        )
    ).all()
    weekly_schedules = session.exec(
        select(WeeklySchedule).where(
            WeeklySchedule.user_id == owner_uuid,
            WeeklySchedule.week_start_date >= week_start,
            WeeklySchedule.week_start_date < week_end,
        )
    ).all()

    placed_today_ids = {
        str(assignment.get("task_id") or assignment.get("taskId"))
        for schedule in daily_schedules
        for assignment in (schedule.plan_json or {}).get("assignments", [])
        if assignment.get("task_id") or assignment.get("taskId")
    }
    today_ids = set(placed_today_ids)
    today_ids.update(
        str(task_id)
        for schedule in daily_schedules
        for task_id in (schedule.plan_json or {}).get("planned_task_ids", [])
        if task_id
    )
    week_ids = {
        str(task.get("task_id") or task.get("taskId"))
        for schedule in weekly_schedules
        for task in (schedule.schedule_json or {}).get("selected_tasks", [])
        if task.get("task_id") or task.get("taskId")
    }
    return today_ids, week_ids, placed_today_ids


def _valid_task_uuids(task_ids: set[str]) -> set[UUID]:
    """Return valid UUIDs from stored plan payloads, ignoring stale invalid IDs."""
    valid_ids: set[UUID] = set()
    for task_id in task_ids:
        try:
            valid_ids.add(UUID(task_id))
        except ValueError:
            logger.warning("Ignoring invalid task ID in saved plan: %s", task_id)
    return valid_ids


def _dependency_state(
    task: Task, dependencies: list[TaskDependency]
) -> tuple[bool, bool, list[UUID]]:
    """Return ready, blocked and blocker IDs using the canonical task rule."""
    blocking_task_ids = [
        dependency.depends_on_task.id
        for dependency in dependencies
        if dependency.depends_on_task
        and dependency.depends_on_task.status != TaskStatus.COMPLETED
        and dependency.depends_on_task.id is not None
    ]
    is_blocked = bool(blocking_task_ids)
    is_ready = task.status in ACTIONABLE_TASK_STATUSES and not is_blocked
    return is_ready, is_blocked, blocking_task_ids


def _owned_task_hierarchy(
    session: Session, owner_id: str | UUID, task_ids: set[UUID]
) -> dict[UUID, tuple[Task, Goal, Project]]:
    """Load owned tasks and their hierarchy in one query."""
    if not task_ids:
        return {}
    rows = session.exec(
        select(Task, Goal, Project)
        .join(Goal, Task.goal_id == Goal.id)
        .join(Project, Goal.project_id == Project.id)
        .where(Project.owner_id == UUID(str(owner_id)), Task.id.in_(task_ids))
    ).all()
    return {task.id: (task, goal, project) for task, goal, project in rows if task.id}


def _context_task(
    task: Task,
    goal: Goal,
    project: Project,
    dependencies: list[TaskDependency],
) -> TaskDependencyContextTask:
    is_ready, is_blocked, _ = _dependency_state(task, dependencies)
    return TaskDependencyContextTask(
        id=task.id,
        title=task.title,
        status=task.status,
        project_id=project.id,
        project_title=project.title,
        goal_id=goal.id,
        goal_title=goal.title,
        is_ready=is_ready,
        is_blocked=is_blocked,
    )


def build_workspace_items(
    session: Session,
    rows: list[tuple[Task, object, object, int, datetime | None]],
    owner_id: str | UUID,
    today_ids: set[str] | None = None,
    week_ids: set[str] | None = None,
    placed_today_ids: set[str] | None = None,
) -> list[TaskWorkspaceItem]:
    """Hydrate workspace query rows without per-task database calls."""
    if not rows:
        return []

    tasks = [row[0] for row in rows]
    task_ids = [task.id for task in tasks if task.id is not None]
    dependencies = task_service.get_task_dependencies_batch(session, task_ids, owner_id)
    if today_ids is None or week_ids is None or placed_today_ids is None:
        today_ids, week_ids, placed_today_ids = _extract_planned_task_ids(
            session, owner_id
        )

    items: list[TaskWorkspaceItem] = []
    for task, goal, project, actual_minutes, last_worked_at in rows:
        task_response = TaskResponse.model_validate(task)
        task_dependencies = dependencies.get(str(task.id), [])
        dependency_responses = []
        for dependency in task_dependencies:
            dependency_response = TaskDependencyResponse.model_validate(dependency)
            if dependency.depends_on_task:
                dependency_response.depends_on_task = (
                    TaskDependencyTaskInfo.model_validate(dependency.depends_on_task)
                )
            dependency_responses.append(dependency_response)

        task_response.dependencies = dependency_responses
        is_ready, is_blocked, blocking_task_ids = _dependency_state(
            task, task_dependencies
        )
        remaining = max(
            Decimal("0"),
            task.estimate_hours - (Decimal(str(actual_minutes)) / Decimal("60")),
        )
        items.append(
            TaskWorkspaceItem(
                **task_response.model_dump(),
                project_id=project.id,
                project_title=project.title,
                goal_title=goal.title,
                remaining_estimate_hours=remaining.quantize(Decimal("0.01")),
                is_blocked=is_blocked,
                is_ready=is_ready,
                blocking_task_ids=blocking_task_ids,
                last_worked_at=last_worked_at,
                planned_today=str(task.id) in today_ids,
                planned_today_unplaced=(
                    str(task.id) in today_ids and str(task.id) not in placed_today_ids
                ),
                planned_this_week=str(task.id) in week_ids,
            )
        )
    return items


@router.get("/", response_model=TaskWorkspacePage)
@router.get("", response_model=TaskWorkspacePage, include_in_schema=False)
async def get_task_workspace(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    task_statuses: Annotated[list[TaskStatus] | None, Query(alias="status")] = None,
    project_id: UUID | None = None,
    project_status: ProjectStatus | None = None,
    goal_id: UUID | None = None,
    due_before: datetime | None = None,
    due_after: datetime | None = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    blocked: bool | None = None,
    plan: TaskWorkspacePlanFilter | None = None,
    sort_by: TaskWorkspaceSortBy = TaskWorkspaceSortBy.DUE_DATE,
    sort_order: SortOrder = SortOrder.ASC,
) -> TaskWorkspacePage:
    """List tasks across all owned projects using one filtered, paginated query."""
    included_task_ids: set[UUID] | None = None
    excluded_task_ids: set[UUID] | None = None
    today_ids: set[str] | None = None
    week_ids: set[str] | None = None
    placed_today_ids: set[str] | None = None
    if plan is not None:
        today_ids, week_ids, placed_today_ids = _extract_planned_task_ids(
            session, current_user.user_id
        )
        if plan == TaskWorkspacePlanFilter.TODAY:
            included_task_ids = _valid_task_uuids(today_ids)
        elif plan == TaskWorkspacePlanFilter.WEEK:
            included_task_ids = _valid_task_uuids(week_ids)
        else:
            excluded_task_ids = _valid_task_uuids(today_ids | week_ids)

    rows, total = task_service.get_workspace_tasks(
        session,
        current_user.user_id,
        skip=skip,
        limit=limit,
        statuses=task_statuses,
        project_id=project_id,
        project_status=project_status,
        goal_id=goal_id,
        due_before=due_before,
        due_after=due_after,
        search=search,
        blocked=blocked,
        included_task_ids=included_task_ids,
        excluded_task_ids=excluded_task_ids,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return TaskWorkspacePage(
        items=build_workspace_items(
            session,
            rows,
            current_user.user_id,
            today_ids=today_ids,
            week_ids=week_ids,
            placed_today_ids=placed_today_ids,
        ),
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/summary", response_model=TaskWorkspaceSummary)
async def get_task_workspace_summary(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    project_id: UUID | None = None,
    goal_id: UUID | None = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
) -> TaskWorkspaceSummary:
    """Return decision-oriented counts for the current workspace scope."""
    counts = task_service.get_workspace_summary_counts(
        session,
        current_user.user_id,
        project_id=project_id,
        goal_id=goal_id,
        search=search,
    )
    return TaskWorkspaceSummary(**counts)


@router.get("/dependency-graph", response_model=TaskDependencyGraphResponse)
async def get_task_dependency_graph(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    task_statuses: Annotated[list[TaskStatus] | None, Query(alias="status")] = None,
    project_id: UUID | None = None,
    goal_id: UUID | None = None,
    due_before: datetime | None = None,
    due_after: datetime | None = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    blocked: bool | None = None,
    plan: TaskWorkspacePlanFilter | None = None,
) -> TaskDependencyGraphResponse:
    """Return a bounded filtered graph plus directly connected context tasks."""
    included_task_ids: set[UUID] | None = None
    excluded_task_ids: set[UUID] | None = None
    if plan is not None:
        today_ids, week_ids, _placed_today_ids = _extract_planned_task_ids(
            session, current_user.user_id
        )
        if plan == TaskWorkspacePlanFilter.TODAY:
            included_task_ids = _valid_task_uuids(today_ids)
        elif plan == TaskWorkspacePlanFilter.WEEK:
            included_task_ids = _valid_task_uuids(week_ids)
        else:
            excluded_task_ids = _valid_task_uuids(today_ids | week_ids)

    tasks, total = task_service.get_workspace_graph_tasks(
        session,
        current_user.user_id,
        limit=DEPENDENCY_GRAPH_NODE_LIMIT + 1,
        statuses=task_statuses,
        project_id=project_id,
        goal_id=goal_id,
        due_before=due_before,
        due_after=due_after,
        search=search,
        blocked=blocked,
        included_task_ids=included_task_ids,
        excluded_task_ids=excluded_task_ids,
    )
    if total > DEPENDENCY_GRAPH_NODE_LIMIT:
        return TaskDependencyGraphResponse(
            total=total,
            node_count=total,
            exceeds_limit=True,
            limit=DEPENDENCY_GRAPH_NODE_LIMIT,
        )

    root_ids = {task.id for task in tasks if task.id}
    if not root_ids:
        return TaskDependencyGraphResponse(total=0, node_count=0)

    connected_dependencies = list(
        session.exec(
            select(TaskDependency).where(
                or_(
                    TaskDependency.task_id.in_(root_ids),
                    TaskDependency.depends_on_task_id.in_(root_ids),
                )
            )
        ).all()
    )
    node_ids = set(root_ids)
    for dependency in connected_dependencies:
        node_ids.add(dependency.task_id)
        node_ids.add(dependency.depends_on_task_id)

    if len(node_ids) > DEPENDENCY_GRAPH_NODE_LIMIT:
        return TaskDependencyGraphResponse(
            total=total,
            node_count=len(node_ids),
            exceeds_limit=True,
            limit=DEPENDENCY_GRAPH_NODE_LIMIT,
        )

    hierarchy = _owned_task_hierarchy(session, current_user.user_id, node_ids)
    owned_node_ids = set(hierarchy)
    dependencies_by_task = task_service.get_task_dependencies_batch(
        session, list(owned_node_ids), current_user.user_id
    )
    nodes: list[TaskDependencyGraphNode] = []
    for task_id, (task, goal, project) in hierarchy.items():
        context = _context_task(
            task, goal, project, dependencies_by_task.get(str(task_id), [])
        )
        nodes.append(
            TaskDependencyGraphNode(
                **context.model_dump(),
                priority=task.priority,
                due_date=task.due_date,
                is_context=task_id not in root_ids,
            )
        )

    edges = [
        TaskDependencyGraphEdge(
            id=dependency.id,
            prerequisite_task_id=dependency.depends_on_task_id,
            dependent_task_id=dependency.task_id,
            prerequisite_status=hierarchy[dependency.depends_on_task_id][0].status,
        )
        for dependency in connected_dependencies
        if dependency.id
        and dependency.task_id in owned_node_ids
        and dependency.depends_on_task_id in owned_node_ids
    ]
    return TaskDependencyGraphResponse(
        nodes=nodes,
        edges=edges,
        total=total,
        node_count=len(nodes),
        limit=DEPENDENCY_GRAPH_NODE_LIMIT,
    )


@router.get("/recommendations", response_model=list[TaskRecommendation])
async def get_task_recommendations(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[TaskRecommendation]:
    """Return up to three deterministic, read-only next-task recommendations."""
    rows, _ = task_service.get_workspace_tasks(
        session,
        current_user.user_id,
        limit=100,
        statuses=[TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        sort_by=TaskWorkspaceSortBy.PRIORITY,
    )
    items = build_workspace_items(session, rows, current_user.user_id)
    now = datetime.now(UTC)
    recommendations: list[TaskRecommendation] = []
    for item in items:
        if item.is_blocked:
            continue

        score = (6 - item.priority) * 20
        reasons = [f"優先度が{item.priority}"]
        if item.status == TaskStatus.IN_PROGRESS:
            score += 20
            reasons.append("すでに作業中")
        if item.planned_today:
            score += 30
            reasons.append("今日の計画に登録済み")
        elif item.planned_this_week:
            score += 10
            reasons.append("今週の計画に登録済み")
        if item.due_date:
            due_date = item.due_date
            if due_date.tzinfo is None:
                due_date = due_date.replace(tzinfo=UTC)
            days = (due_date - now).total_seconds() / 86400
            if days < 0:
                score += 50
                reasons.append("期限超過")
            elif days <= 1:
                score += 40
                reasons.append("期限まで24時間以内")
            elif days <= 3:
                score += 25
                reasons.append("期限まで3日以内")
            elif days <= 7:
                score += 10
                reasons.append("期限まで1週間以内")
        recommendations.append(
            TaskRecommendation(task=item, score=score, reason="、".join(reasons))
        )

    return sorted(recommendations, key=lambda item: item.score, reverse=True)[:3]


@router.post(
    "/",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
@router.post(
    "",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def create_task(
    task_data: TaskCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Create a new task"""
    task = task_service.create_task(session, task_data, current_user.user_id)
    logger.info("Created task %s for user %s", task.id, current_user.user_id)
    return TaskResponse.model_validate(task)


@router.get(
    "/goal/{goal_id}",
    response_model=list[TaskResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Goal not found"},
    },
)
async def get_tasks_by_goal(
    goal_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    sort_by: Annotated[SortBy, Query()] = SortBy.STATUS,
    sort_order: Annotated[SortOrder, Query()] = SortOrder.ASC,
) -> list[TaskResponse]:
    """Get tasks for specific goal"""
    tasks = task_service.get_tasks_by_goal(
        session, goal_id, current_user.user_id, skip, limit, sort_by, sort_order
    )
    return build_task_responses_with_dependencies(session, tasks, current_user.user_id)


@router.get(
    "/project/{project_id}",
    response_model=list[TaskResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Project not found"},
    },
)
async def get_tasks_by_project(
    project_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    sort_by: Annotated[SortBy, Query()] = SortBy.STATUS,
    sort_order: Annotated[SortOrder, Query()] = SortOrder.ASC,
) -> list[TaskResponse]:
    """Get all tasks for specific project"""
    tasks = task_service.get_tasks_by_project(
        session, project_id, current_user.user_id, skip, limit, sort_by, sort_order
    )
    return build_task_responses_with_dependencies(session, tasks, current_user.user_id)


@router.get(
    "/{task_id}",
    response_model=TaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def get_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Get specific task"""
    task = task_service.get_task(session, task_id, current_user.user_id)
    # Get dependencies for the task
    task_response = TaskResponse.model_validate(task)
    dependencies = task_service.get_task_dependencies(
        session, task_id, current_user.user_id
    )
    task_response.dependencies = [
        TaskDependencyResponse.model_validate(dep) for dep in dependencies
    ]
    return task_response


@router.get(
    "/{task_id}/dependency-context",
    response_model=TaskDependencyContext,
    responses={404: {"model": ErrorResponse, "description": "Task not found"}},
)
async def get_task_dependency_context(
    task_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskDependencyContext:
    """Return prerequisite and dependent tasks with hierarchy information."""
    task_service.get_task(session, task_id, current_user.user_id)

    relationships = list(
        session.exec(
            select(TaskDependency).where(
                or_(
                    TaskDependency.task_id == task_id,
                    TaskDependency.depends_on_task_id == task_id,
                )
            )
        ).all()
    )
    related_ids = {task_id}
    for relationship in relationships:
        related_ids.add(relationship.task_id)
        related_ids.add(relationship.depends_on_task_id)

    hierarchy = _owned_task_hierarchy(session, current_user.user_id, related_ids)
    dependencies_by_task = task_service.get_task_dependencies_batch(
        session, list(hierarchy), current_user.user_id
    )

    def to_context(related_task_id: UUID) -> TaskDependencyContextTask | None:
        row = hierarchy.get(related_task_id)
        if not row:
            return None
        related_task, goal, project = row
        return _context_task(
            related_task,
            goal,
            project,
            dependencies_by_task.get(str(related_task_id), []),
        )

    prerequisites = [
        context
        for relationship in relationships
        if relationship.task_id == task_id
        and (context := to_context(relationship.depends_on_task_id)) is not None
    ]
    dependents = [
        context
        for relationship in relationships
        if relationship.depends_on_task_id == task_id
        and (context := to_context(relationship.task_id)) is not None
    ]
    return TaskDependencyContext(
        prerequisites=prerequisites,
        dependents=dependents,
    )


@router.put(
    "/{task_id}",
    response_model=TaskResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def update_task(
    task_id: str,
    task_data: TaskUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskResponse:
    """Update specific task"""
    task = task_service.update_task(session, task_id, current_user.user_id, task_data)
    return TaskResponse.model_validate(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def delete_task(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete specific task"""
    task_service.delete_task(session, task_id, current_user.user_id)


@router.post(
    "/{task_id}/dependencies",
    response_model=TaskDependencyResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
        400: {"model": ErrorResponse, "description": "Invalid dependency"},
    },
)
async def add_task_dependency(
    task_id: str,
    dependency_data: TaskDependencyCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskDependencyResponse:
    """Add a dependency to a task"""
    dependency = task_service.add_task_dependency(
        session, task_id, dependency_data.depends_on_task_id, current_user.user_id
    )
    # Load the depends_on_task for the response
    depends_on_task = task_service.get_task(
        session, dependency.depends_on_task_id, current_user.user_id
    )
    dependency_response = TaskDependencyResponse.model_validate(dependency)
    if depends_on_task:
        dependency_response.depends_on_task = TaskDependencyTaskInfo.model_validate(
            depends_on_task
        )
    return dependency_response


@router.get(
    "/{task_id}/dependencies",
    response_model=list[TaskDependencyResponse],
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
)
async def get_task_dependencies(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[TaskDependencyResponse]:
    """Get all dependencies for a task"""
    dependencies = task_service.get_task_dependencies(
        session, task_id, current_user.user_id
    )
    return [TaskDependencyResponse.model_validate(dep) for dep in dependencies]


@router.delete(
    "/{task_id}/dependencies/{dependency_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Dependency not found"},
    },
)
async def delete_task_dependency(
    task_id: str,
    dependency_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    """Delete a task dependency"""
    task_service.delete_task_dependency(
        session, task_id, dependency_id, current_user.user_id
    )
