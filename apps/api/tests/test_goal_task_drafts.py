from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from humancompiler_api.ai.goal_task_drafts import (
    AIDraftGenerationError,
    DraftGoal,
    DraftTask,
    DraftTaskDependency,
    GoalTaskDraftApplyRequest,
    GoalTaskDraftRequest,
    MAX_DRAFT_OUTPUT_TOKENS,
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


def test_apply_project_draft_can_add_task_to_existing_goal(
    session: Session, draft_workspace
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    existing_goal = draft_workspace["goal"]

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
                tasks=[
                    make_draft_task(
                        "task-1",
                        goal_id=existing_goal.id,
                        title="Existing goal task",
                    )
                ],
            )
        ],
        tasks=[],
        dependencies=[],
        selected_goal_client_ids=["goal-1"],
        selected_task_client_ids=["task-1"],
    )

    response = goal_task_draft_service.apply_draft(session, user.id, request)

    assert len(response.created_goals) == 1
    assert len(response.created_tasks) == 1
    created_task = session.get(Task, response.created_tasks[0].id)
    assert created_task is not None
    assert created_task.goal_id == existing_goal.id


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


def test_generate_draft_treats_empty_ai_payload_as_unavailable(
    session: Session, draft_workspace, monkeypatch: pytest.MonkeyPatch
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    request = GoalTaskDraftRequest(
        project_id=project.id,
        mode="project_goals",
        user_message="プロジェクトノートからゴールを作って",
    )

    monkeypatch.setattr(
        goal_task_draft_service,
        "_create_openai_client",
        lambda _session, _user_id: (object(), "gpt-5.5"),
    )
    monkeypatch.setattr(
        goal_task_draft_service,
        "_call_responses_api",
        lambda _client, _model, _prompt: {
            "assistant_message": "",
            "goals": [],
            "tasks": [],
            "dependencies": [],
            "warnings": [],
        },
    )

    response = goal_task_draft_service.generate_draft(session, user.id, request)

    assert response.success is False
    assert response.goals == []
    assert response.tasks == []
    assert "提案が返りませんでした" in response.assistant_message


def test_responses_api_reports_incomplete_due_to_output_limit():
    class FakeIncompleteDetails:
        reason = "max_output_tokens"

    class FakeResponse:
        status = "incomplete"
        incomplete_details = FakeIncompleteDetails()
        error = None
        output_text = ""

    class FakeResponses:
        def create(self, **_kwargs):
            return FakeResponse()

    class FakeClient:
        responses = FakeResponses()

    with pytest.raises(AIDraftGenerationError) as exc_info:
        goal_task_draft_service._call_responses_api(
            FakeClient(), "gpt-5.5", '{"mode":"project_goals"}'
        )

    assert "出力上限" in str(exc_info.value)


def test_start_draft_job_uses_background_responses_api(
    session: Session, draft_workspace, monkeypatch: pytest.MonkeyPatch
):
    project = draft_workspace["project"]
    user = draft_workspace["user"]
    captured: dict[str, object] = {}

    class FakeResponse:
        id = "resp_background_123"
        status = "queued"

    class FakeResponses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeClient:
        responses = FakeResponses()

    monkeypatch.setattr(
        goal_task_draft_service,
        "_create_openai_client",
        lambda _session, _user_id: (FakeClient(), "gpt-5.5"),
    )

    response = goal_task_draft_service.start_draft_job(
        session,
        user.id,
        GoalTaskDraftRequest(
            project_id=project.id,
            mode="project_goals",
            user_message="プロジェクトノートからゴールを作って",
        ),
    )

    assert response.success is True
    assert response.response_id == "resp_background_123"
    assert captured["background"] is True
    assert captured["store"] is True
    assert captured["max_output_tokens"] == MAX_DRAFT_OUTPUT_TOKENS
    assert captured["metadata"] == {
        "kind": "goal_task_draft",
        "user_id": str(user.id),
        "project_id": str(project.id),
        "mode": "project_goals",
    }


def test_get_draft_job_returns_completed_draft(
    session: Session, draft_workspace, monkeypatch: pytest.MonkeyPatch
):
    user = draft_workspace["user"]
    project = draft_workspace["project"]

    class FakeResponse:
        id = "resp_done_123"
        status = "completed"
        model = "gpt-5.5"
        metadata = {
            "kind": "goal_task_draft",
            "user_id": str(user.id),
            "project_id": str(project.id),
            "mode": "project_goals",
        }
        error = None
        incomplete_details = None
        output_text = """
        {
          "assistant_message": "文脈から初期ゴールを提案しました。",
          "goals": [
            {
              "client_id": "goal-1",
              "title": "Generated goal",
              "description": null,
              "estimate_hours": 2.0,
              "rationale": "プロジェクトの文脈に沿うためです。",
              "confidence": 0.8,
              "tasks": []
            }
          ],
          "tasks": [],
          "dependencies": [],
          "warnings": []
        }
        """

    class FakeResponses:
        def retrieve(self, response_id, **_kwargs):
            assert response_id == "resp_done_123"
            return FakeResponse()

    class FakeClient:
        responses = FakeResponses()

    monkeypatch.setattr(
        goal_task_draft_service,
        "_create_openai_client",
        lambda _session, _user_id: (FakeClient(), "gpt-5.5"),
    )

    response = goal_task_draft_service.get_draft_job(session, user.id, "resp_done_123")

    assert response.success is True
    assert response.status == "completed"
    assert response.draft is not None
    assert response.draft.goals[0].rationale == "プロジェクトの文脈に沿うためです。"
