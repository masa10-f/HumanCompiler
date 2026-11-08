# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migration 042 and its rollback against an isolated PostgreSQL schema."""

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

MIGRATION = "042_add_weekly_rhythm.sql"
ROLLBACK = "042_add_weekly_rhythm_rollback.sql"
USER_ID = str(uuid4())
PROJECT_ID = str(uuid4())


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"weekly_rhythm_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            s = f'"{schema}"'
            cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
            cursor.execute(
                f"""CREATE TABLE {s}.projects (
                    id UUID PRIMARY KEY,
                    owner_id UUID REFERENCES {s}.users(id) ON DELETE CASCADE)"""
            )
            cursor.execute(f"INSERT INTO {s}.users (id) VALUES (%s)", (USER_ID,))
            cursor.execute(
                f"INSERT INTO {s}.projects (id, owner_id) VALUES (%s, %s)",
                (PROJECT_ID, USER_ID),
            )
            run_migration(cursor, schema, MIGRATION)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def insert_block(cursor, schema: str, **overrides) -> str:
    values = {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "weekday": 0,
        "start_time": "09:00",
        "end_time": "12:00",
        "kind": "schedule",
        "title": None,
        "project_id": PROJECT_ID,
        "work_type": "focused_work",
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    cursor.execute(
        f'INSERT INTO "{schema}".weekly_rhythm_blocks ({columns}) '
        f"VALUES ({placeholders})",
        list(values.values()),
    )
    return values["id"]


def test_migration_is_repeatable(db):
    cursor, schema = db
    insert_block(cursor, schema)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(f'SELECT count(*) FROM "{schema}".weekly_rhythm_blocks')
    assert cursor.fetchone() == (1,)


@pytest.mark.parametrize(
    "overrides",
    [
        {"weekday": 7},
        {"start_time": "12:00", "end_time": "09:00"},
        {"kind": "meeting"},
        {"work_type": "deep_work"},
        {"kind": "event", "title": "会議"},
        {"kind": "break", "project_id": None},
    ],
)
def test_constraints_reject_invalid_rows(db, overrides):
    cursor, schema = db
    cursor.execute("SAVEPOINT before_insert")

    with pytest.raises(errors.CheckViolation):
        insert_block(cursor, schema, **overrides)

    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_fixed_event_without_project_is_allowed(db):
    cursor, schema = db

    insert_block(cursor, schema, kind="event", title="会議", project_id=None)


def test_deleting_a_project_keeps_its_blocks(db):
    cursor, schema = db
    block_id = insert_block(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".projects WHERE id = %s', (PROJECT_ID,))

    cursor.execute(
        f'SELECT project_id FROM "{schema}".weekly_rhythm_blocks WHERE id = %s',
        (block_id,),
    )
    assert cursor.fetchone() == (None,)


def test_deleting_a_user_deletes_the_template(db):
    cursor, schema = db
    insert_block(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".users WHERE id = %s', (USER_ID,))

    cursor.execute(f'SELECT count(*) FROM "{schema}".weekly_rhythm_blocks')
    assert cursor.fetchone() == (0,)


def test_owner_policy_is_created(db):
    cursor, schema = db

    cursor.execute(
        "SELECT policyname FROM pg_policies WHERE schemaname = %s AND tablename = %s",
        (schema, "weekly_rhythm_blocks"),
    )
    assert cursor.fetchall() == [("weekly_rhythm_blocks_own_rows",)]


def test_rollback_drops_the_table(db):
    cursor, schema = db
    insert_block(cursor, schema)

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".weekly_rhythm_blocks',))
    assert cursor.fetchone() == (None,)
