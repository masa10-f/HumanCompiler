from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlmodel import select

from conftest import create_test_data
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.models import (
    GoalCreate,
    Log,
    ProjectCreate,
    TaskCreate,
    TaskDependency,
    TaskStatus,
    TaskUpdate,
    TaskWorkspaceSortBy,
    UserCreate,
    WorkSession,
)
from humancompiler_api.routers.tasks import build_workspace_items
from humancompiler_api.services import (
    GoalService,
    ProjectService,
    TaskService,
    UserService,
)


def test_workspace_lists_and_filters_tasks_across_projects(session, test_user_id):
    first = create_test_data(session, test_user_id)
    project_service = ProjectService()
    goal_service = GoalService()
    task_service = TaskService()
    second_project = project_service.create_project(
        session, ProjectCreate(title="Second project"), test_user_id
    )
    second_goal = goal_service.create_goal(
        session,
        GoalCreate(
            project_id=second_project.id,
            title="Second goal",
            estimate_hours=Decimal("8"),
        ),
        test_user_id,
    )
    first_task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=first["goal"].id,
            title="Write workspace tests",
            estimate_hours=Decimal("2"),
            priority=1,
        ),
        test_user_id,
    )
    prerequisite = task_service.create_task(
        session,
        TaskCreate(
            goal_id=second_goal.id,
            title="Prepare fixtures",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    session.add(Log(id=uuid4(), task_id=first_task.id, actual_minutes=30))
    session.add(
        TaskDependency(
            id=uuid4(),
            task_id=first_task.id,
            depends_on_task_id=prerequisite.id,
        )
    )
    session.flush()

    rows, total = task_service.get_workspace_tasks(
        session,
        test_user_id,
        statuses=[TaskStatus.PENDING],
        search="workspace",
        sort_by=TaskWorkspaceSortBy.PRIORITY,
    )
    items = build_workspace_items(session, rows, test_user_id)

    assert total == 1
    assert len(items) == 1
    assert items[0].project_title == first["project"].title
    assert items[0].goal_title == first["goal"].title
    assert items[0].remaining_estimate_hours == Decimal("1.50")
    assert items[0].is_blocked is True
    assert items[0].blocking_task_ids == [prerequisite.id]

    blocked_rows, blocked_total = task_service.get_workspace_tasks(
        session, test_user_id, blocked=True
    )
    assert blocked_total == 1
    assert [row[0].id for row in blocked_rows] == [first_task.id]


def test_moving_task_preserves_related_records(session, test_user_id):
    data = create_test_data(session, test_user_id)
    goal_service = GoalService()
    task_service = TaskService()
    destination = goal_service.create_goal(
        session,
        GoalCreate(
            project_id=data["project"].id,
            title="Destination",
            estimate_hours=Decimal("5"),
        ),
        test_user_id,
    )
    task = task_service.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Movable task",
            estimate_hours=Decimal("2"),
        ),
        test_user_id,
    )
    prerequisite = task_service.create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Prerequisite",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )
    log = Log(id=uuid4(), task_id=task.id, actual_minutes=15)
    dependency = TaskDependency(
        id=uuid4(), task_id=task.id, depends_on_task_id=prerequisite.id
    )
    work_session = WorkSession(
        id=uuid4(),
        user_id=test_user_id,
        task_id=task.id,
        planned_checkout_at=datetime.now(UTC) + timedelta(hours=1),
    )
    session.add(log)
    session.add(dependency)
    session.add(work_session)
    session.flush()

    updated = task_service.update_task(
        session, task.id, test_user_id, TaskUpdate(goal_id=destination.id)
    )

    assert updated.goal_id == destination.id
    assert session.get(Log, log.id).task_id == task.id
    assert session.get(TaskDependency, dependency.id).task_id == task.id
    assert session.get(WorkSession, work_session.id).task_id == task.id


def test_moving_task_rejects_goal_owned_by_another_user(session, test_user_id):
    data = create_test_data(session, test_user_id)
    other_user_id = uuid4()
    UserService().create_user(
        session, UserCreate(email="other@example.com"), other_user_id
    )
    other_project = ProjectService().create_project(
        session, ProjectCreate(title="Other project"), other_user_id
    )
    other_goal = GoalService().create_goal(
        session,
        GoalCreate(
            project_id=other_project.id,
            title="Other goal",
            estimate_hours=Decimal("5"),
        ),
        other_user_id,
    )
    task = TaskService().create_task(
        session,
        TaskCreate(
            goal_id=data["goal"].id,
            title="Owned task",
            estimate_hours=Decimal("1"),
        ),
        test_user_id,
    )

    with pytest.raises(ResourceNotFoundError):
        TaskService().update_task(
            session, task.id, test_user_id, TaskUpdate(goal_id=other_goal.id)
        )

    assert (
        session.exec(select(type(task)).where(type(task).id == task.id)).one().goal_id
        == data["goal"].id
    )
