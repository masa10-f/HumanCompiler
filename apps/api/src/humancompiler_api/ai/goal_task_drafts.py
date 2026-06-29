"""AI-assisted goal and task draft generation."""

import json
import logging
from datetime import UTC, date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    NotFoundError,
    OpenAI,
    RateLimitError,
)
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlmodel import Session, select

from humancompiler_api.config import settings
from humancompiler_api.crypto import get_crypto_service
from humancompiler_api.models import (
    ContextNote,
    Goal,
    GoalResponse,
    Project,
    Task,
    TaskDependency,
    TaskDependencyResponse,
    TaskResponse,
    TaskStatus,
    UserSettings,
    WorkType,
)

logger = logging.getLogger(__name__)

DEFAULT_OPENAI_MODEL = "gpt-5.5"
MAX_DRAFT_OUTPUT_TOKENS = 50000
AI_DRAFT_OPENAI_TIMEOUT_SECONDS = 180.0
MAX_CONTEXT_NOTE_CHARS = 6000
MAX_CONTEXT_TASKS = 120
MAX_CONTEXT_GOALS = 80

DraftMode = Literal["project_goals", "goal_tasks", "split_task"]
OriginalTaskAction = Literal["keep", "cancel"]
DraftJobStatus = Literal[
    "queued", "in_progress", "completed", "failed", "cancelled", "incomplete"
]


class AIDraftGenerationError(Exception):
    """Raised when OpenAI returns no usable draft content."""


class DraftChatMessage(BaseModel):
    """Short conversation turn kept by the draft dialog."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class DraftTaskDependency(BaseModel):
    """Temporary dependency between draft tasks."""

    task_client_id: str = Field(min_length=1, max_length=80)
    depends_on_client_id: str = Field(min_length=1, max_length=80)
    rationale: str | None = Field(default=None, max_length=500)


class DraftTask(BaseModel):
    """Editable task draft returned by AI."""

    client_id: str = Field(min_length=1, max_length=80)
    goal_client_id: str | None = Field(default=None, max_length=80)
    goal_id: UUID | None = None
    source_task_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    estimate_hours: float = Field(ge=0.1, le=999.0)
    due_date: str | None = Field(default=None, max_length=40)
    work_type: WorkType = WorkType.LIGHT_WORK
    priority: int = Field(default=3, ge=1, le=5)
    rationale: str | None = Field(default=None, max_length=800)
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)


class DraftGoal(BaseModel):
    """Editable goal draft returned by AI."""

    client_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    estimate_hours: float = Field(ge=0.1, le=999.0)
    rationale: str | None = Field(default=None, max_length=800)
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    tasks: list[DraftTask] = Field(default_factory=list)


class GoalTaskDraftPayload(BaseModel):
    """Structured draft payload that can be regenerated and edited."""

    assistant_message: str = Field(default="", max_length=3000)
    goals: list[DraftGoal] = Field(default_factory=list)
    tasks: list[DraftTask] = Field(default_factory=list)
    dependencies: list[DraftTaskDependency] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GoalTaskDraftRequest(BaseModel):
    """Request for AI-assisted goal/task drafting."""

    project_id: UUID
    mode: DraftMode
    user_message: str = Field(min_length=1, max_length=4000)
    goal_id: UUID | None = None
    task_id: UUID | None = None
    conversation: list[DraftChatMessage] = Field(default_factory=list, max_length=12)
    current_draft: GoalTaskDraftPayload | None = None


class GoalTaskDraftResponse(GoalTaskDraftPayload):
    """Response for AI-assisted goal/task drafting."""

    success: bool = True
    mode: DraftMode
    model: str | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_serializer("generated_at")
    def serialize_generated_at(self, value: datetime) -> str:
        return value.isoformat()


class GoalTaskDraftJobResponse(BaseModel):
    """Background OpenAI response job created for draft generation."""

    success: bool
    response_id: str | None = None
    status: DraftJobStatus
    mode: DraftMode
    model: str | None = None
    message: str = ""
    warnings: list[str] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_serializer("started_at")
    def serialize_started_at(self, value: datetime) -> str:
        return value.isoformat()


class GoalTaskDraftJobStatusResponse(BaseModel):
    """Current status of a background AI draft generation job."""

    success: bool
    response_id: str
    status: DraftJobStatus
    mode: DraftMode | None = None
    model: str | None = None
    message: str = ""
    draft: GoalTaskDraftResponse | None = None
    warnings: list[str] = Field(default_factory=list)
    checked_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_serializer("checked_at")
    def serialize_checked_at(self, value: datetime) -> str:
        return value.isoformat()


class GoalTaskDraftApplyRequest(BaseModel):
    """Apply selected goal/task drafts to persisted records."""

    project_id: UUID
    mode: DraftMode
    goal_id: UUID | None = None
    task_id: UUID | None = None
    goals: list[DraftGoal] = Field(default_factory=list)
    tasks: list[DraftTask] = Field(default_factory=list)
    dependencies: list[DraftTaskDependency] = Field(default_factory=list)
    selected_goal_client_ids: list[str] | None = None
    selected_task_client_ids: list[str] | None = None
    original_task_action: OriginalTaskAction = "keep"


class GoalTaskDraftApplyResponse(BaseModel):
    """Persisted records created from an AI draft."""

    success: bool
    created_goals: list[GoalResponse] = Field(default_factory=list)
    created_tasks: list[TaskResponse] = Field(default_factory=list)
    created_dependencies: list[TaskDependencyResponse] = Field(default_factory=list)
    updated_original_task_id: UUID | None = None
    warnings: list[str] = Field(default_factory=list)

    model_config = ConfigDict(arbitrary_types_allowed=True)


DRAFT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "assistant_message": {"type": "string"},
        "goals": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "client_id": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": ["string", "null"]},
                    "estimate_hours": {
                        "type": "number",
                        "minimum": 0.1,
                        "maximum": 999,
                    },
                    "rationale": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "tasks": {
                        "type": "array",
                        "items": {"$ref": "#/$defs/task"},
                    },
                },
                "required": [
                    "client_id",
                    "title",
                    "description",
                    "estimate_hours",
                    "rationale",
                    "confidence",
                    "tasks",
                ],
            },
        },
        "tasks": {"type": "array", "items": {"$ref": "#/$defs/task"}},
        "dependencies": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "task_client_id": {"type": "string"},
                    "depends_on_client_id": {"type": "string"},
                    "rationale": {"type": ["string", "null"]},
                },
                "required": ["task_client_id", "depends_on_client_id", "rationale"],
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["assistant_message", "goals", "tasks", "dependencies", "warnings"],
    "$defs": {
        "task": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "client_id": {"type": "string"},
                "goal_client_id": {"type": ["string", "null"]},
                "goal_id": {"type": ["string", "null"]},
                "source_task_id": {"type": ["string", "null"]},
                "title": {"type": "string"},
                "description": {"type": ["string", "null"]},
                "estimate_hours": {"type": "number", "minimum": 0.1, "maximum": 999},
                "due_date": {"type": ["string", "null"]},
                "work_type": {
                    "type": "string",
                    "enum": ["light_work", "study", "focused_work"],
                },
                "priority": {"type": "integer", "minimum": 1, "maximum": 5},
                "rationale": {"type": ["string", "null"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": [
                "client_id",
                "goal_client_id",
                "goal_id",
                "source_task_id",
                "title",
                "description",
                "estimate_hours",
                "due_date",
                "work_type",
                "priority",
                "rationale",
                "confidence",
            ],
        }
    },
}


SYSTEM_PROMPT = """あなたはHumanCompilerのゴール・タスク設計アシスタントです。
既存のプロジェクト、ゴール、タスク、コンテクストノートを読み、ユーザーが編集しやすい構造化草案だけを返してください。

原則:
- 提案はDBに直接作成されません。人間が編集・選択してから適用します。
- タイトルは短く具体的にします。
- 見積時間は0.1から999時間の範囲で現実的にします。
- タスクは1作業単位が0.25から4時間程度になるように分割します。
- work_typeは light_work, study, focused_work のいずれかです。
- priorityは1が最高、5が最低です。
- 依存関係は同じ草案内のclient_idだけを参照します。
- 各ゴール・タスクのrationaleには、プロジェクトやノートのどの文脈から必要だと判断したかを1-2文で書いてください。
- 不明な点はwarningsかassistant_messageで明示し、勝手に確定しすぎないでください。
"""


class GoalTaskDraftService:
    """Create and apply AI-assisted goal/task drafts."""

    def start_draft_job(
        self, session: Session, user_id: str | UUID, request: GoalTaskDraftRequest
    ) -> GoalTaskDraftJobResponse:
        project = self._get_project(session, request.project_id, user_id)
        target_goal = (
            self._get_goal(session, request.goal_id, user_id)
            if request.goal_id
            else None
        )
        target_task = (
            self._get_task(session, request.task_id, user_id)
            if request.task_id
            else None
        )

        if (
            request.mode in ("goal_tasks", "split_task")
            and not target_goal
            and not target_task
        ):
            message = "対象のゴールまたはタスクを指定してください。"
            return GoalTaskDraftJobResponse(
                success=False,
                status="failed",
                mode=request.mode,
                message=message,
                warnings=[message],
            )

        client, model = self._create_openai_client(session, user_id)
        if client is None:
            message = "OpenAI APIキーが設定されていません。設定画面でAPIキーを登録してください。"
            return GoalTaskDraftJobResponse(
                success=False,
                status="failed",
                mode=request.mode,
                model=model,
                message=message,
                warnings=[message],
            )

        prompt = self._build_prompt(session, request, project, target_goal, target_task)
        metadata = self._build_response_metadata(user_id, request)
        try:
            response = self._create_responses_api_response(
                client,
                model,
                prompt,
                background=True,
                metadata=metadata,
            )
        except (
            AuthenticationError,
            RateLimitError,
            APIConnectionError,
            APITimeoutError,
            NotFoundError,
            APIError,
        ) as exc:
            message = self._openai_error_message(exc)
            logger.warning("OpenAI draft background job failed to start: %s", exc)
            return GoalTaskDraftJobResponse(
                success=False,
                status="failed",
                mode=request.mode,
                model=model,
                message=message,
                warnings=[message],
            )

        response_id = getattr(response, "id", None)
        status_value = self._response_status(response)
        if not response_id:
            message = "AI生成ジョブIDを取得できませんでした。もう一度生成してください。"
            return GoalTaskDraftJobResponse(
                success=False,
                status="failed",
                mode=request.mode,
                model=model,
                message=message,
                warnings=[message],
            )

        return GoalTaskDraftJobResponse(
            success=True,
            response_id=response_id,
            status=status_value,
            mode=request.mode,
            model=model,
            message="AI提案の生成を開始しました。",
        )

    def get_draft_job(
        self, session: Session, user_id: str | UUID, response_id: str
    ) -> GoalTaskDraftJobStatusResponse:
        client, model = self._create_openai_client(session, user_id)
        if client is None:
            message = "OpenAI APIキーが設定されていません。設定画面でAPIキーを登録してください。"
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status="failed",
                model=model,
                message=message,
                warnings=[message],
            )

        try:
            response = client.responses.retrieve(response_id, timeout=30.0)
        except (
            AuthenticationError,
            RateLimitError,
            APIConnectionError,
            APITimeoutError,
            NotFoundError,
            APIError,
        ) as exc:
            message = self._openai_error_message(exc)
            logger.warning("OpenAI draft background job retrieval failed: %s", exc)
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status="failed",
                model=model,
                message=message,
                warnings=[message],
            )

        metadata = getattr(response, "metadata", None) or {}
        self._validate_response_metadata(metadata, user_id)
        mode = metadata.get("mode")
        status_value = self._response_status(response)
        response_model = str(getattr(response, "model", None) or model)

        if status_value in ("queued", "in_progress"):
            return GoalTaskDraftJobStatusResponse(
                success=True,
                response_id=response_id,
                status=status_value,
                mode=self._metadata_mode(mode),
                model=response_model,
                message="AI提案を生成中です。",
            )

        if status_value != "completed":
            message = self._response_failure_message(response)
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status=status_value,
                mode=self._metadata_mode(mode),
                model=response_model,
                message=message,
                warnings=[message],
            )

        request_mode = self._metadata_mode(mode)
        try:
            payload = self._response_to_payload(response)
            draft = GoalTaskDraftPayload.model_validate(payload)
        except (AIDraftGenerationError, json.JSONDecodeError) as exc:
            message = self._openai_error_message(exc)
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status="failed",
                mode=request_mode,
                model=response_model,
                message=message,
                warnings=[message],
            )
        except Exception as exc:
            logger.error("Invalid AI draft payload from background job: %s", exc)
            message = "AIの提案を構造化データとして読み取れませんでした。もう一度生成してください。"
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status="failed",
                mode=request_mode,
                model=response_model,
                message=message,
                warnings=[message],
            )

        if not self._has_draft_items(draft):
            message = (
                draft.assistant_message.strip()
                or next(
                    (warning.strip() for warning in draft.warnings if warning.strip()),
                    "",
                )
                or "AIからゴールまたはタスクの提案が返りませんでした。入力内容を少し具体化して再実行してください。"
            )
            return GoalTaskDraftJobStatusResponse(
                success=False,
                response_id=response_id,
                status="failed",
                mode=request_mode,
                model=response_model,
                message=message,
                warnings=[message],
            )

        draft_response = GoalTaskDraftResponse(
            success=True,
            mode=request_mode,
            model=response_model,
            assistant_message=draft.assistant_message,
            goals=draft.goals,
            tasks=draft.tasks,
            dependencies=draft.dependencies,
            warnings=draft.warnings,
        )
        return GoalTaskDraftJobStatusResponse(
            success=True,
            response_id=response_id,
            status="completed",
            mode=request_mode,
            model=response_model,
            message="AI提案を生成しました。",
            draft=draft_response,
            warnings=draft.warnings,
        )

    def generate_draft(
        self, session: Session, user_id: str | UUID, request: GoalTaskDraftRequest
    ) -> GoalTaskDraftResponse:
        project = self._get_project(session, request.project_id, user_id)
        target_goal = (
            self._get_goal(session, request.goal_id, user_id)
            if request.goal_id
            else None
        )
        target_task = (
            self._get_task(session, request.task_id, user_id)
            if request.task_id
            else None
        )

        if (
            request.mode in ("goal_tasks", "split_task")
            and not target_goal
            and not target_task
        ):
            return self._unavailable_response(
                request,
                "対象のゴールまたはタスクを指定してください。",
                model=None,
            )

        client, model = self._create_openai_client(session, user_id)
        if client is None:
            return self._unavailable_response(
                request,
                "OpenAI APIキーが設定されていません。設定画面でAPIキーを登録してください。",
                model=model,
            )

        prompt = self._build_prompt(session, request, project, target_goal, target_task)

        unavailable_errors = (
            AuthenticationError,
            RateLimitError,
            APIConnectionError,
            APITimeoutError,
            NotFoundError,
        )

        try:
            payload = self._call_responses_api(client, model, prompt)
        except unavailable_errors as exc:
            logger.warning("OpenAI draft generation unavailable: %s", exc)
            return self._unavailable_response(
                request, self._openai_error_message(exc), model=model
            )
        except (
            AIDraftGenerationError,
            AttributeError,
            TypeError,
            APIError,
            json.JSONDecodeError,
        ) as exc:
            logger.warning(
                "Responses API failed, falling back to chat completions: %s", exc
            )
            try:
                payload = self._call_chat_completions_api(client, model, prompt)
            except unavailable_errors as fallback_exc:
                logger.warning(
                    "OpenAI chat completion fallback unavailable: %s", fallback_exc
                )
                return self._unavailable_response(
                    request, self._openai_error_message(fallback_exc), model=model
                )
            except (
                AIDraftGenerationError,
                APIError,
                json.JSONDecodeError,
            ) as fallback_exc:
                logger.warning("OpenAI draft fallback failed: %s", fallback_exc)
                return self._unavailable_response(
                    request, self._openai_error_message(fallback_exc), model=model
                )

        try:
            draft = GoalTaskDraftPayload.model_validate(payload)
        except Exception as exc:
            logger.error("Invalid AI draft payload: %s", exc)
            return self._unavailable_response(
                request,
                "AIの提案を構造化データとして読み取れませんでした。もう一度生成してください。",
                model=model,
            )

        if not self._has_draft_items(draft):
            message = (
                draft.assistant_message.strip()
                or next(
                    (warning.strip() for warning in draft.warnings if warning.strip()),
                    "",
                )
                or "AIからゴールまたはタスクの提案が返りませんでした。入力内容を少し具体化して再実行してください。"
            )
            logger.warning(
                "OpenAI draft generation returned no draft items: %s", message
            )
            return self._unavailable_response(request, message, model=model)

        return GoalTaskDraftResponse(
            success=True,
            mode=request.mode,
            model=model,
            assistant_message=draft.assistant_message,
            goals=draft.goals,
            tasks=draft.tasks,
            dependencies=draft.dependencies,
            warnings=draft.warnings,
        )

    def apply_draft(
        self, session: Session, user_id: str | UUID, request: GoalTaskDraftApplyRequest
    ) -> GoalTaskDraftApplyResponse:
        self._get_project(session, request.project_id, user_id)
        target_goal = (
            self._get_goal(session, request.goal_id, user_id)
            if request.goal_id
            else None
        )
        target_task = (
            self._get_task(session, request.task_id, user_id)
            if request.task_id
            else None
        )

        if target_task and target_goal is None:
            target_goal = self._get_goal(session, target_task.goal_id, user_id)

        selected_goal_ids = (
            set(request.selected_goal_client_ids)
            if request.selected_goal_client_ids is not None
            else None
        )
        selected_task_ids = (
            set(request.selected_task_client_ids)
            if request.selected_task_client_ids is not None
            else None
        )
        apply_all_goals = selected_goal_ids is None
        apply_all_tasks = selected_task_ids is None

        created_goals: list[Goal] = []
        created_tasks: list[Task] = []
        created_dependencies: list[TaskDependency] = []
        warnings: list[str] = []
        goal_id_by_client_id: dict[str, UUID] = {}
        task_id_by_client_id: dict[str, UUID] = {}

        try:
            for draft_goal in request.goals:
                should_create_goal = apply_all_goals or (
                    selected_goal_ids is not None
                    and draft_goal.client_id in selected_goal_ids
                )
                db_goal_id = target_goal.id if target_goal else None

                if request.mode == "project_goals" and should_create_goal:
                    goal = Goal(
                        id=uuid4(),
                        project_id=request.project_id,
                        title=self._clean_text(draft_goal.title, 200)
                        or "Untitled goal",
                        description=self._clean_optional_text(
                            draft_goal.description, 1000
                        ),
                        estimate_hours=self._decimal_hours(draft_goal.estimate_hours),
                    )
                    session.add(goal)
                    session.flush()
                    created_goals.append(goal)
                    db_goal_id = goal.id
                    goal_id_by_client_id[draft_goal.client_id] = goal.id
                elif db_goal_id:
                    goal_id_by_client_id[draft_goal.client_id] = db_goal_id

                for draft_task in draft_goal.tasks:
                    if not (
                        apply_all_tasks
                        or (
                            selected_task_ids is not None
                            and draft_task.client_id in selected_task_ids
                        )
                    ):
                        continue
                    if db_goal_id is None:
                        warnings.append(
                            f"タスク「{draft_task.title}」は紐づくゴールがないためスキップしました。"
                        )
                        continue
                    task = self._create_task_from_draft(draft_task, db_goal_id)
                    session.add(task)
                    session.flush()
                    created_tasks.append(task)
                    task_id_by_client_id[draft_task.client_id] = task.id

            for draft_task in request.tasks:
                if not (
                    apply_all_tasks
                    or (
                        selected_task_ids is not None
                        and draft_task.client_id in selected_task_ids
                    )
                ):
                    continue
                db_goal_id = self._resolve_goal_id_for_task(
                    session,
                    user_id,
                    request.project_id,
                    draft_task,
                    target_goal,
                    goal_id_by_client_id,
                )
                if db_goal_id is None:
                    warnings.append(
                        f"タスク「{draft_task.title}」は紐づくゴールがないためスキップしました。"
                    )
                    continue
                task = self._create_task_from_draft(draft_task, db_goal_id)
                session.add(task)
                session.flush()
                created_tasks.append(task)
                task_id_by_client_id[draft_task.client_id] = task.id

            seen_dependencies: set[tuple[UUID, UUID]] = set()
            dependency_edges: dict[UUID, set[UUID]] = {}
            for dependency in request.dependencies:
                task_id = task_id_by_client_id.get(dependency.task_client_id)
                depends_on_id = task_id_by_client_id.get(
                    dependency.depends_on_client_id
                )
                if not task_id or not depends_on_id or task_id == depends_on_id:
                    continue
                dependency_key = (task_id, depends_on_id)
                if dependency_key in seen_dependencies:
                    continue
                if self._would_create_dependency_cycle(
                    dependency_edges, task_id, depends_on_id
                ):
                    warnings.append("循環する依存関係を作るAI提案をスキップしました。")
                    continue
                seen_dependencies.add(dependency_key)
                dependency_edges.setdefault(task_id, set()).add(depends_on_id)
                task_dependency = TaskDependency(
                    id=uuid4(),
                    task_id=task_id,
                    depends_on_task_id=depends_on_id,
                )
                session.add(task_dependency)
                session.flush()
                created_dependencies.append(task_dependency)

            updated_original_task_id = None
            if (
                request.mode == "split_task"
                and request.original_task_action == "cancel"
                and target_task is not None
            ):
                target_task.status = TaskStatus.CANCELLED
                target_task.updated_at = datetime.now(UTC)
                session.add(target_task)
                updated_original_task_id = target_task.id

            session.commit()

            for goal in created_goals:
                session.refresh(goal)
            for task in created_tasks:
                session.refresh(task)
            for dependency in created_dependencies:
                session.refresh(dependency)

            return GoalTaskDraftApplyResponse(
                success=True,
                created_goals=[
                    GoalResponse.model_validate(goal) for goal in created_goals
                ],
                created_tasks=[
                    TaskResponse.model_validate(task) for task in created_tasks
                ],
                created_dependencies=[
                    TaskDependencyResponse.model_validate(dep)
                    for dep in created_dependencies
                ],
                updated_original_task_id=updated_original_task_id,
                warnings=warnings,
            )
        except Exception:
            session.rollback()
            raise

    def _call_responses_api(
        self, client: OpenAI, model: str, prompt: str
    ) -> dict[str, Any]:
        response = self._create_responses_api_response(
            client,
            model,
            prompt,
            background=False,
            metadata=None,
        )
        return self._response_to_payload(response)

    def _create_responses_api_response(
        self,
        client: OpenAI,
        model: str,
        prompt: str,
        background: bool,
        metadata: dict[str, str] | None,
    ) -> Any:
        response = client.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=prompt,
            background=background,
            store=True,
            metadata=metadata,
            reasoning={"effort": "high"},
            text={
                "format": {
                    "type": "json_schema",
                    "name": "goal_task_draft",
                    "schema": DRAFT_JSON_SCHEMA,
                    "strict": True,
                }
            },
            max_output_tokens=MAX_DRAFT_OUTPUT_TOKENS,
        )
        return response

    def _response_to_payload(self, response: Any) -> dict[str, Any]:
        status_value = getattr(response, "status", None)
        if status_value == "incomplete":
            incomplete_details = getattr(response, "incomplete_details", None)
            reason = getattr(incomplete_details, "reason", None)
            if reason == "max_output_tokens":
                raise AIDraftGenerationError(
                    "AI生成が出力上限に達しました。入力を短くするか、もう一度生成してください。"
                )
            if reason == "content_filter":
                raise AIDraftGenerationError(
                    "AI生成が安全性フィルタで途中停止しました。入力内容を調整してください。"
                )
            raise AIDraftGenerationError(
                "AI生成が途中で停止しました。もう一度生成してください。"
            )

        response_error = getattr(response, "error", None)
        if response_error:
            message = getattr(response_error, "message", None) or str(response_error)
            raise AIDraftGenerationError(f"AI生成に失敗しました: {message}")

        output_text = getattr(response, "output_text", None)
        if not output_text:
            output_text = self._collect_response_output_text(response)
        if not output_text.strip():
            raise AIDraftGenerationError(
                "AIから空の応答が返りました。もう一度生成してください。"
            )
        return json.loads(output_text)

    def _response_status(self, response: Any) -> DraftJobStatus:
        status_value = getattr(response, "status", None)
        if status_value in {
            "queued",
            "in_progress",
            "completed",
            "failed",
            "cancelled",
            "incomplete",
        }:
            return status_value
        return "failed"

    def _response_failure_message(self, response: Any) -> str:
        response_error = getattr(response, "error", None)
        if response_error:
            message = getattr(response_error, "message", None) or str(response_error)
            return f"AI生成に失敗しました: {message}"
        if getattr(response, "status", None) == "incomplete":
            incomplete_details = getattr(response, "incomplete_details", None)
            reason = getattr(incomplete_details, "reason", None)
            if reason == "max_output_tokens":
                return "AI生成が出力上限に達しました。入力を短くするか、もう一度生成してください。"
            if reason == "content_filter":
                return "AI生成が安全性フィルタで途中停止しました。入力内容を調整してください。"
            return "AI生成が途中で停止しました。もう一度生成してください。"
        if getattr(response, "status", None) == "cancelled":
            return "AI生成はキャンセルされました。"
        return "AI生成に失敗しました。もう一度生成してください。"

    def _build_response_metadata(
        self, user_id: str | UUID, request: GoalTaskDraftRequest
    ) -> dict[str, str]:
        metadata = {
            "kind": "goal_task_draft",
            "user_id": str(user_id),
            "project_id": str(request.project_id),
            "mode": request.mode,
        }
        if request.goal_id:
            metadata["goal_id"] = str(request.goal_id)
        if request.task_id:
            metadata["task_id"] = str(request.task_id)
        return metadata

    def _validate_response_metadata(
        self, metadata: dict[str, Any], user_id: str | UUID
    ) -> None:
        if metadata.get("kind") != "goal_task_draft" or metadata.get("user_id") != str(
            user_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="AI draft job not found",
            )

    def _metadata_mode(self, mode: str | None) -> DraftMode:
        if mode in ("project_goals", "goal_tasks", "split_task"):
            return mode
        return "project_goals"

    def _call_chat_completions_api(
        self, client: OpenAI, model: str, prompt: str
    ) -> dict[str, Any]:
        api_params: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"{prompt}\n\nJSONだけを返してください。schema: "
                        f"{json.dumps(DRAFT_JSON_SCHEMA, ensure_ascii=False)}"
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": MAX_DRAFT_OUTPUT_TOKENS,
        }
        if model.startswith(("gpt-5.5", "gpt-5.4")):
            api_params["reasoning_effort"] = "high"
        if not model.startswith(("gpt-5.5", "gpt-5.4", "o1")):
            api_params["temperature"] = 0.2
        response = client.chat.completions.create(**api_params)
        choice = response.choices[0]
        if getattr(choice, "finish_reason", None) == "length":
            raise AIDraftGenerationError(
                "AI生成が出力上限に達しました。入力を短くするか、もう一度生成してください。"
            )
        content = choice.message.content or ""
        if not content.strip():
            raise AIDraftGenerationError(
                "AIから空の応答が返りました。もう一度生成してください。"
            )
        return json.loads(content)

    def _collect_response_output_text(self, response: Any) -> str:
        chunks: list[str] = []
        for item in getattr(response, "output", []) or []:
            for content in getattr(item, "content", []) or []:
                text = getattr(content, "text", None)
                if text:
                    chunks.append(text)
        return "".join(chunks)

    def _has_draft_items(self, draft: GoalTaskDraftPayload) -> bool:
        return bool(
            draft.goals or draft.tasks or any(goal.tasks for goal in draft.goals)
        )

    def _build_prompt(
        self,
        session: Session,
        request: GoalTaskDraftRequest,
        project: Project,
        target_goal: Goal | None,
        target_task: Task | None,
    ) -> str:
        goals = session.exec(
            select(Goal).where(Goal.project_id == project.id).limit(MAX_CONTEXT_GOALS)
        ).all()
        tasks = session.exec(
            select(Task)
            .join(Goal, Task.goal_id == Goal.id)
            .where(Goal.project_id == project.id)
            .limit(MAX_CONTEXT_TASKS)
        ).all()

        project_note = self._get_note(session, project_id=project.id)
        goal_note = (
            self._get_note(session, goal_id=target_goal.id) if target_goal else None
        )
        task_note = (
            self._get_note(session, task_id=target_task.id) if target_task else None
        )

        mode_instruction = {
            "project_goals": (
                "プロジェクト全体のノートから、実行可能なゴール案を2-5件作り、"
                "各ゴールに初期タスク案を3-8件含めてください。"
            ),
            "goal_tasks": (
                "対象ゴールを達成するためのタスク案を5-12件作ってください。"
                "既存タスクとの重複を避けてください。"
            ),
            "split_task": (
                "対象タスクを小さな実行単位に分割してください。元タスク自体は更新せず、"
                "分割後のタスク案だけを返してください。"
            ),
        }[request.mode]

        conversation = [message.model_dump() for message in request.conversation[-12:]]
        current_draft = (
            request.current_draft.model_dump(mode="json")
            if request.current_draft
            else None
        )

        context = {
            "mode": request.mode,
            "mode_instruction": mode_instruction,
            "user_message": request.user_message,
            "project": {
                "id": str(project.id),
                "title": project.title,
                "description": project.description,
                "note": self._truncate(project_note.content if project_note else ""),
            },
            "target_goal": self._goal_payload(target_goal),
            "target_goal_note": self._truncate(goal_note.content if goal_note else ""),
            "target_task": self._task_payload(target_task),
            "target_task_note": self._truncate(task_note.content if task_note else ""),
            "existing_goals": [self._goal_payload(goal) for goal in goals],
            "existing_tasks": [self._task_payload(task) for task in tasks],
            "conversation": conversation,
            "current_draft": current_draft,
            "output_contract": {
                "project_goals": "Use goals[].tasks for tasks belonging to newly proposed goals.",
                "goal_tasks": "Use tasks[] and set goal_id to the target goal id.",
                "split_task": "Use tasks[] and set source_task_id to the target task id.",
            },
        }
        return json.dumps(context, ensure_ascii=False, default=str)

    def _create_openai_client(
        self, session: Session, user_id: str | UUID
    ) -> tuple[OpenAI | None, str]:
        user_settings = session.exec(
            select(UserSettings).where(UserSettings.user_id == UUID(str(user_id)))
        ).first()
        model = user_settings.openai_model if user_settings else DEFAULT_OPENAI_MODEL
        model = model or DEFAULT_OPENAI_MODEL

        if user_settings and user_settings.openai_api_key_encrypted:
            try:
                api_key = get_crypto_service().decrypt(
                    user_settings.openai_api_key_encrypted
                )
                if api_key:
                    return OpenAI(
                        api_key=api_key, timeout=AI_DRAFT_OPENAI_TIMEOUT_SECONDS
                    ), model
            except Exception as exc:
                logger.warning("Failed to decrypt user OpenAI API key: %s", exc)

        if settings.openai_api_key and settings.openai_api_key not in {
            "your_openai_api_key",
            "development-key-not-available",
        }:
            return OpenAI(
                api_key=settings.openai_api_key,
                timeout=AI_DRAFT_OPENAI_TIMEOUT_SECONDS,
            ), DEFAULT_OPENAI_MODEL

        return None, model

    def _get_project(
        self, session: Session, project_id: UUID, user_id: str | UUID
    ) -> Project:
        project = session.exec(
            select(Project).where(
                Project.id == project_id,
                Project.owner_id == UUID(str(user_id)),
            )
        ).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )
        return project

    def _get_goal(self, session: Session, goal_id: UUID, user_id: str | UUID) -> Goal:
        goal = session.exec(
            select(Goal)
            .join(Project, Goal.project_id == Project.id)
            .where(Goal.id == goal_id, Project.owner_id == UUID(str(user_id)))
        ).first()
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found",
            )
        return goal

    def _get_task(self, session: Session, task_id: UUID, user_id: str | UUID) -> Task:
        task = session.exec(
            select(Task)
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(Task.id == task_id, Project.owner_id == UUID(str(user_id)))
        ).first()
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )
        return task

    def _get_note(
        self,
        session: Session,
        project_id: UUID | None = None,
        goal_id: UUID | None = None,
        task_id: UUID | None = None,
    ) -> ContextNote | None:
        query = select(ContextNote)
        if project_id:
            query = query.where(ContextNote.project_id == project_id)
        elif goal_id:
            query = query.where(ContextNote.goal_id == goal_id)
        elif task_id:
            query = query.where(ContextNote.task_id == task_id)
        else:
            return None
        return session.exec(query).first()

    def _goal_payload(self, goal: Goal | None) -> dict[str, Any] | None:
        if not goal:
            return None
        return {
            "id": str(goal.id),
            "project_id": str(goal.project_id),
            "title": goal.title,
            "description": goal.description,
            "estimate_hours": float(goal.estimate_hours),
            "status": goal.status,
        }

    def _task_payload(self, task: Task | None) -> dict[str, Any] | None:
        if not task:
            return None
        return {
            "id": str(task.id),
            "goal_id": str(task.goal_id),
            "title": task.title,
            "description": task.description,
            "estimate_hours": float(task.estimate_hours),
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "status": task.status,
            "work_type": task.work_type,
            "priority": task.priority,
        }

    def _create_task_from_draft(self, draft_task: DraftTask, goal_id: UUID) -> Task:
        return Task(
            id=uuid4(),
            goal_id=goal_id,
            title=self._clean_text(draft_task.title, 200) or "Untitled task",
            description=self._clean_optional_text(draft_task.description, 1000),
            estimate_hours=self._decimal_hours(draft_task.estimate_hours),
            due_date=self._parse_due_date(draft_task.due_date),
            work_type=draft_task.work_type,
            priority=draft_task.priority,
            status=TaskStatus.PENDING,
        )

    def _resolve_goal_id_for_task(
        self,
        session: Session,
        user_id: str | UUID,
        project_id: UUID,
        draft_task: DraftTask,
        target_goal: Goal | None,
        goal_id_by_client_id: dict[str, UUID],
    ) -> UUID | None:
        if (
            draft_task.goal_client_id
            and draft_task.goal_client_id in goal_id_by_client_id
        ):
            return goal_id_by_client_id[draft_task.goal_client_id]
        if target_goal:
            return target_goal.id
        if draft_task.goal_id:
            goal = self._get_goal(session, draft_task.goal_id, user_id)
            if goal.project_id != project_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Draft task goal_id must belong to the requested project",
                )
            return goal.id
        return None

    def _decimal_hours(self, value: float) -> Decimal:
        clamped = min(max(float(value), 0.1), 999.0)
        return Decimal(str(clamped)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def _parse_due_date(self, value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            if len(value) == 10:
                return datetime.combine(date.fromisoformat(value), time.min)
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _would_create_dependency_cycle(
        self,
        dependency_edges: dict[UUID, set[UUID]],
        task_id: UUID,
        depends_on_id: UUID,
    ) -> bool:
        queue = [depends_on_id]
        visited: set[UUID] = set()
        while queue:
            current_id = queue.pop()
            if current_id == task_id:
                return True
            if current_id in visited:
                continue
            visited.add(current_id)
            queue.extend(dependency_edges.get(current_id, set()))
        return False

    def _clean_text(self, value: str | None, limit: int) -> str:
        if not value:
            return ""
        return value.strip()[:limit]

    def _clean_optional_text(self, value: str | None, limit: int) -> str | None:
        cleaned = self._clean_text(value, limit)
        return cleaned or None

    def _truncate(self, value: str) -> str:
        if len(value) <= MAX_CONTEXT_NOTE_CHARS:
            return value
        return value[:MAX_CONTEXT_NOTE_CHARS] + "\n...[truncated]"

    def _unavailable_response(
        self, request: GoalTaskDraftRequest, message: str, model: str | None
    ) -> GoalTaskDraftResponse:
        return GoalTaskDraftResponse(
            success=False,
            mode=request.mode,
            model=model,
            assistant_message=message,
            goals=[],
            tasks=[],
            dependencies=[],
            warnings=[message],
        )

    def _openai_error_message(self, exc: Exception) -> str:
        message = str(exc).strip() or type(exc).__name__
        if isinstance(exc, AuthenticationError):
            return "OpenAI APIキーを確認してください。認証に失敗しました。"
        if isinstance(exc, RateLimitError):
            return "OpenAI APIのレート制限またはクォータに達しました。少し待ってから再実行してください。"
        if isinstance(exc, APIConnectionError | APITimeoutError):
            return "OpenAI APIへの接続がタイムアウトしました。少し待ってから再実行してください。"
        if isinstance(exc, NotFoundError):
            return f"OpenAIモデルが利用できません: {message}"
        if isinstance(exc, AIDraftGenerationError):
            return message
        return f"OpenAI APIでエラーが発生しました: {message}"


goal_task_draft_service = GoalTaskDraftService()
