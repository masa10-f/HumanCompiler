# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 038 (drop hook_tokens) against an isolated PostgreSQL schema."""

from collections.abc import Iterator
import os
from uuid import uuid4

import psycopg2
import psycopg2.errors
import pytest

from tests.postgres_migration_helpers import create_supabase_objects, run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "038_drop_hook_tokens.sql"

USER_ID = "00000000-0000-0000-0000-000000000001"
TOKEN_ID = "00000000-0000-0000-0000-0000000000a1"
TOKEN_HASH = "a" * 64
TOKEN_PREFIX = "hc_hook_" + "p" * 8


def create_minimal_tables(cursor, schema: str) -> None:
    """Create hook_tokens (via 024) and a minimal agent_tokens with one copied row."""
    s = f'"{schema}"'
    cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
    run_migration(cursor, schema, "024_add_hook_tokens.sql")
    cursor.execute(
        f"""CREATE TABLE {s}.agent_tokens (
            id UUID PRIMARY KEY,
            user_id UUID,
            token_prefix VARCHAR(32))"""
    )
    cursor.execute(f"INSERT INTO {s}.users (id) VALUES (%s)", (USER_ID,))
    cursor.execute(
        f"""INSERT INTO {s}.hook_tokens (id, user_id, name, token_hash, token_prefix)
        VALUES (%s, %s, 'hook', %s, %s)""",
        (TOKEN_ID, USER_ID, TOKEN_HASH, TOKEN_PREFIX),
    )
    cursor.execute(
        f"INSERT INTO {s}.agent_tokens (id, user_id, token_prefix) VALUES (%s, %s, %s)",
        (TOKEN_ID, USER_ID, TOKEN_PREFIX),
    )


def table_exists(cursor, schema: str, table: str) -> bool:
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", (f"{schema}.{table}",))
    return bool(cursor.fetchone()[0])


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"drop_hook_tokens_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            create_minimal_tables(cursor, schema)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def test_038_drops_hook_tokens(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    assert table_exists(cursor, schema, "hook_tokens") is False


def test_038_can_be_applied_twice(db):
    # A manual application is not recorded in schema_migrations, so the
    # `migrate.py apply` runs 038 again.
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    run_migration(cursor, schema, MIGRATION)
    assert table_exists(cursor, schema, "hook_tokens") is False


def test_038_keeps_agent_tokens(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    cursor.execute(f'SELECT id::text, token_prefix FROM "{schema}".agent_tokens')
    assert cursor.fetchall() == [(TOKEN_ID, TOKEN_PREFIX)]


def test_038_refuses_without_agent_tokens(db):
    cursor, schema = db
    cursor.execute(f'DROP TABLE "{schema}".agent_tokens')
    cursor.execute("SAVEPOINT before_038")
    with pytest.raises(psycopg2.errors.RaiseException, match="035"):
        run_migration(cursor, schema, MIGRATION)
    cursor.execute("ROLLBACK TO SAVEPOINT before_038")
    assert table_exists(cursor, schema, "hook_tokens") is True


def test_038_does_not_drop_dependent_objects(db):
    cursor, schema = db
    cursor.execute(
        f'CREATE VIEW "{schema}".hook_token_names AS SELECT name FROM "{schema}".hook_tokens'
    )
    cursor.execute("SAVEPOINT before_038")
    with pytest.raises(psycopg2.errors.DependentObjectsStillExist):
        run_migration(cursor, schema, MIGRATION)
    cursor.execute("ROLLBACK TO SAVEPOINT before_038")
    assert table_exists(cursor, schema, "hook_tokens") is True
