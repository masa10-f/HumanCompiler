from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from humancompiler_api.ai.goal_task_drafts import (
    DraftGoal,
    DraftTask,
    DraftTaskDependency,
    GoalTaskDraftApplyRequest,
    goal_task_draft_service,
)
from humancompiler_api.models import Goal, Project, Task, TaskDependency, User


@pytest.fixture
def draft_workspace(session: Session):
    user = User(id=uuid4(), email="draft-owner@example.com")
    other_user = User(id=uuid4(), email="draft-other@example.com")
    session.add(user)
    session.add(other_user)

    project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="Draft Project",
        description=None,
    )
    other_project = Project(
        id=uuid4(),
        owner_id=other_user.id,
        title="Other Project",
        description=None,
    )
    session.add(project)
    session.add(other_project)

    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Target Goal",
        description=None,
        estimate_hours=Decimal("10.00"),
    )
    other_goal = Goal(
        id=uuid4(),
        project_id=other_project.id,
        title="Other Goal",
        description=None,
        estimate_hours=Decimal("10.00"),
    )
    session.add(goal)
    session.add(other_goal)
    session.commit()

    return {
        "user": user,
        "other_user": other_user,
        "project": project,
        "goal": goal,
        "other_goal": other_goal,
    }


def make_draft_task(client_id: str, **overrides) -> DraftTask:
    data = {
        "client_id": client_id,
        "goal_client_id": None,
        "goal_id": None,
        "source_task_id": None,
        "title": f"Task {client_id}",
        "description": None,
        "estimate_hours": 1.0,
        "due_date": None,
        "work_type": "light_work",
        "priority": 3,
        "rationale": None,
        "confidence": 0.8,
    }
    data.update(overrides)
    return DraftTask(**data)


def test_apply_draft_explicit_empty_selection_creates_nothing(
    session: Session, draft_workspace
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]

    request = GoalTaskDraftApplyRequest(
        project_id=project.id,
        mode="project_goals",
        goals=[
            DraftGoal(
                client_id="goal-1",
                title="Generated goal",
                description=None,
                estimate_hours=2.0,
                rationale=None,
                confidence=0.8,
                tasks=[make_draft_task("task-1")],
            )
        ],
        tasks=[],
        dependencies=[],
        selected_goal_client_ids=[],
        selected_task_client_ids=[],
    )

    response = goal_task_draft_service.apply_draft(session, user.id, request)

    assert response.created_goals == []
    assert response.created_tasks == []
    assert (
        session.exec(
            select(Goal).where(
                Goal.project_id == project.id, Goal.title == "Generated goal"
            )
        ).first()
        is None
    )


def test_apply_draft_rejects_cross_tenant_task_goal_id(
    session: Session, draft_workspace
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    other_goal = draft_workspace["other_goal"]

    request = GoalTaskDraftApplyRequest(
        project_id=project.id,
        mode="project_goals",
        goals=[],
        tasks=[make_draft_task("task-1", goal_id=other_goal.id)],
        dependencies=[],
        selected_task_client_ids=["task-1"],
    )

    with pytest.raises(HTTPException) as exc_info:
        goal_task_draft_service.apply_draft(session, user.id, request)

    assert exc_info.value.status_code == 404
    assert session.exec(select(Task).where(Task.title == "Task task-1")).first() is None


def test_apply_draft_deduplicates_generated_dependencies(
    session: Session, draft_workspace
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    goal = draft_workspace["goal"]

    request = GoalTaskDraftApplyRequest(
        project_id=project.id,
        mode="goal_tasks",
        goal_id=goal.id,
        goals=[],
        tasks=[make_draft_task("task-1"), make_draft_task("task-2")],
        dependencies=[
            DraftTaskDependency(task_client_id="task-2", depends_on_client_id="task-1"),
            DraftTaskDependency(task_client_id="task-2", depends_on_client_id="task-1"),
        ],
        selected_task_client_ids=["task-1", "task-2"],
    )

    response = goal_task_draft_service.apply_draft(session, user.id, request)

    assert len(response.created_tasks) == 2
    assert len(response.created_dependencies) == 1
    dependencies = session.exec(select(TaskDependency)).all()
    assert len(dependencies) == 1


def test_apply_draft_skips_generated_dependency_cycles(
    session: Session, draft_workspace
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    goal = draft_workspace["goal"]

    request = GoalTaskDraftApplyRequest(
        project_id=project.id,
        mode="goal_tasks",
        goal_id=goal.id,
        goals=[],
        tasks=[make_draft_task("task-1"), make_draft_task("task-2")],
        dependencies=[
            DraftTaskDependency(task_client_id="task-2", depends_on_client_id="task-1"),
            DraftTaskDependency(task_client_id="task-1", depends_on_client_id="task-2"),
        ],
        selected_task_client_ids=["task-1", "task-2"],
    )

    response = goal_task_draft_service.apply_draft(session, user.id, request)

    assert len(response.created_tasks) == 2
    assert len(response.created_dependencies) == 1
    assert response.warnings == ["循環する依存関係を作るAI提案をスキップしました。"]
    dependencies = session.exec(select(TaskDependency)).all()
    assert len(dependencies) == 1
