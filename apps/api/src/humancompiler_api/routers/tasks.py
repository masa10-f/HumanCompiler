import logging
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
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
)
from humancompiler_api.services import task_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])
APP_TIMEZONE = ZoneInfo("Asia/Tokyo")
DEPENDENCY_GRAPH_NODE_LIMIT = 200
ACTIONABLE_TASK_STATUSES = {TaskStatus.PENDING, TaskStatus.IN_PROGRESS}


def get_session() -> Generator[Session, None, None]:
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


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
) -> tuple[set[str], set[str]]:
    """Return task IDs in today's daily plan and the current weekly plan."""
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

    today_ids = {
        str(assignment.get("task_id") or assignment.get("taskId"))
        for schedule in daily_schedules
        for assignment in (schedule.plan_json or {}).get("assignments", [])
        if assignment.get("task_id") or assignment.get("taskId")
    }
    week_ids = {
        str(task.get("task_id") or task.get("taskId"))
        for schedule in weekly_schedules
        for task in (schedule.schedule_json or {}).get("selected_tasks", [])
        if task.get("task_id") or task.get("taskId")
    }
    return today_ids, week_ids


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
) -> list[TaskWorkspaceItem]:
    """Hydrate workspace query rows without per-task database calls."""
    if not rows:
        return []

    tasks = [row[0] for row in rows]
    task_ids = [task.id for task in tasks if task.id is not None]
    dependencies = task_service.get_task_dependencies_batch(session, task_ids, owner_id)
    if today_ids is None or week_ids is None:
        today_ids, week_ids = _extract_planned_task_ids(session, owner_id)

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
    if plan is not None:
        today_ids, week_ids = _extract_planned_task_ids(session, current_user.user_id)
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
        today_ids, week_ids = _extract_planned_task_ids(session, current_user.user_id)
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
