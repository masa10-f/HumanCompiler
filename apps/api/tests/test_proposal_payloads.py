# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""Payload validation for agent proposals."""

from typing import Any
from uuid import uuid4

import pytest
from pydantic import ValidationError

from humancompiler_api.models import ProposalKind
from humancompiler_api.proposal_payloads import (
    EDITABLE_KINDS,
    PAYLOAD_MODELS,
    ProposalCreateRequest,
    normalize_payload,
)

PROJECT_ID = str(uuid4())
GOAL_ID = str(uuid4())

MINIMAL_PAYLOADS: dict[ProposalKind, dict[str, Any]] = {
    ProposalKind.GOAL: {"project_id": PROJECT_ID, "title": "Goal"},
    ProposalKind.TASK: {"goal_id": GOAL_ID, "title": "Task", "estimate_hours": 1},
    ProposalKind.QUICK_TASK: {"title": "Quick"},
    ProposalKind.NOTE_APPEND: {
        "target": {"project_id": PROJECT_ID},
        "content_markdown": "memo",
    },
    ProposalKind.CONTRADICTION: {
        "claims": [{"text": "A"}, {"text": "B"}],
        "explanation": "A and B disagree",
    },
    ProposalKind.DECISION_REQUEST: {"question": "Which one?"},
    ProposalKind.EXPERIMENT: {
        "question": "q",
        "method": "m",
        "supports_if": "s",
        "refutes_if": "r",
        "effort": "e",
    },
}


def make_request(kind: ProposalKind, payload: dict[str, Any], **overrides: Any):
    fields: dict[str, Any] = {
        "kind": kind,
        "title": "Title",
        "payload": payload,
        "idempotency_key": "key-1",
        **overrides,
    }
    return ProposalCreateRequest(**fields)


def test_every_kind_has_a_minimal_payload_and_model():
    assert set(MINIMAL_PAYLOADS) == set(ProposalKind)
    assert set(PAYLOAD_MODELS) == set(ProposalKind)
    assert EDITABLE_KINDS == {
        ProposalKind.GOAL,
        ProposalKind.TASK,
        ProposalKind.QUICK_TASK,
        ProposalKind.NOTE_APPEND,
        ProposalKind.EXPERIMENT,
    }


@pytest.mark.parametrize("kind", list(ProposalKind))
def test_each_kind_accepts_minimal_payload(kind: ProposalKind):
    request = make_request(kind, MINIMAL_PAYLOADS[kind])

    assert request.kind == kind
    assert request.rationale == ""
    assert request.sources == []


@pytest.mark.parametrize("kind", list(ProposalKind))
def test_extra_field_is_rejected(kind: ProposalKind):
    payload = {**MINIMAL_PAYLOADS[kind], "unknown": "x"}

    with pytest.raises(ValidationError):
        make_request(kind, payload)


def test_extra_field_in_request_is_rejected():
    with pytest.raises(ValidationError):
        make_request(ProposalKind.QUICK_TASK, {"title": "Quick"}, token_id="x")


@pytest.mark.parametrize(
    "target",
    [{}, {"project_id": PROJECT_ID, "goal_id": GOAL_ID}],
)
def test_note_target_requires_exactly_one(target: dict[str, Any]):
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.NOTE_APPEND,
            {"target": target, "content_markdown": "memo"},
        )


def test_task_requires_estimate_hours():
    with pytest.raises(ValidationError):
        make_request(ProposalKind.TASK, {"goal_id": GOAL_ID, "title": "Task"})

    make_request(ProposalKind.QUICK_TASK, {"title": "Quick"})


@pytest.mark.parametrize("hours", [0, -1, "1.001", "1000.00"])
def test_estimate_hours_bounds(hours: Any):
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.TASK,
            {"goal_id": GOAL_ID, "title": "Task", "estimate_hours": hours},
        )


def test_due_date_requires_timezone():
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.GOAL,
            {
                "project_id": PROJECT_ID,
                "title": "Goal",
                "due_date": "2026-11-03T09:00:00",
            },
        )


def test_date_only_due_date_is_treated_as_jst_midnight():
    request = make_request(
        ProposalKind.GOAL,
        {"project_id": PROJECT_ID, "title": "Goal", "due_date": "2026-11-03"},
    )

    assert request.payload["due_date"] == "2026-11-02T15:00:00Z"


def test_length_limits():
    with pytest.raises(ValidationError):
        make_request(ProposalKind.QUICK_TASK, {"title": "Quick"}, title="x" * 201)
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.QUICK_TASK,
            {"title": "Quick"},
            sources=[{"ref": f"ref-{i}"} for i in range(21)],
        )
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.CONTRADICTION,
            {"claims": [{"text": "A"}], "explanation": "e"},
        )
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.DECISION_REQUEST,
            {"question": "q", "options": [{"label": f"o{i}"} for i in range(7)]},
        )
    with pytest.raises(ValidationError):
        make_request(
            ProposalKind.NOTE_APPEND,
            {"target": {"task_id": str(uuid4())}, "content_markdown": "x" * 20001},
        )


def test_length_limits_accept_the_boundaries():
    make_request(ProposalKind.QUICK_TASK, {"title": "Quick"}, title="x" * 200)
    make_request(
        ProposalKind.QUICK_TASK,
        {"title": "Quick"},
        sources=[{"ref": f"ref-{i}"} for i in range(20)],
    )
    make_request(
        ProposalKind.DECISION_REQUEST,
        {"question": "q", "options": [{"label": f"o{i}"} for i in range(6)]},
    )
    make_request(
        ProposalKind.NOTE_APPEND,
        {"target": {"task_id": str(uuid4())}, "content_markdown": "x" * 20000},
    )


def test_normalize_payload_is_stable():
    base = {"goal_id": GOAL_ID, "title": "Task"}
    first = normalize_payload(
        ProposalKind.TASK,
        {**base, "estimate_hours": "1.0", "due_date": "2026-11-03T09:00:00+09:00"},
    )
    second = normalize_payload(
        ProposalKind.TASK,
        {**base, "estimate_hours": 1, "due_date": "2026-11-03T00:00:00Z"},
    )

    assert first == second
    assert normalize_payload(ProposalKind.TASK, first) == first


def test_request_replaces_payload_with_normalized_form():
    request = make_request(
        ProposalKind.QUICK_TASK,
        {"title": "Quick", "estimate_hours": "2.50"},
    )

    assert request.payload == normalize_payload(
        ProposalKind.QUICK_TASK, {"title": "Quick", "estimate_hours": 2.5}
    )
    assert request.payload["description"] is None
