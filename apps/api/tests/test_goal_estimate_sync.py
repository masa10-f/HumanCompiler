"""
Goal estimates follow the sum of their task estimates.
"""

from decimal import Decimal
from uuid import UUID

import pytest
from sqlmodel import Session

from humancompiler_api.models import (
    Goal,
    GoalCreate,
    GoalUpdate,
    ProjectCreate,
    TaskCreate,
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


def _create_goal(session, goal_service, project, owner_id, estimate="10"):
    return goal_service.create_goal(
        session,
        GoalCreate(project_id=project.id, title="Goal", estimate_hours=estimate),
        owner_id,
    )


def _create_task(session, task_service, goal, owner_id, estimate):
    return task_service.create_task(
        session,
        TaskCreate(goal_id=goal.id, title="Task", estimate_hours=estimate),
        owner_id,
    )


def _stored_estimate(session: Session, goal_id) -> Decimal:
    session.expire_all()
    return session.get(Goal, goal_id).estimate_hours


def test_goal_without_tasks_keeps_its_own_estimate(
    session, test_user_id, project, services
):
    goal_service, _ = services
    goal = _create_goal(session, goal_service, project, test_user_id, "12.5")

    assert _stored_estimate(session, goal.id) == Decimal("12.5")


def test_task_create_update_delete_resync_goal(
    session, test_user_id, project, services
):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id, "10")

    task1 = _create_task(session, task_service, goal, test_user_id, "2")
    assert goal.estimate_hours == Decimal("2.00")
    task2 = _create_task(session, task_service, goal, test_user_id, "3.5")
    assert _stored_estimate(session, goal.id) == Decimal("5.50")

    task_service.update_task(
        session, task1.id, test_user_id, TaskUpdate(estimate_hours=Decimal("4"))
    )
    assert _stored_estimate(session, goal.id) == Decimal("7.50")

    task_service.delete_task(session, task2.id, test_user_id)
    assert _stored_estimate(session, goal.id) == Decimal("4.00")

    # Removing the last task leaves the last total in place.
    task_service.delete_task(session, task1.id, test_user_id)
    assert _stored_estimate(session, goal.id) == Decimal("4.00")


def test_moving_task_resyncs_both_goals(session, test_user_id, project, services):
    goal_service, task_service = services
    source = _create_goal(session, goal_service, project, test_user_id)
    target = _create_goal(session, goal_service, project, test_user_id)
    moving = _create_task(session, task_service, source, test_user_id, "3")
    _create_task(session, task_service, source, test_user_id, "1")
    _create_task(session, task_service, target, test_user_id, "2")

    task_service.update_task(
        session, moving.id, test_user_id, TaskUpdate(goal_id=target.id)
    )

    assert _stored_estimate(session, source.id) == Decimal("1.00")
    assert _stored_estimate(session, target.id) == Decimal("5.00")


def test_goal_with_tasks_ignores_manual_estimate(
    session, test_user_id, project, services
):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id)
    _create_task(session, task_service, goal, test_user_id, "3")

    updated = goal_service.update_goal(
        session, goal.id, test_user_id, GoalUpdate(estimate_hours=Decimal("50"))
    )

    assert updated.estimate_hours == Decimal("3.00")
    assert _stored_estimate(session, goal.id) == Decimal("3.00")


def test_goal_total_can_exceed_single_task_limit(
    session, test_user_id, project, services
):
    goal_service, task_service = services
    goal = _create_goal(session, goal_service, project, test_user_id)
    _create_task(session, task_service, goal, test_user_id, "999")
    _create_task(session, task_service, goal, test_user_id, "500")

    assert _stored_estimate(session, goal.id) == Decimal("1499.00")


@pytest.mark.asyncio
async def test_project_estimate_is_sum_of_goal_estimates(
    session, test_user_id, project, services
):
    from humancompiler_api.auth import AuthUser

    goal_service, task_service = services
    with_tasks = _create_goal(session, goal_service, project, test_user_id, "10")
    _create_goal(session, goal_service, project, test_user_id, "4")
    _create_task(session, task_service, with_tasks, test_user_id, "1.5")
    _create_task(session, task_service, with_tasks, test_user_id, "2")

    # SQLite needs UUID objects where PostgreSQL would accept strings.
    progress = await get_project_progress(
        project.id,
        session,
        AuthUser(user_id=test_user_id, email="t@example.com"),
    )

    goal_estimates = sorted(goal.estimate_hours for goal in progress.goals)
    assert goal_estimates == [Decimal("3.50"), Decimal("4")]
    assert progress.estimate_hours == Decimal("7.50")


def test_moving_expired_task_resyncs_goal_it_leaves(
    session, test_user_id, project, services
):
    goal_service, task_service = services
    source = _create_goal(session, goal_service, project, test_user_id)
    target = _create_goal(session, goal_service, project, test_user_id)
    moving = _create_task(session, task_service, source, test_user_id, "3")
    staying = _create_task(session, task_service, source, test_user_id, "1")
    session.expire_all()

    # Set without loading the old value first, as after any commit.
    moving.goal_id = target.id
    session.add(moving)
    session.commit()

    assert _stored_estimate(session, source.id) == Decimal("1.00")
    assert _stored_estimate(session, target.id) == Decimal("3.00")

    session.expire_all()
    session.delete(staying)
    session.commit()
    assert _stored_estimate(session, source.id) == Decimal("1.00")
