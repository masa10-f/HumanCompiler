"""
Goal estimates are the sum of their task estimates; project estimates are the
sum of their goal estimates. Cancelled tasks and goals are not counted.
"""

from decimal import Decimal
from uuid import UUID

import pytest
from sqlmodel import Session

from humancompiler_api.auth import AuthUser
from humancompiler_api.models import (
    Goal,
    GoalCreate,
    GoalResponse,
    GoalStatus,
    GoalUpdate,
    ProjectCreate,
    TaskCreate,
    TaskStatus,
    TaskUpdate,
    UserCreate,
)
from humancompiler_api.routers.progress import get_project_progress
from humancompiler_api.services import (
    GoalService,
    ProjectService,
    TaskService,
    UserService,
)


@pytest.fixture
def services():
    return GoalService(), TaskService()


@pytest.fixture
def project(session: Session, test_user_id: UUID):
    UserService().create_user(session, UserCreate(email="t@example.com"), test_user_id)
    return ProjectService().create_project(
        session, ProjectCreate(title="Project"), test_user_id
    )


def _create_goal(session, goal_service, project, owner_id):
    return goal_service.create_goal(
        session, GoalCreate(project_id=project.id, title="Goal"), owner_id
    )


def _create_task(session, task_service, goal, owner_id, estimate, **kwargs):
    return task_service.create_task(
        session,
        TaskCreate(goal_id=goal.id, title="Task", estimate_hours=estimate, **kwargs),
        owner_id,
    )


def _estimate(session: Session, goal_id) -> Decimal:
    session.expire_all()
    return session.get(Goal, goal_id).estimate_hours


def test_goal_without_tasks_has_zero_estimate(session, test_user_id, project, services):
    goal_service, _ = services
    goal = _create_goal(session, goal_service, project, test_user_id)

    assert _estimate(session, goal.id) == Decimal("0")
    assert GoalResponse.model_validate(goal).model_dump()["estimate_hours"] == 0


def test_goal_estimate_follows_task_changes(session, test_user_id, project, services):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id)

    task1 = _create_task(session, task_service, goal, test_user_id, "2")
    task2 = _create_task(session, task_service, goal, test_user_id, "3.5")
    assert _estimate(session, goal.id) == Decimal("5.50")

    task_service.update_task(
        session, task1.id, test_user_id, TaskUpdate(estimate_hours=Decimal("4"))
    )
    assert _estimate(session, goal.id) == Decimal("7.50")

    task_service.delete_task(session, task2.id, test_user_id)
    assert _estimate(session, goal.id) == Decimal("4.00")

    task_service.delete_task(session, task1.id, test_user_id)
    assert _estimate(session, goal.id) == Decimal("0")


def test_cancelled_tasks_are_not_counted(session, test_user_id, project, services):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id)
    _create_task(session, task_service, goal, test_user_id, "2")
    _create_task(
        session, task_service, goal, test_user_id, "1", status=TaskStatus.COMPLETED
    )
    cancelled = _create_task(
        session, task_service, goal, test_user_id, "8", status=TaskStatus.CANCELLED
    )
    assert _estimate(session, goal.id) == Decimal("3.00")

    task_service.update_task(
        session, cancelled.id, test_user_id, TaskUpdate(status=TaskStatus.PENDING)
    )
    assert _estimate(session, goal.id) == Decimal("11.00")


def test_moving_task_moves_its_estimate(session, test_user_id, project, services):
    goal_service, task_service = services
    source = _create_goal(session, goal_service, project, test_user_id)
    target = _create_goal(session, goal_service, project, test_user_id)
    moving = _create_task(session, task_service, source, test_user_id, "3")
    _create_task(session, task_service, source, test_user_id, "1")

    task_service.update_task(
        session, moving.id, test_user_id, TaskUpdate(goal_id=target.id)
    )

    assert _estimate(session, source.id) == Decimal("1.00")
    assert _estimate(session, target.id) == Decimal("3.00")


def test_goal_estimate_cannot_be_set_directly(session, test_user_id, project, services):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id)
    _create_task(session, task_service, goal, test_user_id, "3")

    # Older clients may still send an estimate; it is ignored.
    goal_service.update_goal(
        session,
        goal.id,
        test_user_id,
        GoalUpdate.model_validate({"title": "Renamed", "estimate_hours": 50}),
    )

    assert _estimate(session, goal.id) == Decimal("3.00")


async def test_project_estimate_is_sum_of_non_cancelled_goals(
    session, test_user_id, project, services
):
    goal_service, task_service = services
    active = _create_goal(session, goal_service, project, test_user_id)
    cancelled = _create_goal(session, goal_service, project, test_user_id)
    _create_goal(session, goal_service, project, test_user_id)  # no tasks
    _create_task(session, task_service, active, test_user_id, "1.5")
    _create_task(session, task_service, active, test_user_id, "2")
    _create_task(session, task_service, cancelled, test_user_id, "5")
    goal_service.update_goal(
        session,
        cancelled.id,
        test_user_id,
        GoalUpdate(status=GoalStatus.CANCELLED),
    )
    session.expire_all()

    # SQLite needs UUID objects where PostgreSQL would accept strings.
    progress = await get_project_progress(
        project.id,
        session,
        AuthUser(user_id=test_user_id, email="t@example.com"),
    )

    estimates = {goal.goal_id: goal.estimate_hours for goal in progress.goals}
    assert estimates[str(active.id)] == Decimal("3.50")
    assert estimates[str(cancelled.id)] == Decimal("5.00")
    assert progress.estimate_hours == Decimal("3.50")
