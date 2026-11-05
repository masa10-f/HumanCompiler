# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""AgentProposal table model and its response schemas."""

import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlmodel import Session

from humancompiler_api.models import (
    AgentProposal,
    AgentProposalResponse,
    ProposalKind,
    ProposalRejectCategory,
    ProposalResponse,
    ProposalResultType,
    ProposalStatus,
)
from tests.agent_api_helpers import seed_user

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "039_add_agent_proposals.sql"
)


def migration_columns() -> set[str]:
    body = MIGRATION.read_text().split("CREATE TABLE IF NOT EXISTS", 1)[1]
    body = body.split("CONSTRAINT", 1)[0]
    return set(re.findall(r"^\s{4}([a-z_]+) [A-Z]", body, flags=re.MULTILINE))


def test_model_columns_match_migration_039():
    columns = {column.name for column in AgentProposal.__table__.columns}  # type: ignore[attr-defined]

    assert len(columns) == 21
    assert columns == migration_columns()


def test_enum_values_match_migration_check_constraints():
    sql = MIGRATION.read_text()

    def check_values(constraint: str) -> set[str]:
        clause = sql.split(f"CONSTRAINT {constraint} CHECK", 1)[1].split("),", 1)[0]
        return set(re.findall(r"'([a-z_]+)'", clause))

    assert check_values("ck_agent_proposals_kind") == {k.value for k in ProposalKind}
    assert check_values("ck_agent_proposals_status") == {
        s.value for s in ProposalStatus
    }
    assert check_values("ck_agent_proposals_reject_category") == {
        c.value for c in ProposalRejectCategory
    }
    assert check_values("ck_agent_proposals_result_type") == {
        t.value for t in ProposalResultType
    }


def make_row(session: Session, **overrides) -> AgentProposal:
    user = seed_user(session, uuid4())
    row = AgentProposal(
        id=uuid4(),
        user_id=user,
        agent_name="research-agent",
        kind=ProposalKind.QUICK_TASK.value,
        title="Read the paper",
        payload={"title": "Read the paper"},
        idempotency_key="key-1",
        **overrides,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def test_row_defaults_round_trip(session: Session):
    row = make_row(session)

    assert row.id is not None
    assert row.status == "pending"
    assert row.rationale == ""
    assert row.sources == []
    assert row.final_payload is None
    # SQL NULL, not the JSON value null.
    assert (
        session.exec(
            text("SELECT final_payload IS NULL FROM agent_proposals")
        ).scalar_one()
        == 1
    )
    assert row.created_at is not None and row.updated_at is not None


def test_response_hides_token_and_builds_result(session: Session):
    result_id = uuid4()
    row = make_row(
        session,
        status=ProposalStatus.ACCEPTED.value,
        result_type=ProposalResultType.QUICK_TASK.value,
        result_id=result_id,
        token_id=None,
        decided_at=datetime(2026, 11, 2, 1, 2, 3),
    )

    response = AgentProposalResponse.from_row(row)
    dumped = response.model_dump(mode="json")

    assert "token_id" not in dumped
    assert dumped["result"] == {"type": "quick_task", "id": str(result_id)}
    assert dumped["kind"] == "quick_task"
    assert dumped["status"] == "accepted"
    assert dumped["decided_at"].endswith("+00:00")
    assert dumped["created_at"].endswith("+00:00")


def test_response_without_result_and_web_extension(session: Session):
    row = make_row(session)

    response = ProposalResponse(
        **AgentProposalResponse.from_row(row).model_dump(),
        project_name=None,
        goal_title="Goal",
        task_title=None,
    )
    dumped = response.model_dump(mode="json")

    assert dumped["result"] is None
    assert dumped["decided_at"] is None
    assert dumped["goal_title"] == "Goal"
    assert dumped["created_at"] == row.created_at.replace(tzinfo=UTC).isoformat()
