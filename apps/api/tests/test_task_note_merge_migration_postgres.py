# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migration 044 and its rollback against an isolated PostgreSQL schema."""

from collections.abc import Iterator
from datetime import UTC, datetime
import os
from uuid import uuid4

import psycopg2
import pytest

from humancompiler_api.note_text import (
    MEMO_HEADING_HTML,
    former_task_text_html,
    note_plain_text,
)
from tests.postgres_migration_helpers import run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

MIGRATION = "044_merge_task_text_into_notes.sql"
ROLLBACK = "044_merge_task_text_into_notes_rollback.sql"
USER_ID = str(uuid4())
PROJECT_ID = str(uuid4())
GOAL_ID = str(uuid4())
OLD = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
MEMO_HEADING = MEMO_HEADING_HTML


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"task_note_merge_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            s = f'"{schema}"'
            cursor.execute(f"CREATE TABLE {s}.users (id UUID PRIMARY KEY)")
            cursor.execute(
                f"""CREATE TABLE {s}.projects (
                    id UUID PRIMARY KEY,
                    owner_id UUID NOT NULL REFERENCES {s}.users(id))"""
            )
            cursor.execute(
                f"""CREATE TABLE {s}.goals (
                    id UUID PRIMARY KEY,
                    project_id UUID NOT NULL REFERENCES {s}.projects(id))"""
            )
            cursor.execute(
                f"""CREATE TABLE {s}.tasks (
                    id UUID PRIMARY KEY,
                    goal_id UUID NOT NULL REFERENCES {s}.goals(id),
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    memo TEXT)"""
            )
            # The table as 017 creates it, with the updated_at trigger of 035.
            cursor.execute(
                f"""CREATE TABLE {s}.context_notes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES {s}.users(id),
                    project_id UUID REFERENCES {s}.projects(id),
                    goal_id UUID REFERENCES {s}.goals(id),
                    task_id UUID REFERENCES {s}.tasks(id),
                    content TEXT NOT NULL DEFAULT '',
                    content_type VARCHAR(20) NOT NULL DEFAULT 'markdown',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    CONSTRAINT unique_task_note UNIQUE (task_id))"""
            )
            cursor.execute(
                f"""CREATE FUNCTION {s}.update_updated_at_column() RETURNS trigger
                    LANGUAGE plpgsql AS
                    'BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END'"""
            )
            cursor.execute(
                f"""CREATE TRIGGER update_context_notes_updated_at
                    BEFORE UPDATE ON {s}.context_notes
                    FOR EACH ROW EXECUTE FUNCTION {s}.update_updated_at_column()"""
            )
            cursor.execute(f"INSERT INTO {s}.users (id) VALUES (%s)", (USER_ID,))
            cursor.execute(
                f"INSERT INTO {s}.projects (id, owner_id) VALUES (%s, %s)",
                (PROJECT_ID, USER_ID),
            )
            cursor.execute(
                f"INSERT INTO {s}.goals (id, project_id) VALUES (%s, %s)",
                (GOAL_ID, PROJECT_ID),
            )
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def add_task(
    cursor, schema: str, description: str | None = None, memo: str | None = None
) -> str:
    task_id = str(uuid4())
    cursor.execute(
        f'INSERT INTO "{schema}".tasks (id, goal_id, title, description, memo) '
        "VALUES (%s, %s, 'T', %s, %s)",
        (task_id, GOAL_ID, description, memo),
    )
    return task_id


def add_note(
    cursor,
    schema: str,
    content: str,
    content_type: str = "html",
    *,
    task_id: str | None = None,
) -> str:
    note_id = str(uuid4())
    target = {"task_id": task_id} if task_id else {"project_id": PROJECT_ID}
    column, value = next(iter(target.items()))
    cursor.execute(
        f'INSERT INTO "{schema}".context_notes '
        f"(id, user_id, {column}, content, content_type, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (note_id, USER_ID, value, content, content_type, OLD),
    )
    return note_id


def task_note(cursor, schema: str, task_id: str) -> tuple | None:
    cursor.execute(
        f"SELECT user_id::text, content, content_type, content_text "
        f'FROM "{schema}".context_notes WHERE task_id = %s',
        (task_id,),
    )
    return cursor.fetchone()


def test_description_and_memo_become_the_note(db):
    cursor, schema = db
    description = "  Why <now>\r\n\r\n second & third  \n"
    memo = "first memo\nsecond memo"
    task_id = add_task(cursor, schema, description, memo)

    run_migration(cursor, schema, MIGRATION)

    # Restoring an old backup writes the same HTML as the migration.
    content = former_task_text_html(description, memo)
    assert content == (
        "<p>Why &lt;now&gt;</p><p>second &amp; third</p>"
        "<p><strong>メモ</strong></p><p>first memo</p><p>second memo</p>"
    )
    assert task_note(cursor, schema, task_id) == (
        USER_ID,
        content,
        "html",
        "Why <now>\nsecond & third\nメモ\nfirst memo\nsecond memo",
    )
    cursor.execute(
        f'SELECT description, memo, note_merged_at IS NOT NULL FROM "{schema}".tasks'
    )
    assert cursor.fetchone() == (description, memo, True)


def test_text_goes_above_an_existing_note(db):
    cursor, schema = db
    with_description = add_task(cursor, schema, description="Why")
    add_note(cursor, schema, "<h2>Plan</h2><p>Ship</p>", task_id=with_description)
    with_memo = add_task(cursor, schema, memo="Remember")
    add_note(cursor, schema, "", "markdown", task_id=with_memo)

    run_migration(cursor, schema, MIGRATION)

    assert task_note(cursor, schema, with_description) == (
        USER_ID,
        "<p>Why</p><h2>Plan</h2><p>Ship</p>",
        "html",
        "Why\nPlan\nShip",
    )
    assert task_note(cursor, schema, with_memo) == (
        USER_ID,
        MEMO_HEADING + "<p>Remember</p>",
        "html",
        "メモ\nRemember",
    )


@pytest.mark.parametrize(
    ("description", "memo"), [(None, None), ("", ""), (" \n\t ", None)]
)
def test_task_without_text_gets_no_note(db, description, memo):
    cursor, schema = db
    task_id = add_task(cursor, schema, description, memo)

    run_migration(cursor, schema, MIGRATION)

    assert task_note(cursor, schema, task_id) is None
    cursor.execute(f'SELECT note_merged_at FROM "{schema}".tasks')
    assert cursor.fetchone() == (None,)


def test_migration_is_repeatable(db):
    cursor, schema = db
    task_id = add_task(cursor, schema, "Why", "Remember")
    run_migration(cursor, schema, MIGRATION)
    first = task_note(cursor, schema, task_id)

    run_migration(cursor, schema, MIGRATION)

    assert task_note(cursor, schema, task_id) == first
    cursor.execute(f'SELECT count(*) FROM "{schema}".context_notes')
    assert cursor.fetchone() == (1,)


def test_text_written_after_the_first_run_is_copied_for_new_tasks_only(db):
    cursor, schema = db
    merged = add_task(cursor, schema, "Before")
    run_migration(cursor, schema, MIGRATION)
    cursor.execute(
        f"UPDATE \"{schema}\".tasks SET description = 'Edited' WHERE id = %s",
        (merged,),
    )
    late = add_task(cursor, schema, "Created by the old API")

    run_migration(cursor, schema, MIGRATION)

    assert task_note(cursor, schema, merged)[1] == "<p>Before</p>"
    assert task_note(cursor, schema, late)[1] == "<p>Created by the old API</p>"


NOTE_SAMPLES = [
    ("<h2>背景</h2><p>API を <strong>先に</strong>作る</p>", "html"),
    (
        "<ul><li><p>one</p></li><li><p>two</p><ul><li><p>deep</p></li></ul></li></ul>",
        "html",
    ),
    ("<p>a<br>b<BR/>c<br />d</p><p></p>", "html"),
    ("<p>a &amp; b &lt;c&gt;&nbsp;&nbsp;d　e &quot;q&quot; &#39;s&#39;</p>", "html"),
    (
        "<table><tbody><tr><th>k</th><th>v</th></tr>"
        "<tr><td>x</td><td>1</td></tr></tbody></table>",
        "html",
    ),
    (
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">'
        '<label><input type="checkbox" checked="checked"><span></span></label>'
        "<div><p>done</p></div></li></ul>",
        "html",
    ),
    ('<pre><code class="language-py">x = 1\n\n  y = 2</code></pre>', "html"),
    ('<p><a href="https://example.com/?a=1&amp;b=2">link</a> tail</p>', "html"),
    ("  <TODO> write\r\n\r\n next  ", "markdown"),
    ("<p>   </p><p>&nbsp;</p>", "html"),
]


@pytest.mark.parametrize(("content", "content_type"), NOTE_SAMPLES)
def test_content_text_matches_the_api(db, content, content_type):
    cursor, schema = db
    note_id = add_note(cursor, schema, content, content_type)

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        f'SELECT content_text FROM "{schema}".context_notes WHERE id = %s', (note_id,)
    )
    assert cursor.fetchone() == (note_plain_text(content, content_type),)


def test_backfill_keeps_updated_at_and_text_the_api_wrote(db):
    cursor, schema = db
    untouched = add_note(cursor, schema, "<p>Project plan</p>")
    merged_task = add_task(cursor, schema, "Why")
    merged = add_note(cursor, schema, "<p>Plan</p>", task_id=merged_task)
    run_migration(cursor, schema, MIGRATION)
    # What the API stores wins over what the SQL rules would give.
    cursor.execute(
        f"UPDATE \"{schema}\".context_notes SET content_text = 'api text', "
        "updated_at = %s WHERE id = %s",
        (OLD, untouched),
    )
    cursor.execute(
        f'UPDATE "{schema}".context_notes SET updated_at = %s WHERE id = %s',
        (OLD, untouched),
    )

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        f'SELECT id::text, content_text, updated_at FROM "{schema}".context_notes'
    )
    rows = {row[0]: row[1:] for row in cursor.fetchall()}
    assert rows[untouched][0] == "api text"
    # Merged notes changed, so they are newer; the trigger still works.
    assert rows[merged][1] > OLD
    assert rows[untouched][1] > OLD  # the test's own UPDATE fired the trigger
    cursor.execute(
        "SELECT tgenabled FROM pg_trigger WHERE tgname = "
        "'update_context_notes_updated_at' AND tgrelid = %s::regclass",
        (f'"{schema}".context_notes',),
    )
    assert cursor.fetchone() == ("O",)


def test_backfill_alone_does_not_touch_updated_at(db):
    cursor, schema = db
    note_id = add_note(cursor, schema, "<p>Project plan</p>")

    run_migration(cursor, schema, MIGRATION)

    cursor.execute(
        f'SELECT content_text, updated_at FROM "{schema}".context_notes WHERE id = %s',
        (note_id,),
    )
    assert cursor.fetchone() == ("Project plan", OLD)


def test_migration_runs_without_the_updated_at_trigger(db):
    cursor, schema = db
    cursor.execute(
        f'DROP TRIGGER update_context_notes_updated_at ON "{schema}".context_notes'
    )
    task_id = add_task(cursor, schema, "Why")

    run_migration(cursor, schema, MIGRATION)

    assert task_note(cursor, schema, task_id)[3] == "Why"


def test_rollback_keeps_descriptions_memos_and_notes(db):
    cursor, schema = db
    task_id = add_task(cursor, schema, "Why", "Remember")
    run_migration(cursor, schema, MIGRATION)

    run_migration(cursor, schema, ROLLBACK)

    cursor.execute(f'SELECT description, memo FROM "{schema}".tasks')
    assert cursor.fetchone() == ("Why", "Remember")
    cursor.execute(
        f'SELECT content FROM "{schema}".context_notes WHERE task_id = %s', (task_id,)
    )
    assert cursor.fetchone() == ("<p>Why</p>" + MEMO_HEADING + "<p>Remember</p>",)
    cursor.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND column_name IN ('content_text', 'note_merged_at')",
        (schema,),
    )
    assert cursor.fetchall() == []
    run_migration(cursor, schema, ROLLBACK)
