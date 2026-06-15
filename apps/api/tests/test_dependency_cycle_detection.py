from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from humancompiler_api.models import (
    Goal,
    GoalDependency,
    Project,
    Task,
    TaskDependency,
    User,
)
from humancompiler_api.services import GoalService, TaskService


def _create_goal(session: Session, project_id, title: str) -> Goal:
    goal = Goal(
        id=uuid4(),
        project_id=project_id,
        title=title,
        description=f"{title} description",
        estimate_hours=10.0,
    )
    session.add(goal)
    session.commit()
    session.refresh(goal)
    return goal


def _create_task(session: Session, goal_id, title: str) -> Task:
    task = Task(
        id=uuid4(),
        goal_id=goal_id,
        title=title,
        description=f"{title} description",
        estimate_hours=2.0,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@pytest.fixture
def dependency_graph_data(session: Session):
    user = User(id=uuid4(), email="dependency-cycles@example.com")
    project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="Dependency Cycle Project",
        description="Project for dependency cycle tests",
    )
    session.add(user)
    session.add(project)
    session.commit()
    session.refresh(user)
    session.refresh(project)

    goals = [
        _create_goal(session, project.id, "Goal A"),
        _create_goal(session, project.id, "Goal B"),
        _create_goal(session, project.id, "Goal C"),
    ]
    tasks = [
        _create_task(session, goals[0].id, "Task A"),
        _create_task(session, goals[0].id, "Task B"),
        _create_task(session, goals[0].id, "Task C"),
    ]

    return user, goals, tasks


def _assert_circular_dependency_rejected(exc_info):
    assert exc_info.value.status_code == 400
    assert "circular dependency" in exc_info.value.detail


class TestTaskDependencyCycleDetection:
    def test_rejects_two_task_cycle(self, session: Session, dependency_graph_data):
        user, _, tasks = dependency_graph_data
        task_a, task_b, _ = tasks
        service = TaskService()

        service.add_task_dependency(session, task_a.id, task_b.id, user.id)

        with pytest.raises(HTTPException) as exc_info:
            service.add_task_dependency(session, task_b.id, task_a.id, user.id)

        _assert_circular_dependency_rejected(exc_info)

    def test_rejects_transitive_task_cycle(
        self, session: Session, dependency_graph_data
    ):
        user, _, tasks = dependency_graph_data
        task_a, task_b, task_c = tasks
        service = TaskService()

        service.add_task_dependency(session, task_a.id, task_b.id, user.id)
        service.add_task_dependency(session, task_b.id, task_c.id, user.id)

        with pytest.raises(HTTPException) as exc_info:
            service.add_task_dependency(session, task_c.id, task_a.id, user.id)

        _assert_circular_dependency_rejected(exc_info)

    def test_rejects_task_cycle_after_long_dependency_chain(
        self, session: Session, dependency_graph_data
    ):
        user, goals, _ = dependency_graph_data
        tasks = [
            _create_task(session, goals[0].id, f"Long Chain Task {index}")
            for index in range(102)
        ]
        for index in range(len(tasks) - 1):
            session.add(
                TaskDependency(
                    id=uuid4(),
                    task_id=tasks[index].id,
                    depends_on_task_id=tasks[index + 1].id,
                )
            )
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            TaskService().add_task_dependency(
                session, tasks[-1].id, tasks[0].id, user.id
            )

        _assert_circular_dependency_rejected(exc_info)


class TestGoalDependencyCycleDetection:
    def test_rejects_two_goal_cycle(self, session: Session, dependency_graph_data):
        user, goals, _ = dependency_graph_data
        goal_a, goal_b, _ = goals
        service = GoalService()
        session.add(
            GoalDependency(id=uuid4(), goal_id=goal_a.id, depends_on_goal_id=goal_b.id)
        )
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            service.add_goal_dependency(session, goal_b.id, goal_a.id, user.id)

        _assert_circular_dependency_rejected(exc_info)

    def test_rejects_transitive_goal_cycle(
        self, session: Session, dependency_graph_data
    ):
        user, goals, _ = dependency_graph_data
        goal_a, goal_b, goal_c = goals
        service = GoalService()
        session.add(
            GoalDependency(id=uuid4(), goal_id=goal_a.id, depends_on_goal_id=goal_b.id)
        )
        session.add(
            GoalDependency(id=uuid4(), goal_id=goal_b.id, depends_on_goal_id=goal_c.id)
        )
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            service.add_goal_dependency(session, goal_c.id, goal_a.id, user.id)

        _assert_circular_dependency_rejected(exc_info)

    def test_rejects_goal_cycle_after_long_dependency_chain(
        self, session: Session, dependency_graph_data
    ):
        user, goals, _ = dependency_graph_data
        chain_goals = [
            _create_goal(session, goals[0].project_id, f"Long Chain Goal {index}")
            for index in range(102)
        ]
        for index in range(len(chain_goals) - 1):
            session.add(
                GoalDependency(
                    id=uuid4(),
                    goal_id=chain_goals[index].id,
                    depends_on_goal_id=chain_goals[index + 1].id,
                )
            )
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            GoalService().add_goal_dependency(
                session, chain_goals[-1].id, chain_goals[0].id, user.id
            )

        _assert_circular_dependency_rejected(exc_info)
