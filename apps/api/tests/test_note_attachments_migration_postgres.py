# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migration 046 and its rollback against an isolated PostgreSQL schema."""

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

MIGRATION = "046_add_note_attachments.sql"
ROLLBACK = "046_add_note_attachments_rollback.sql"
USER_ID = str(uuid4())
NOTE_ID = str(uuid4())


@pytest.fixture
def schema_only() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"note_attachments_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            create_supabase_objects(cursor)
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            # Supabase grants new tables to these roles by default. Mirror that
            # so the privilege assertions actually exercise 046's REVOKE.
            cursor.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
                "GRANT ALL ON TABLES TO anon, authenticated"
            )
            cursor.execute(f'CREATE TABLE "{schema}".users (id UUID PRIMARY KEY)')
            cursor.execute(
                f'CREATE TABLE "{schema}".context_notes (id UUID PRIMARY KEY, '
                f'user_id UUID REFERENCES "{schema}".users(id) ON DELETE CASCADE)'
            )
            cursor.execute(f'INSERT INTO "{schema}".users (id) VALUES (%s)', (USER_ID,))
            cursor.execute(
                f'INSERT INTO "{schema}".context_notes (id, user_id) VALUES (%s, %s)',
                (NOTE_ID, USER_ID),
            )
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture
def db(schema_only: tuple) -> tuple:
    cursor, schema = schema_only
    run_migration(cursor, schema, MIGRATION)
    return cursor, schema


def insert_attachment(cursor, schema: str, **overrides) -> str:
    attachment_id = str(uuid4())
    values = {
        "id": attachment_id,
        "user_id": USER_ID,
        "note_id": NOTE_ID,
        "bucket": "note-attachments",
        "object_key": f"{USER_ID}/{attachment_id}/preview.webp",
        "thumb_object_key": f"{USER_ID}/{attachment_id}/thumb.webp",
        "byte_size": 64000,
        "thumb_byte_size": 13000,
        "width": 1260,
        "height": 800,
        "sha256": "a" * 64,
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    cursor.execute(
        f'INSERT INTO "{schema}".note_attachments ({columns}) VALUES ({placeholders})',
        list(values.values()),
    )
    return values["id"]


def test_migration_is_repeatable(db):
    cursor, schema = db
    insert_attachment(cursor, schema)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(f'SELECT count(*) FROM "{schema}".note_attachments')
    assert cursor.fetchone() == (1,)


def test_defaults(db):
    cursor, schema = db
    attachment_id = insert_attachment(cursor, schema)

    cursor.execute(
        "SELECT caption, source, detached_at, created_at IS NOT NULL "
        f'FROM "{schema}".note_attachments WHERE id = %s',
        (attachment_id,),
    )
    assert cursor.fetchone() == ("", None, None, True)


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"byte_size": 0}, errors.CheckViolation),
        ({"width": 0}, errors.CheckViolation),
        ({"user_id": None}, errors.NotNullViolation),
        ({"object_key": None}, errors.NotNullViolation),
        ({"user_id": str(uuid4())}, errors.ForeignKeyViolation),
        ({"note_id": str(uuid4())}, errors.ForeignKeyViolation),
    ],
)
def test_constraints_reject_invalid_rows(db, overrides, error):
    cursor, schema = db
    cursor.execute("SAVEPOINT before_insert")

    with pytest.raises(error):
        insert_attachment(cursor, schema, **overrides)

    cursor.execute("ROLLBACK TO SAVEPOINT before_insert")


def test_deleting_the_note_keeps_the_row_for_cleanup(db):
    cursor, schema = db
    attachment_id = insert_attachment(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".context_notes WHERE id = %s', (NOTE_ID,))

    cursor.execute(
        f'SELECT note_id, object_key FROM "{schema}".note_attachments WHERE id = %s',
        (attachment_id,),
    )
    assert cursor.fetchone() == (None, f"{USER_ID}/{attachment_id}/preview.webp")


def test_deleting_the_user_deletes_the_rows(db):
    cursor, schema = db
    insert_attachment(cursor, schema)

    cursor.execute(f'DELETE FROM "{schema}".users WHERE id = %s', (USER_ID,))

    cursor.execute(f'SELECT count(*) FROM "{schema}".note_attachments')
    assert cursor.fetchone() == (0,)


def test_owner_can_read_and_nobody_can_write_through_the_user_roles(db):
    cursor, schema = db
    table = f'"{schema}".note_attachments'

    cursor.execute(
        "SELECT has_table_privilege('authenticated', %s, 'SELECT')", (table,)
    )
    assert cursor.fetchone()[0] is True
    for privilege in ("INSERT", "UPDATE", "DELETE"):
        cursor.execute(
            "SELECT has_table_privilege('authenticated', %s, %s)", (table, privilege)
        )
        assert cursor.fetchone()[0] is False, privilege
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        cursor.execute("SELECT has_table_privilege('anon', %s, %s)", (table, privilege))
        assert cursor.fetchone()[0] is False, privilege

    cursor.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    )
    assert cursor.fetchone()[0] is True
    cursor.execute(
        "SELECT policyname, cmd FROM pg_policies "
        "WHERE schemaname = %s AND tablename = 'note_attachments'",
        (schema,),
    )
    assert cursor.fetchall() == [("note_attachments_own_rows", "SELECT")]


def test_table_of_the_disabled_migration_016_is_not_overwritten(schema_only):
    cursor, schema = schema_only
    cursor.execute(
        f'CREATE TABLE "{schema}".note_attachments (id UUID PRIMARY KEY, '
        "note_id UUID, filename VARCHAR(255), storage_path VARCHAR(500))"
    )
    cursor.execute("SAVEPOINT before_migration")

    with pytest.raises(errors.RaiseException, match="disabled migration 016"):
        run_migration(cursor, schema, MIGRATION)

    cursor.execute("ROLLBACK TO SAVEPOINT before_migration")
    cursor.execute(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = 'note_attachments'",
        (schema,),
    )
    assert cursor.fetchone() == (4,)


def test_rollback_drops_the_table_and_keeps_notes(db):
    cursor, schema = db
    insert_attachment(cursor, schema)

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute("SELECT to_regclass(%s)", (f'"{schema}".note_attachments',))
    assert cursor.fetchone() == (None,)
    cursor.execute(f'SELECT count(*) FROM "{schema}".context_notes')
    assert cursor.fetchone() == (1,)
