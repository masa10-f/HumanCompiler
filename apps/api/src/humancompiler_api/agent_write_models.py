# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Request bodies for agent writes (``/api/agent/v1`` POST and PATCH).

The limits match ``GoalUpdate`` / ``TaskUpdate`` in ``models.py``. Updates only
change the fields that were sent, so an unset field and an explicit ``null``
mean different things; ``model_fields_set`` tells them apart.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, ClassVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from humancompiler_api.models import GoalStatus, TaskStatus, WorkType
from humancompiler_api.proposal_payloads import DueDate

Hours = Annotated[Decimal, Field(gt=0, max_digits=5, decimal_places=2)]
Priority = Annotated[int, Field(ge=1, le=5)]

EXPECTED_UPDATED_AT_DESCRIPTION = (
    "The updated_at you last read. If the stored value differs, nothing is "
    "written and the answer is 409 with the current updated_at."
)


class _AgentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _AgentUpdate(_AgentWrite):
    """A partial update: only the fields that were sent change.

    Optional fields default to None so they can be left out; the fields in
    ``NOT_NULLABLE`` reject an explicit ``null``.
    """

    NOT_NULLABLE: ClassVar[frozenset[str]] = frozenset()

    expected_updated_at: datetime = Field(description=EXPECTED_UPDATED_AT_DESCRIPTION)

    @model_validator(mode="after")
    def reject_null_for_required_fields(self) -> "_AgentUpdate":
        for name in sorted(self.NOT_NULLABLE & self.model_fields_set):
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def sent_fields(self) -> set[str]:
        """The entity fields the request sets (null included)."""
        return self.model_fields_set - {"expected_updated_at"}


class AgentGoalCreate(_AgentWrite):
    project_id: UUID
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    due_date: DueDate = None


class AgentGoalUpdate(_AgentUpdate):
    NOT_NULLABLE: ClassVar[frozenset[str]] = frozenset({"title", "status"})

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    due_date: DueDate = None
    status: GoalStatus | None = None


class AgentTaskCreate(_AgentWrite):
    goal_id: UUID
    title: str = Field(min_length=1, max_length=200)
    estimate_hours: Hours
    description: str | None = Field(default=None, max_length=1000)
    due_date: DueDate = None
    priority: Priority | None = Field(
        default=None, description="1 (highest) to 5 (lowest). Omitted or null: 3."
    )
    work_type: WorkType | None = Field(
        default=None, description="Omitted or null: light_work."
    )


class AgentTaskUpdate(_AgentUpdate):
    NOT_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"title", "estimate_hours", "status", "goal_id", "memo_append"}
    )

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    memo: str | None = Field(default=None, max_length=2000)
    memo_append: str | None = Field(
        default=None,
        min_length=1,
        max_length=2000,
        description=(
            "Text added to the end of memo, after a newline. Not a destructive "
            "change. Cannot be sent with memo."
        ),
    )
    estimate_hours: Hours | None = None
    due_date: DueDate = None
    status: TaskStatus | None = None
    priority: Priority | None = Field(
        default=None, description="1 (highest) to 5 (lowest). null resets it to 3."
    )
    work_type: WorkType | None = Field(
        default=None, description="null resets it to light_work."
    )
    goal_id: UUID | None = Field(
        default=None, description="Move the task to another goal (destructive)."
    )

    @model_validator(mode="after")
    def reject_memo_with_memo_append(self) -> "AgentTaskUpdate":
        if {"memo", "memo_append"} <= self.model_fields_set:
            raise ValueError("Send memo or memo_append, not both")
        return self
