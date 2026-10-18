# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 036 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
import os
from uuid import uuid4

import psycopg2
import pytest

from tests.postgres_migration_helpers import create_supabase_objects, run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "036_add_agent_audit_logs.sql"
ROLLBACK = "036_add_agent_audit_logs_rollback.sql"

USER_ID = "00000000-0000-0000-0000-000000000001"
TOKEN_ID = "00000000-0000-0000-0000-0000000000a1"
LOG_ID = "00000000-0000-0000-0000-0000000000b1"

COLUMNS = {
    "id",
    "token_id",
    "user_id",
    "token_prefix",
    "method",
    "route",
    "required_scope",
    "status_code",
    "duration_ms",
    "client_ip",
    "created_at",
}


def create_minimal_tables(cursor, schema: str) -> None:
    """Create only the tables that 036 references."""
    s = f'"{schema}"'
    cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
    cursor.execute(
        f"""CREATE TABLE {s}.agent_tokens (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES {s}.users(id) ON DELETE CASCADE)"""
    )


def insert_audit_row(cursor, schema: str) -> None:
    s = f'"{schema}"'
    cursor.execute(f"INSERT INTO {s}.users (id) VALUES (%s)", (USER_ID,))
    cursor.execute(
        f"INSERT INTO {s}.agent_tokens (id, user_id) VALUES (%s, %s)",
        (TOKEN_ID, USER_ID),
    )
    cursor.execute(
        f"""INSERT INTO {s}.agent_audit_logs
            (id, token_id, user_id, token_prefix, method, route, required_scope,
             status_code, duration_ms, client_ip)
        VALUES (%s, %s, %s, 'hc_agent_aaaaaaaa', 'GET', '/api/agent/v1/tasks/{{task_id}}',
                'tasks:read', 200, 12, '203.0.113.7')""",
        (LOG_ID, TOKEN_ID, USER_ID),
    )


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"agent_audit_logs_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            # Supabase grants new tables to these roles by default. Mirror that
            # so the privilege assertions actually exercise 036's REVOKE.
            cursor.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
                "GRANT ALL ON TABLES TO anon, authenticated"
            )
            create_minimal_tables(cursor, schema)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def test_036_creates_table_and_indexes(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        """SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = 'agent_audit_logs'""",
        (schema,),
    )
    assert {row[0] for row in cursor.fetchall()} == COLUMNS

    cursor.execute(
        """SELECT indexname FROM pg_indexes
        WHERE schemaname = %s AND tablename = 'agent_audit_logs'""",
        (schema,),
    )
    indexes = {row[0] for row in cursor.fetchall()}
    assert "idx_agent_audit_logs_user_created" in indexes
    assert "idx_agent_audit_logs_token_created" in indexes


def test_036_can_be_applied_twice(db):
    # A manual application is not recorded in schema_migrations, so the
    # migration manager runs 036 again when the new API starts.
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_audit_row(cursor, schema)

    run_migration(cursor, schema, MIGRATION)
    cursor.execute(f'SELECT id::text FROM "{schema}".agent_audit_logs')
    assert cursor.fetchall() == [(LOG_ID,)]


def test_036_grants_select_only_on_listed_columns(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    table = f'"{schema}".agent_audit_logs'

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
    cursor.execute("SELECT has_any_column_privilege('anon', %s, 'SELECT')", (table,))
    assert cursor.fetchone()[0] is False

    cursor.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    )
    assert cursor.fetchone()[0] is True
    cursor.execute(
        """SELECT policyname FROM pg_policies
        WHERE schemaname = %s AND tablename = 'agent_audit_logs'""",
        (schema,),
    )
    assert cursor.fetchall() == [("agent_audit_logs_own_rows",)]


def test_036_deleting_user_deletes_their_audit_rows(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_audit_row(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".users WHERE id = %s', (USER_ID,))
    cursor.execute(f'SELECT count(*) FROM "{schema}".agent_audit_logs')
    assert cursor.fetchone()[0] == 0


def test_036_deleting_token_keeps_row_with_null_token_id(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    insert_audit_row(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".agent_tokens WHERE id = %s', (TOKEN_ID,))
    cursor.execute(
        f"""SELECT token_id IS NULL, user_id::text
        FROM "{schema}".agent_audit_logs WHERE id = %s""",
        (LOG_ID,),
    )
    assert cursor.fetchone() == (True, USER_ID)


def test_036_rollback_drops_table(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".agent_audit_logs',))
    assert cursor.fetchone()[0] is None
