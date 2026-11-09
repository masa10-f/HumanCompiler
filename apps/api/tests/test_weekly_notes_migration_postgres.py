# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migration 043 and its rollback against an isolated PostgreSQL schema."""

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

MIGRATION = "043_add_weekly_notes.sql"
ROLLBACK = "043_add_weekly_notes_rollback.sql"
USER_ID = str(uuid4())
SUNDAY = "2026-11-01"


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"weekly_notes_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            cursor.execute(f'CREATE TABLE "{schema}".users (id UUID PRIMARY KEY)')
            cursor.execute(
                f'CREATE TABLE "{schema}".user_settings (id UUID PRIMARY KEY, '
                f'user_id UUID UNIQUE REFERENCES "{schema}".users(id))'
            )
            cursor.execute(f'INSERT INTO "{schema}".users (id) VALUES (%s)', (USER_ID,))
            run_migration(cursor, schema, MIGRATION)
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def insert_note(cursor, schema: str, **overrides) -> str:
    values = {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "week_start": SUNDAY,
        "content": "<p>Week</p>",
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    cursor.execute(
        f'INSERT INTO "{schema}".weekly_notes ({columns}) VALUES ({placeholders})',
        list(values.values()),
    )
    return values["id"]


def test_migration_is_repeatable(db):
    cursor, schema = db
    insert_note(cursor, schema)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(f'SELECT count(*) FROM "{schema}".weekly_notes')
    assert cursor.fetchone() == (1,)


def test_defaults(db):
    cursor, schema = db
    cursor.execute(
        f'INSERT INTO "{schema}".weekly_notes (user_id, week_start) '
        "VALUES (%s, %s) RETURNING id",
        (USER_ID, SUNDAY),
    )
    (note_id,) = cursor.fetchone()

    cursor.execute(
        "SELECT content, content_type, created_at IS NOT NULL, "
        f'updated_at IS NOT NULL FROM "{schema}".weekly_notes WHERE id = %s',
        (note_id,),
    )
    assert cursor.fetchone() == ("", "html", True, True)


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"content_type": "tiptap_json"}, errors.CheckViolation),
        ({"content": None}, errors.NotNullViolation),
    ],
)
def test_constraints_reject_invalid_rows(db, overrides, error):
    cursor, schema = db
    cursor.execute("SAVEPOINT before_insert")

    with pytest.raises(error):
        insert_note(cursor, schema, **overrides)

    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_one_note_per_user_and_week(db):
    cursor, schema = db
    insert_note(cursor, schema)
    cursor.execute("SAVEPOINT before_insert")

    with pytest.raises(errors.UniqueViolation):
        insert_note(cursor, schema)

    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")
    insert_note(cursor, schema, week_start="2026-11-08")


def test_deleting_a_user_deletes_their_notes(db):
    cursor, schema = db
    insert_note(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".users WHERE id = %s', (USER_ID,))

    cursor.execute(f'SELECT count(*) FROM "{schema}".weekly_notes')
    assert cursor.fetchone() == (0,)


def test_owner_policy_is_created(db):
    cursor, schema = db

    cursor.execute(
        "SELECT policyname FROM pg_policies WHERE schemaname = %s AND tablename = %s",
        (schema, "weekly_notes"),
    )
    assert cursor.fetchall() == [("weekly_notes_own_rows",)]


def test_rollback_drops_the_table(db):
    cursor, schema = db
    insert_note(cursor, schema)

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".weekly_notes',))
    assert cursor.fetchone() == (None,)


def test_week_start_day_defaults_to_sunday_and_is_checked(db):
    cursor, schema = db
    cursor.execute(
        f'INSERT INTO "{schema}".user_settings (id, user_id) VALUES (%s, %s) '
        "RETURNING week_start_day",
        (str(uuid4()), USER_ID),
    )
    assert cursor.fetchone() == ("sunday",)
    for day in (
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ):
        cursor.execute(
            f'UPDATE "{schema}".user_settings SET week_start_day = %s', (day,)
        )
    cursor.execute("SAVEPOINT before_update")

    with pytest.raises(errors.CheckViolation):
        cursor.execute(
            f'UPDATE "{schema}".user_settings SET week_start_day = %s', ("funday",)
        )

    cursor.execute("ROLLBACK TO SAVEPOINT before_update")


def test_notes_may_start_on_any_weekday(db):
    cursor, schema = db

    insert_note(cursor, schema, week_start="2026-11-02")


def test_rollback_drops_the_week_start_column(db):
    cursor, schema = db

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = 'user_settings' "
        "AND column_name = 'week_start_day'",
        (schema,),
    )
    assert cursor.fetchone() == (0,)
