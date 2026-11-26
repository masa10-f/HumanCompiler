# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migration 045 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
import os
from uuid import uuid4

import psycopg2
from psycopg2 import errors
import pytest

from tests.postgres_migration_helpers import run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "045_link_logs_to_work_sessions.sql"
ROLLBACK = "045_link_logs_to_work_sessions_rollback.sql"
END = datetime(2026, 11, 20, 2, 0, tzinfo=UTC)


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"log_session_link_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            s = f'"{schema}"'
            cursor.execute(f"CREATE TABLE {s}.tasks (id UUID PRIMARY KEY)")
            cursor.execute(
                f"""CREATE TABLE {s}.work_sessions (
                    id UUID PRIMARY KEY,
                    task_id UUID NOT NULL REFERENCES {s}.tasks(id) ON DELETE CASCADE,
                    ended_at TIMESTAMPTZ)"""
            )
            cursor.execute(
                f"""CREATE TABLE {s}.logs (
                    id UUID PRIMARY KEY,
                    task_id UUID NOT NULL REFERENCES {s}.tasks(id) ON DELETE CASCADE,
                    actual_minutes INTEGER NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW())"""
            )
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def add_task(cursor, schema: str) -> str:
    task_id = str(uuid4())
    cursor.execute(f'INSERT INTO "{schema}".tasks (id) VALUES (%s)', (task_id,))
    return task_id


def add_session(cursor, schema: str, task_id: str, ended_at: datetime | None) -> str:
    session_id = str(uuid4())
    cursor.execute(
        f'INSERT INTO "{schema}".work_sessions (id, task_id, ended_at) '
        "VALUES (%s, %s, %s)",
        (session_id, task_id, ended_at),
    )
    return session_id


def add_log(cursor, schema: str, task_id: str, created_at: datetime) -> str:
    log_id = str(uuid4())
    cursor.execute(
        f'INSERT INTO "{schema}".logs (id, task_id, actual_minutes, comment, created_at) '
        "VALUES (%s, %s, 30, 'kept', %s)",
        (log_id, task_id, created_at),
    )
    return log_id


def links(cursor, schema: str) -> dict[str, str | None]:
    cursor.execute(f'SELECT id::text, work_session_id::text FROM "{schema}".logs')
    return dict(cursor.fetchall())


def test_checkout_log_is_linked_to_its_session(db):
    cursor, schema = db
    task = add_task(cursor, schema)
    session = add_session(cursor, schema, task, END)
    checkout_log = add_log(cursor, schema, task, END + timedelta(milliseconds=40))
    manual_log = add_log(cursor, schema, task, END + timedelta(hours=3))

    run_migration(cursor, schema, MIGRATION)

    assert links(cursor, schema) == {checkout_log: session, manual_log: None}
    cursor.execute(f'SELECT actual_minutes, comment FROM "{schema}".logs')
    assert set(cursor.fetchall()) == {(30, "kept")}


def test_only_the_same_task_and_a_close_time_make_a_pair(db):
    cursor, schema = db
    task, other_task = add_task(cursor, schema), add_task(cursor, schema)
    add_session(cursor, schema, task, END)
    add_session(cursor, schema, task, None)  # still running
    other_tasks_log = add_log(cursor, schema, other_task, END)
    late_log = add_log(cursor, schema, task, END + timedelta(seconds=11))
    early_log = add_log(cursor, schema, task, END - timedelta(seconds=11))

    run_migration(cursor, schema, MIGRATION)

    assert links(cursor, schema) == {
        other_tasks_log: None,
        late_log: None,
        early_log: None,
    }


def test_each_session_and_each_log_is_linked_once(db):
    cursor, schema = db
    task = add_task(cursor, schema)
    # Two sessions of one task end 4 seconds apart; each has its own log.
    first = add_session(cursor, schema, task, END)
    second = add_session(cursor, schema, task, END + timedelta(seconds=4))
    first_log = add_log(cursor, schema, task, END + timedelta(milliseconds=10))
    second_log = add_log(
        cursor, schema, task, END + timedelta(seconds=4, milliseconds=10)
    )
    # A third log near both has no session left to take.
    spare_log = add_log(cursor, schema, task, END + timedelta(seconds=2))

    run_migration(cursor, schema, MIGRATION)

    assert links(cursor, schema) == {
        first_log: first,
        second_log: second,
        spare_log: None,
    }


def test_migration_is_repeatable_and_keeps_existing_links(db):
    cursor, schema = db
    task = add_task(cursor, schema)
    session = add_session(cursor, schema, task, END)
    log = add_log(cursor, schema, task, END)
    run_migration(cursor, schema, MIGRATION)
    # A log written later, close to the same session, must not steal the link.
    later = add_log(cursor, schema, task, END + timedelta(seconds=1))
    new_session = add_session(cursor, schema, task, END + timedelta(minutes=30))
    new_log = add_log(cursor, schema, task, END + timedelta(minutes=30))

    run_migration(cursor, schema, MIGRATION)

    assert links(cursor, schema) == {log: session, later: None, new_log: new_session}


def test_a_session_has_one_log_and_deleting_it_keeps_the_time(db):
    cursor, schema = db
    task = add_task(cursor, schema)
    session = add_session(cursor, schema, task, END)
    log = add_log(cursor, schema, task, END)
    other = add_log(cursor, schema, task, END + timedelta(hours=1))
    run_migration(cursor, schema, MIGRATION)

    cursor.execute("SAVEPOINT before_duplicate")
    with pytest.raises(errors.UniqueViolation):
        cursor.execute(
            f'UPDATE "{schema}".logs SET work_session_id = %s WHERE id = %s',
            (session, other),
        )
    cursor.execute("ROLLBACK TO SAVEPOINT before_duplicate")

    cursor.execute(f'DELETE FROM "{schema}".work_sessions WHERE id = %s', (session,))

    assert links(cursor, schema) == {log: None, other: None}


def test_rollback_drops_the_link_and_keeps_the_rows(db):
    cursor, schema = db
    task = add_task(cursor, schema)
    add_session(cursor, schema, task, END)
    add_log(cursor, schema, task, END)
    run_migration(cursor, schema, MIGRATION)

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute(f'SELECT count(*) FROM "{schema}".logs')
    assert cursor.fetchone() == (1,)
    cursor.execute(f'SELECT count(*) FROM "{schema}".work_sessions')
    assert cursor.fetchone() == (1,)
    cursor.execute(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = %s AND column_name = 'work_session_id'",
        (schema,),
    )
    assert cursor.fetchone() == (0,)
    run_migration(cursor, schema, ROLLBACK)
    # The migration can be applied again after a rollback.
    run_migration(cursor, schema, MIGRATION)
    assert len([v for v in links(cursor, schema).values() if v]) == 1
