# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 039 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
import os
from uuid import uuid4

import psycopg2
from psycopg2 import errors
import pytest

from tests.postgres_migration_helpers import create_supabase_objects, run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "039_add_agent_proposals.sql"
ROLLBACK = "039_add_agent_proposals_rollback.sql"

USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000002"
TOKEN_ID = "00000000-0000-0000-0000-0000000000a1"

COLUMNS = [
    "id",
    "user_id",
    "token_id",
    "agent_name",
    "kind",
    "title",
    "rationale",
    "payload",
    "final_payload",
    "sources",
    "idempotency_key",
    "project_id",
    "status",
    "reject_category",
    "decision_note",
    "decision_option",
    "result_type",
    "result_id",
    "decided_at",
    "created_at",
    "updated_at",
]


def create_minimal_tables(cursor, schema: str) -> None:
    """Create only what 039 requires: users, agent_tokens and the trigger function."""
    s = f'"{schema}"'
    cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
    cursor.execute(
        f"""CREATE TABLE {s}.agent_tokens (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES {s}.users(id) ON DELETE CASCADE)"""
    )
    # The real function uses NOW(), which is constant within a transaction.
    # clock_timestamp() lets one transaction observe the trigger firing.
    cursor.execute(
        f"""CREATE FUNCTION {s}.update_updated_at_column() RETURNS trigger
            LANGUAGE plpgsql AS 'BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END'"""
    )
    cursor.execute(
        f"INSERT INTO {s}.users (id) VALUES (%s), (%s)", (USER_ID, OTHER_USER_ID)
    )
    cursor.execute(
        f"INSERT INTO {s}.agent_tokens (id, user_id) VALUES (%s, %s)",
        (TOKEN_ID, USER_ID),
    )


def insert_proposal(cursor, schema: str, **overrides) -> str:
    """Insert one valid proposal, overriding columns; returns its id."""
    values = {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "token_id": TOKEN_ID,
        "agent_name": "tester",
        "kind": "goal",
        "title": "Proposal",
        "payload": "{}",
        "idempotency_key": f"key-{uuid4().hex}",
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    cursor.execute(
        f'INSERT INTO "{schema}".agent_proposals ({columns}) VALUES ({placeholders})',
        list(values.values()),
    )
    return str(values["id"])


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"agent_proposals_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            # Supabase grants new tables to these roles by default. Mirror that
            # so the privilege assertions actually exercise 039's REVOKE.
            cursor.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
                "GRANT ALL ON TABLES TO anon, authenticated"
            )
            create_minimal_tables(cursor, schema)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def assert_violation(cursor, error_type, schema: str, **overrides) -> None:
    """The insert must fail with error_type without poisoning the transaction."""
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(error_type):
        insert_proposal(cursor, schema, **overrides)
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_039_applies_twice(db):
    # A manual application is not recorded in schema_migrations, so the
    # migration manager runs 039 again when the new API starts.
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    proposal_id = insert_proposal(cursor, schema)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        """SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = 'agent_proposals'
        ORDER BY ordinal_position""",
        (schema,),
    )
    assert [row[0] for row in cursor.fetchall()] == COLUMNS
    cursor.execute(f'SELECT id::text FROM "{schema}".agent_proposals')
    assert cursor.fetchall() == [(proposal_id,)]


def test_039_rejects_unknown_kind_status_category(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(cursor, errors.CheckViolation, schema, kind="foo")
    assert_violation(cursor, errors.CheckViolation, schema, status="done")
    assert_violation(cursor, errors.CheckViolation, schema, reject_category="meh")
    assert_violation(cursor, errors.CheckViolation, schema, result_type="project")
    assert_violation(cursor, errors.CheckViolation, schema, title="")

    for kind in (
        "goal",
        "task",
        "quick_task",
        "note_append",
        "contradiction",
        "decision_request",
        "experiment",
    ):
        insert_proposal(cursor, schema, kind=kind)
    for status in ("pending", "accepted", "edited"):
        insert_proposal(cursor, schema, status=status)
    for category in ("duplicate", "wrong", "not_valuable", "not_now", "other"):
        insert_proposal(cursor, schema, status="rejected", reject_category=category)
    for result_type in ("goal", "task", "quick_task", "context_note"):
        insert_proposal(cursor, schema, result_type=result_type)


def test_039_rejected_requires_category(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(cursor, errors.CheckViolation, schema, status="rejected")
    insert_proposal(cursor, schema, status="rejected", reject_category="wrong")


def test_039_decision_note_length(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(cursor, errors.CheckViolation, schema, decision_note="a" * 4001)
    insert_proposal(cursor, schema, decision_note="a" * 4000)


def test_039_idempotency_key_unique_per_user(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_proposal(cursor, schema, idempotency_key="same-key")

    assert_violation(cursor, errors.UniqueViolation, schema, idempotency_key="same-key")
    insert_proposal(
        cursor, schema, user_id=OTHER_USER_ID, token_id=None, idempotency_key="same-key"
    )


def test_039_updated_at_trigger(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    proposal_id = insert_proposal(cursor, schema)
    cursor.execute(
        f'SELECT updated_at FROM "{schema}".agent_proposals WHERE id = %s',
        (proposal_id,),
    )
    before = cursor.fetchone()[0]

    cursor.execute(
        f"""UPDATE "{schema}".agent_proposals
        SET status = 'accepted', reject_category = NULL WHERE id = %s""",
        (proposal_id,),
    )
    cursor.execute(
        f'SELECT updated_at FROM "{schema}".agent_proposals WHERE id = %s',
        (proposal_id,),
    )
    assert cursor.fetchone()[0] > before


def test_039_deleting_token_keeps_proposal(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    proposal_id = insert_proposal(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".agent_tokens WHERE id = %s', (TOKEN_ID,))
    cursor.execute(
        f"""SELECT token_id IS NULL, user_id::text
        FROM "{schema}".agent_proposals WHERE id = %s""",
        (proposal_id,),
    )
    assert cursor.fetchone() == (True, USER_ID)


def test_039_rollback_drops_table(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".agent_proposals',))
    assert cursor.fetchone()[0] is None

    run_migration(cursor, schema, ROLLBACK)
