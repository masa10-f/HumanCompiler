# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Run migration 041 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
import os
from uuid import uuid4

import psycopg2
from psycopg2 import errors
import pytest

from tests.postgres_migration_helpers import create_supabase_objects, run_migration
from tests.test_agent_writes_migration_postgres import (
    MIGRATION as WRITES_MIGRATION,
    PROPOSALS_MIGRATION,
    create_minimal_tables,
    insert_change,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "041_add_agent_log_changes.sql"
ROLLBACK = "041_add_agent_log_changes_rollback.sql"
OLD_ENTITY_TYPES = ["goal", "task", "context_note", "task_dependency"]


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"agent_log_changes_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            create_minimal_tables(cursor, schema)
            run_migration(cursor, schema, PROPOSALS_MIGRATION)
            run_migration(cursor, schema, WRITES_MIGRATION)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def _rejects_entity_type(cursor, schema: str, entity_type: str) -> None:
    cursor.execute("SAVEPOINT before_insert")
    with pytest.raises(errors.CheckViolation) as excinfo:
        insert_change(cursor, schema, entity_type=entity_type)
    assert excinfo.value.diag.constraint_name == "ck_agent_changes_entity_type"
    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_040_alone_rejects_log(db):
    cursor, schema = db

    _rejects_entity_type(cursor, schema, "log")


def test_041_accepts_log_and_applies_twice(db):
    cursor, schema = db
    existing = insert_change(cursor, schema, entity_type="task_dependency")

    run_migration(cursor, schema, MIGRATION)
    run_migration(cursor, schema, MIGRATION)

    for entity_type in [*OLD_ENTITY_TYPES, "log"]:
        insert_change(cursor, schema, entity_type=entity_type)
    _rejects_entity_type(cursor, schema, "project")
    cursor.execute(
        f'SELECT count(*) FROM "{schema}".agent_changes WHERE id = %s', (existing,)
    )
    assert cursor.fetchone() == (1,)


def test_041_rollback_deletes_log_rows_and_restores_040(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    kept = insert_change(cursor, schema, entity_type="task")
    insert_change(cursor, schema, entity_type="log")

    run_migration(cursor, schema, ROLLBACK)
    run_migration(cursor, schema, ROLLBACK)

    cursor.execute(f'SELECT id::text FROM "{schema}".agent_changes')
    assert cursor.fetchall() == [(kept,)]
    _rejects_entity_type(cursor, schema, "log")
    for entity_type in OLD_ENTITY_TYPES:
        insert_change(cursor, schema, entity_type=entity_type)


def test_041_requires_agent_changes():
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    schema = f"agent_log_changes_test_{uuid4().hex}"
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            with pytest.raises(errors.RaiseException) as excinfo:
                run_migration(cursor, schema, MIGRATION)
            assert "040_add_agent_writes.sql" in str(excinfo.value)
    finally:
        connection.rollback()
        connection.close()
