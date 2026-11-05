# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 040 and its rollback against an isolated PostgreSQL schema."""

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

PROPOSALS_MIGRATION = "039_add_agent_proposals.sql"
MIGRATION = "040_add_agent_writes.sql"
ROLLBACK = "040_add_agent_writes_rollback.sql"

USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000002"
TOKEN_ID = "00000000-0000-0000-0000-0000000000a1"

COLUMNS = [
    "id",
    "user_id",
    "actor",
    "agent_token_id",
    "agent_name",
    "proposal_id",
    "entity_type",
    "entity_id",
    "project_id",
    "goal_id",
    "action",
    "before",
    "after",
    "destructive",
    "reverts_change_id",
    "reverted_at",
    "created_at",
]

OLD_KINDS = [
    "goal",
    "task",
    "quick_task",
    "note_append",
    "contradiction",
    "decision_request",
    "experiment",
]
NEW_KINDS = ["goal_change", "task_change", "note_replace"]


def create_minimal_tables(cursor, schema: str) -> None:
    """Create what 039 and 040 require: users, agent_tokens and the trigger function."""
    s = f'"{schema}"'
    cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
    cursor.execute(
        f"""CREATE TABLE {s}.agent_tokens (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES {s}.users(id) ON DELETE CASCADE)"""
    )
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


def insert_change(cursor, schema: str, **overrides) -> str:
    """Insert one valid agent_changes row, overriding columns; returns its id."""
    values = {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "actor": "agent",
        "agent_token_id": TOKEN_ID,
        "agent_name": "tester",
        "entity_type": "task",
        "entity_id": str(uuid4()),
        "action": "create",
        "after": "{}",
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    cursor.execute(
        f'INSERT INTO "{schema}".agent_changes ({columns}) VALUES ({placeholders})',
        list(values.values()),
    )
    return str(values["id"])


def insert_proposal(cursor, schema: str, kind: str) -> None:
    cursor.execute(
        f"""INSERT INTO "{schema}".agent_proposals
        (user_id, agent_name, kind, title, payload, idempotency_key)
        VALUES (%s, 'tester', %s, 'Proposal', '{{}}', %s)""",
        (USER_ID, kind, f"key-{uuid4().hex}"),
    )


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"agent_writes_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            # Supabase grants new tables to these roles by default. Mirror that
            # so the privilege assertions actually exercise 040's REVOKE.
            cursor.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
                "GRANT ALL ON TABLES TO anon, authenticated"
            )
            create_minimal_tables(cursor, schema)
            run_migration(cursor, schema, PROPOSALS_MIGRATION)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def assert_violation(
    cursor, error_type, constraint: str, schema: str, **overrides
) -> None:
    """The insert must fail on the named constraint without poisoning the transaction."""
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(error_type) as excinfo:
        insert_change(cursor, schema, **overrides)
    assert excinfo.value.diag.constraint_name == constraint
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_040_applies_twice(db):
    # A manual application is not recorded in schema_migrations, so the
    # migration manager runs 040 again when the new API starts.
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    change_id = insert_change(cursor, schema)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        """SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = 'agent_changes'
        ORDER BY ordinal_position""",
        (schema,),
    )
    assert [row[0] for row in cursor.fetchall()] == COLUMNS
    cursor.execute(f'SELECT id::text FROM "{schema}".agent_changes')
    assert cursor.fetchall() == [(change_id,)]


def test_040_accepts_every_allowed_value(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    for entity_type in ("goal", "task", "context_note", "task_dependency"):
        insert_change(cursor, schema, entity_type=entity_type)
    for action in ("create", "update", "append", "replace"):
        insert_change(cursor, schema, action=action)
    insert_change(cursor, schema, action="revert", reverts_change_id=str(uuid4()))
    insert_change(cursor, schema, actor="user", agent_token_id=None, agent_name=None)
    # An agent change may lack a token (deleted later) and a name is optional.
    insert_change(cursor, schema, agent_token_id=None, agent_name=None)


def test_040_rejects_bad_enum_values(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(
        cursor, errors.CheckViolation, "ck_agent_changes_actor", schema, actor="bot"
    )
    assert_violation(
        cursor,
        errors.CheckViolation,
        "ck_agent_changes_entity_type",
        schema,
        entity_type="project",
    )
    assert_violation(
        cursor,
        errors.CheckViolation,
        "ck_agent_changes_action",
        schema,
        action="delete",
    )


def test_040_user_actor_has_no_agent_identity(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(
        cursor,
        errors.CheckViolation,
        "ck_agent_changes_user_actor_no_agent",
        schema,
        actor="user",
        agent_token_id=None,
        agent_name="tester",
    )
    assert_violation(
        cursor,
        errors.CheckViolation,
        "ck_agent_changes_user_actor_no_agent",
        schema,
        actor="user",
    )


def test_040_revert_requires_reverted_change(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    assert_violation(
        cursor,
        errors.CheckViolation,
        "ck_agent_changes_revert_has_target",
        schema,
        action="revert",
    )


def test_040_defaults(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    change_id = insert_change(cursor, schema)

    cursor.execute(
        f"""SELECT destructive, before IS NULL, created_at IS NOT NULL
        FROM "{schema}".agent_changes WHERE id = %s""",
        (change_id,),
    )
    assert cursor.fetchone() == (False, True, True)


def test_040_deleting_token_keeps_change(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    change_id = insert_change(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".agent_tokens WHERE id = %s', (TOKEN_ID,))
    cursor.execute(
        f"""SELECT agent_token_id IS NULL, agent_name
        FROM "{schema}".agent_changes WHERE id = %s""",
        (change_id,),
    )
    assert cursor.fetchone() == (True, "tester")


def test_040_deleting_user_deletes_changes(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_change(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".users WHERE id = %s', (USER_ID,))
    cursor.execute(f'SELECT count(*) FROM "{schema}".agent_changes')
    assert cursor.fetchone() == (0,)


def test_040_indexes(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        """SELECT indexname FROM pg_indexes
        WHERE schemaname = %s AND tablename = 'agent_changes' ORDER BY indexname""",
        (schema,),
    )
    assert [row[0] for row in cursor.fetchall()] == [
        "agent_changes_pkey",
        "idx_agent_changes_entity",
        "idx_agent_changes_user_created",
        "idx_agent_changes_user_goal_created",
        "idx_agent_changes_user_project_created",
    ]


def test_040_grants_select_only_to_authenticated_with_rls(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    table = f'"{schema}".agent_changes'

    for column in COLUMNS:
        cursor.execute(
            "SELECT has_column_privilege('authenticated', %s, %s, 'SELECT')",
            (table, column),
        )
        assert cursor.fetchone()[0] is True, column
    for privilege in ("INSERT", "UPDATE", "DELETE"):
        cursor.execute(
            "SELECT has_table_privilege('authenticated', %s, %s)", (table, privilege)
        )
        assert cursor.fetchone()[0] is False, privilege
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        cursor.execute("SELECT has_table_privilege('anon', %s, %s)", (table, privilege))
        assert cursor.fetchone()[0] is False, privilege
    cursor.execute("SELECT has_any_column_privilege('anon', %s, 'SELECT')", (table,))
    assert cursor.fetchone()[0] is False

    cursor.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    )
    assert cursor.fetchone()[0] is True
    cursor.execute(
        """SELECT policyname FROM pg_policies
        WHERE schemaname = %s AND tablename = 'agent_changes'""",
        (schema,),
    )
    assert cursor.fetchall() == [("agent_changes_own_rows",)]


def test_040_proposals_accept_the_new_kinds(db):
    cursor, schema = db
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(errors.CheckViolation):
        insert_proposal(cursor, schema, "task_change")
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")

    run_migration(cursor, schema, MIGRATION)

    for kind in OLD_KINDS + NEW_KINDS:
        insert_proposal(cursor, schema, kind)
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(errors.CheckViolation) as excinfo:
        insert_proposal(cursor, schema, "foo")
    assert excinfo.value.diag.constraint_name == "ck_agent_proposals_kind"
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_040_rollback_drops_table_and_restores_kinds(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_proposal(cursor, schema, "goal")
    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".agent_changes',))
    assert cursor.fetchone()[0] is None
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(errors.CheckViolation):
        insert_proposal(cursor, schema, "note_replace")
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")
    insert_proposal(cursor, schema, "experiment")

    run_migration(cursor, schema, ROLLBACK)


def test_040_rollback_fails_while_new_kinds_exist(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_proposal(cursor, schema, "task_change")

    cursor.execute("SAVEPOINT before_rollback")
    with pytest.raises(errors.RaiseException):
        run_migration(cursor, schema, ROLLBACK)
    cursor.execute("ROLLBACK TO SAVEPOINT before_rollback")

    # The failed rollback dropped nothing.
    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".agent_changes',))
    assert cursor.fetchone()[0] is not None
