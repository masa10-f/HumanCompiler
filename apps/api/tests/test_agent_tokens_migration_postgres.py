# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 035 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
import os
from pathlib import Path
from uuid import uuid4

import psycopg2
import pytest

from humancompiler_api.migration_manager import MigrationManager

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "035_add_agent_tokens.sql"
ROLLBACK = "035_add_agent_tokens_rollback.sql"

USER_ID = "00000000-0000-0000-0000-000000000001"
ACTIVE_ID = "00000000-0000-0000-0000-0000000000a1"
REVOKED_ID = "00000000-0000-0000-0000-0000000000a2"
NULL_TIMES_ID = "00000000-0000-0000-0000-0000000000a3"
TASK_ID = "00000000-0000-0000-0000-0000000000c1"
LOG_WITH_CREATED_ID = "00000000-0000-0000-0000-0000000000d1"
LOG_WITHOUT_CREATED_ID = "00000000-0000-0000-0000-0000000000d2"

TOKEN_COLUMNS = "id, user_id, name, token_hash, token_prefix, last_used_at, revoked_at"


def migration_statements(name: str) -> list[str]:
    path = Path(__file__).parents[1] / "migrations" / name
    manager = MigrationManager.__new__(MigrationManager)
    return manager._split_sql_statements(path.read_text())


def run_migration(cursor, schema: str, name: str) -> None:
    for statement in migration_statements(name):
        cursor.execute(statement.replace("public.", f'"{schema}".'))


def create_supabase_objects(cursor) -> None:
    # Only create what is missing, so a Supabase database keeps its own definitions.
    cursor.execute(
        """
        DO $$
        BEGIN
            IF to_regrole('anon') IS NULL THEN
                CREATE ROLE anon NOLOGIN;
            END IF;
            IF to_regrole('authenticated') IS NULL THEN
                CREATE ROLE authenticated NOLOGIN;
            END IF;
        END $$
        """
    )
    cursor.execute("CREATE SCHEMA IF NOT EXISTS auth")
    cursor.execute(
        """
        DO $$
        BEGIN
            IF to_regprocedure('auth.uid()') IS NULL THEN
                CREATE FUNCTION auth.uid() RETURNS uuid
                    LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
            END IF;
        END $$
        """
    )


def create_minimal_tables(cursor, schema: str) -> None:
    """Create only the tables and columns that 035 touches."""
    s = f'"{schema}"'
    statements = [
        f"""
        CREATE FUNCTION {s}.update_updated_at_column() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END
        $$
        """,
        f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)",
        f"""CREATE TABLE {s}.projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        f"""CREATE TABLE {s}.goals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        f"""CREATE TABLE {s}.tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        f"""CREATE TABLE {s}.work_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        # Same columns as 001_initial_schema.sql.
        f"""CREATE TABLE {s}.logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id UUID NOT NULL REFERENCES {s}.tasks(id) ON DELETE CASCADE,
            actual_minutes INTEGER NOT NULL CHECK (actual_minutes > 0),
            comment TEXT CHECK (length(comment) <= 500),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())""",
        f"""CREATE TABLE {s}.quick_tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title VARCHAR(200) NOT NULL DEFAULT 'quick',
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        f"""CREATE TABLE {s}.context_notes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT NOW())""",
        f"""CREATE TABLE {s}.daily_plan_documents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            revision INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""",
        # Same columns as 024_add_hook_tokens.sql.
        f"""CREATE TABLE {s}.hook_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES {s}.users(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            token_prefix VARCHAR(16) NOT NULL,
            last_used_at TIMESTAMP WITH TIME ZONE,
            revoked_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())""",
        f"""COMMENT ON TABLE {s}.hook_tokens IS
            'User-scoped hashed tokens for external hook ingestion'""",
    ]
    for statement in statements:
        cursor.execute(statement)


def seed_rows(cursor, schema: str) -> None:
    s = f'"{schema}"'
    cursor.execute(f"INSERT INTO {s}.users (id) VALUES (%s)", (USER_ID,))
    cursor.execute(
        f"""INSERT INTO {s}.hook_tokens
            (id, user_id, name, token_hash, token_prefix, last_used_at, revoked_at,
             created_at, updated_at)
        VALUES
            (%s, %s, 'active', %s, 'hc_hook_aaaaaaaa', '2026-10-01T00:00:00Z', NULL,
             '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'),
            (%s, %s, 'revoked', %s, 'hc_hook_bbbbbbbb', NULL, '2026-10-02T00:00:00Z',
             '2026-09-03T00:00:00Z', '2026-10-02T00:00:00Z'),
            (%s, %s, 'null times', %s, 'hc_hook_cccccccc', NULL, NULL, NULL, NULL)
        """,
        (
            ACTIVE_ID,
            USER_ID,
            "a" * 64,
            REVOKED_ID,
            USER_ID,
            "b" * 64,
            NULL_TIMES_ID,
            USER_ID,
            "c" * 64,
        ),
    )
    cursor.execute(f"INSERT INTO {s}.tasks (id) VALUES (%s)", (TASK_ID,))
    cursor.execute(
        f"""INSERT INTO {s}.logs (id, task_id, actual_minutes, created_at) VALUES
            (%s, %s, 30, '2026-08-01T09:00:00Z'),
            (%s, %s, 15, NULL)""",
        (LOG_WITH_CREATED_ID, TASK_ID, LOG_WITHOUT_CREATED_ID, TASK_ID),
    )


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"agent_tokens_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            create_minimal_tables(cursor, schema)
            seed_rows(cursor, schema)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def test_035_copies_hook_tokens_including_revoked_and_null_timestamps(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    cursor.execute(f'SELECT {TOKEN_COLUMNS} FROM "{schema}".hook_tokens ORDER BY id')
    hook_rows = cursor.fetchall()
    cursor.execute(f'SELECT {TOKEN_COLUMNS} FROM "{schema}".agent_tokens ORDER BY id')
    assert cursor.fetchall() == hook_rows
    assert len(hook_rows) == 3

    cursor.execute(
        f"""SELECT id::text, scopes, revoked_at IS NOT NULL, created_at, updated_at
        FROM "{schema}".agent_tokens ORDER BY id"""
    )
    rows = {row[0]: row[1:] for row in cursor.fetchall()}
    assert all(scopes == ["quick_tasks:write"] for scopes, *_ in rows.values())
    assert rows[REVOKED_ID][1] is True
    assert rows[ACTIVE_ID][1] is False
    assert rows[NULL_TIMES_ID][2] is not None
    assert rows[NULL_TIMES_ID][3] is not None

    cursor.execute(
        f"""SELECT a.created_at = h.created_at, a.updated_at = h.updated_at
        FROM "{schema}".agent_tokens a JOIN "{schema}".hook_tokens h USING (id)
        WHERE a.id = %s""",
        (ACTIVE_ID,),
    )
    assert cursor.fetchone() == (True, True)


def test_035_backfills_logs_updated_at_and_keeps_old_inserts_working(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        f'SELECT updated_at = created_at FROM "{schema}".logs WHERE id = %s',
        (LOG_WITH_CREATED_ID,),
    )
    assert cursor.fetchone()[0] is True
    cursor.execute(
        f'SELECT updated_at IS NOT NULL FROM "{schema}".logs WHERE id = %s',
        (LOG_WITHOUT_CREATED_ID,),
    )
    assert cursor.fetchone()[0] is True

    # The deployed code does not know the column yet.
    cursor.execute(
        f"""INSERT INTO "{schema}".logs (task_id, actual_minutes, comment)
        VALUES (%s, 45, 'old code') RETURNING updated_at""",
        (TASK_ID,),
    )
    assert cursor.fetchone()[0] is not None

    cursor.execute(
        """SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = %s AND table_name = 'logs' AND column_name = 'updated_at'""",
        (schema,),
    )
    is_nullable, column_default = cursor.fetchone()
    assert is_nullable == "NO"
    assert "now()" in column_default


def test_035_triggers_advance_updated_at(db):
    cursor, schema = db
    s = f'"{schema}"'
    run_migration(cursor, schema, MIGRATION)

    cursor.execute(f"INSERT INTO {s}.quick_tasks (title) VALUES ('q')")
    cursor.execute(f"INSERT INTO {s}.context_notes (content) VALUES ('n')")
    cursor.execute(f"INSERT INTO {s}.daily_plan_documents (revision) VALUES (1)")
    updates = {
        "logs": "actual_minutes = actual_minutes + 1",
        "quick_tasks": "title = 'changed'",
        "context_notes": "content = 'changed'",
        "daily_plan_documents": "revision = revision + 1",
    }
    for table, change in updates.items():
        # Disable the trigger while planting the old timestamp, then fire it.
        cursor.execute(f"ALTER TABLE {s}.{table} DISABLE TRIGGER USER")
        cursor.execute(f"UPDATE {s}.{table} SET updated_at = '2000-01-01T00:00:00Z'")
        cursor.execute(f"ALTER TABLE {s}.{table} ENABLE TRIGGER USER")
        cursor.execute(f"UPDATE {s}.{table} SET {change}")
        cursor.execute(
            f"SELECT bool_and(updated_at > '2000-01-01T00:00:00Z') FROM {s}.{table}"
        )
        assert cursor.fetchone()[0] is True, table


def test_035_hides_token_hash_from_authenticated(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    table = f'"{schema}".agent_tokens'

    cursor.execute(
        "SELECT has_column_privilege('authenticated', %s, 'token_hash', 'SELECT')",
        (table,),
    )
    assert cursor.fetchone()[0] is False
    cursor.execute(
        "SELECT has_column_privilege('authenticated', %s, 'name', 'SELECT')",
        (table,),
    )
    assert cursor.fetchone()[0] is True
    cursor.execute("SELECT has_table_privilege('anon', %s, 'SELECT')", (table,))
    assert cursor.fetchone()[0] is False

    cursor.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    )
    assert cursor.fetchone()[0] is True
    cursor.execute(
        """SELECT policyname FROM pg_policies
        WHERE schemaname = %s AND tablename = 'agent_tokens'""",
        (schema,),
    )
    assert cursor.fetchall() == [("agent_tokens_own_metadata",)]


def test_035_can_be_applied_twice(db):
    # A manual application is not recorded in schema_migrations, so the
    # migration manager runs 035 again when the new API starts.
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    cursor.execute(f'SELECT count(*) FROM "{schema}".agent_tokens')
    count = cursor.fetchone()[0]

    run_migration(cursor, schema, MIGRATION)
    cursor.execute(f'SELECT count(*) FROM "{schema}".agent_tokens')
    assert cursor.fetchone()[0] == count == 3


def test_035_rollback_writes_back_revocations(db):
    cursor, schema = db
    s = f'"{schema}"'
    run_migration(cursor, schema, MIGRATION)
    cursor.execute(
        f"SELECT revoked_at FROM {s}.hook_tokens WHERE id = %s", (REVOKED_ID,)
    )
    originally_revoked_at = cursor.fetchone()[0]

    # Revoked after the migration, through the new API.
    cursor.execute(
        f"UPDATE {s}.agent_tokens SET revoked_at = NOW() WHERE id = %s", (ACTIVE_ID,)
    )
    run_migration(cursor, schema, ROLLBACK)

    cursor.execute(
        f"SELECT id::text, revoked_at FROM {s}.hook_tokens ORDER BY id",
    )
    revoked = dict(cursor.fetchall())
    # The old code rejects the token again.
    assert revoked[ACTIVE_ID] is not None
    assert revoked[REVOKED_ID] == originally_revoked_at
    assert revoked[NULL_TIMES_ID] is None

    cursor.execute("SELECT to_regclass(%s)", (f"{s}.agent_tokens",))
    assert cursor.fetchone()[0] is None
    cursor.execute(
        """SELECT count(*) FROM information_schema.columns
        WHERE table_schema = %s AND table_name = 'logs' AND column_name = 'updated_at'""",
        (schema,),
    )
    assert cursor.fetchone()[0] == 1

    cursor.execute(
        """SELECT count(*) FROM pg_indexes
        WHERE schemaname = %s AND indexname LIKE 'idx_%%_updated_at_id'""",
        (schema,),
    )
    assert cursor.fetchone()[0] == 0
    cursor.execute(
        """SELECT count(*) FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %s AND NOT t.tgisinternal""",
        (schema,),
    )
    assert cursor.fetchone()[0] == 0
    cursor.execute(
        "SELECT obj_description(%s::regclass, 'pg_class')", (f"{s}.hook_tokens",)
    )
    assert (
        cursor.fetchone()[0] == "User-scoped hashed tokens for external hook ingestion"
    )
