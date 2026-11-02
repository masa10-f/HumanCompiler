# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Per-kind payload schemas for agent proposals.

The payload is validated and normalised once, when the proposal is received and
again when the user edits it. Normalising makes two spellings of the same value
(``"1.0"`` and ``1`` hours, ``09:00+09:00`` and ``00:00Z``) dump identically, so
comparing dumps tells a real edit from a change of notation.
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    ValidationError,
    model_validator,
)

from humancompiler_api.models import (
    ProposalKind,
    ProposalRejectCategory,
    WorkType,
    prepare_due_date,
    require_due_date_timezone,
)


def _due_date_to_utc(value: datetime | None) -> datetime | None:
    """Require an offset, then express the instant in UTC."""
    checked = require_due_date_timezone(value)
    return checked.astimezone(UTC) if checked is not None else None


# A bare date means 00:00 JST; every value is stored as the same instant in UTC.
DueDate = Annotated[
    datetime | None,
    BeforeValidator(prepare_due_date),
    AfterValidator(_due_date_to_utc),
]

# Dumped as a float so that 1, "1.0" and Decimal("1.00") all become 1.0.
Hours = Annotated[
    Decimal,
    PlainSerializer(float, return_type=float, when_used="json"),
]

_FORBID_EXTRA = ConfigDict(extra="forbid")


class _Payload(BaseModel):
    model_config = _FORBID_EXTRA


class ProposalSource(BaseModel):
    """Where the agent got the idea: a reference, with an optional quote."""

    model_config = _FORBID_EXTRA

    ref: str = Field(min_length=1, max_length=500)
    quote: str | None = Field(default=None, max_length=1000)
    label: str | None = Field(default=None, max_length=200)


class GoalProposalPayload(_Payload):
    project_id: UUID
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    due_date: DueDate = None


class TaskProposalPayload(_Payload):
    goal_id: UUID
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    estimate_hours: Annotated[Hours, Field(gt=0, max_digits=5, decimal_places=2)]
    due_date: DueDate = None
    work_type: WorkType | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class QuickTaskProposalPayload(_Payload):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    estimate_hours: (
        Annotated[Hours, Field(gt=0, max_digits=5, decimal_places=2)] | None
    ) = None
    due_date: DueDate = None
    work_type: WorkType | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class NoteTarget(_Payload):
    project_id: UUID | None = None
    goal_id: UUID | None = None
    task_id: UUID | None = None

    @model_validator(mode="after")
    def require_exactly_one_target(self) -> "NoteTarget":
        set_count = sum(
            value is not None for value in (self.project_id, self.goal_id, self.task_id)
        )
        if set_count != 1:
            raise ValueError("exactly one of project_id, goal_id, task_id is required")
        return self


class NoteAppendPayload(_Payload):
    target: NoteTarget
    content_markdown: str = Field(min_length=1, max_length=20000)


class ContradictionClaim(BaseModel):
    model_config = _FORBID_EXTRA

    text: str = Field(min_length=1, max_length=4000)
    source_ref: str | None = Field(default=None, max_length=500)


class ContradictionPayload(_Payload):
    project_id: UUID | None = None
    claims: list[ContradictionClaim] = Field(min_length=2, max_length=5)
    explanation: str = Field(min_length=1, max_length=4000)
    suggested_resolution: str | None = Field(default=None, max_length=4000)


class DecisionOption(BaseModel):
    model_config = _FORBID_EXTRA

    label: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)


class DecisionRequestPayload(_Payload):
    project_id: UUID | None = None
    question: str = Field(min_length=1, max_length=4000)
    options: list[DecisionOption] = Field(default_factory=list, max_length=6)
    recommendation: str | None = Field(default=None, max_length=4000)
    context: str | None = Field(default=None, max_length=4000)


class ExperimentPayload(_Payload):
    project_id: UUID | None = None
    question: str = Field(min_length=1, max_length=4000)
    method: str = Field(min_length=1, max_length=4000)
    supports_if: str = Field(min_length=1, max_length=4000)
    refutes_if: str = Field(min_length=1, max_length=4000)
    effort: str = Field(min_length=1, max_length=4000)
    estimated_hours: (
        Annotated[Hours, Field(gt=0, max_digits=5, decimal_places=2)] | None
    ) = None
    prerequisites: str | None = Field(default=None, max_length=4000)


PAYLOAD_MODELS: dict[ProposalKind, type[BaseModel]] = {
    ProposalKind.GOAL: GoalProposalPayload,
    ProposalKind.TASK: TaskProposalPayload,
    ProposalKind.QUICK_TASK: QuickTaskProposalPayload,
    ProposalKind.NOTE_APPEND: NoteAppendPayload,
    ProposalKind.CONTRADICTION: ContradictionPayload,
    ProposalKind.DECISION_REQUEST: DecisionRequestPayload,
    ProposalKind.EXPERIMENT: ExperimentPayload,
}

# Kinds whose payload the user may edit before accepting. A contradiction or a
# decision request is answered, not edited.
EDITABLE_KINDS: frozenset[ProposalKind] = frozenset(
    {
        ProposalKind.GOAL,
        ProposalKind.TASK,
        ProposalKind.QUICK_TASK,
        ProposalKind.NOTE_APPEND,
        ProposalKind.EXPERIMENT,
    }
)


def parse_payload(kind: ProposalKind, data: dict[str, Any]) -> BaseModel:
    """Validate ``data`` against the schema of ``kind``.

    Raises ``pydantic.ValidationError`` unchanged."""
    return PAYLOAD_MODELS[kind].model_validate(data)


def normalize_payload(kind: ProposalKind, data: dict[str, Any]) -> dict[str, Any]:
    """Validate ``data`` and dump it in a form that does not depend on notation."""
    return parse_payload(kind, data).model_dump(mode="json")


def _contains_nul(value: Any) -> bool:
    """Whether any string in ``value`` (keys included) holds a NUL character."""
    if isinstance(value, str):
        return "\x00" in value
    if isinstance(value, dict):
        return any(
            _contains_nul(key) or _contains_nul(item) for key, item in value.items()
        )
    if isinstance(value, list | tuple):
        return any(_contains_nul(item) for item in value)
    return False


class _NoNulRequest(BaseModel):
    """A request body in which no string may contain NUL.

    PostgreSQL refuses NUL (U+0000) in TEXT and in JSONB, so such a
    string would fail at commit with a 500. Checking the raw body here covers
    every field, nested payload strings included, and answers 422."""

    @model_validator(mode="before")
    @classmethod
    def reject_nul(cls, data: Any) -> Any:
        if _contains_nul(data):
            raise ValueError("strings must not contain the NUL character (U+0000)")
        return data


def _describe(error: ValidationError) -> str:
    return "; ".join(
        ".".join(str(part) for part in item["loc"]) + ": " + item["msg"]
        for item in error.errors(include_url=False, include_context=False)
    )


class ProposalCreateRequest(_NoNulRequest):
    """Body of POST /api/agent/v1/proposals."""

    model_config = _FORBID_EXTRA

    kind: ProposalKind
    title: str = Field(min_length=1, max_length=200)
    rationale: str = Field(default="", max_length=4000)
    payload: dict[str, Any]
    sources: list[ProposalSource] = Field(default_factory=list, max_length=20)
    idempotency_key: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_payload_for_kind(self) -> "ProposalCreateRequest":
        try:
            self.payload = normalize_payload(self.kind, self.payload)
        except ValidationError as error:
            raise ValueError(
                f"invalid payload for {self.kind.value}: {_describe(error)}"
            ) from error
        return self


class ProposalAcceptRequest(_NoNulRequest):
    """Body of the accept action. ``payload`` is the user's edited version."""

    model_config = _FORBID_EXTRA

    payload: dict[str, Any] | None = None
    decision_note: str | None = Field(default=None, max_length=4000)
    decision_option: int | None = Field(default=None, ge=0, le=5)


class ProposalRejectRequest(_NoNulRequest):
    """Body of the reject action."""

    model_config = _FORBID_EXTRA

    reject_category: ProposalRejectCategory
    decision_note: str | None = Field(default=None, max_length=4000)
