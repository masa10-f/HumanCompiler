# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migrations 047 and 048 and the 047 rollback against an isolated
PostgreSQL schema."""

from collections.abc import Iterator
from datetime import UTC, date, datetime
import os
from uuid import uuid4

import psycopg2
import pytest

from humancompiler_api.note_markdown import agent_append_heading
from humancompiler_api.note_text import note_plain_text
from tests.postgres_migration_helpers import run_migration

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

SECTIONS = "047_add_note_sections.sql"
SECTIONS_ROLLBACK = "047_add_note_sections_rollback.sql"
MOVE = "048_move_agent_appends_to_logs.sql"
USER_ID = str(uuid4())
PROJECT_ID = str(uuid4())
GOAL_ID = str(uuid4())
TASK_ID = str(uuid4())
OLD = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
# The heading the API puts before text an agent appended.
HEADING = agent_append_heading("Claude Code", date(2026, 11, 20))
LATER_HEADING = agent_append_heading("Codex <2>", date(2026, 11, 21))


@pytest.fixture
def db() -> Iterator[tuple]:
    # No production table is touched, even when running against an existing database.
    schema = f"note_sections_test_{uuid4().hex}"
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
                    updated_at TIMESTAMPTZ DEFAULT NOW())"""
            )
            # The table as 017 creates it, with content_text of 044 and the
            # updated_at trigger of 035.
            cursor.execute(
                f"""CREATE TABLE {s}.context_notes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES {s}.users(id),
                    project_id UUID REFERENCES {s}.projects(id),
                    goal_id UUID REFERENCES {s}.goals(id),
                    task_id UUID REFERENCES {s}.tasks(id),
                    content TEXT NOT NULL DEFAULT '',
                    content_type VARCHAR(20) NOT NULL DEFAULT 'markdown',
                    content_text TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    CONSTRAINT unique_project_note UNIQUE (project_id),
                    CONSTRAINT unique_goal_note UNIQUE (goal_id),
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
            # Only the columns of 046 that the migrations read.
            cursor.execute(
                f"""CREATE TABLE {s}.note_attachments (
                    id UUID PRIMARY KEY,
                    note_id UUID REFERENCES {s}.context_notes(id)
                        ON DELETE SET NULL)"""
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
            cursor.execute(
                f"INSERT INTO {s}.tasks (id, goal_id, updated_at) VALUES (%s, %s, %s)",
                (TASK_ID, GOAL_ID, OLD),
            )
            yield cursor, schema
    finally:
        connection.rollback()
        connection.close()


def add_note(
    cursor,
    schema: str,
    column: str,
    item_id: str,
    content: str,
    content_type: str = "html",
    section: str | None = None,
) -> str:
    """A note as the API stores it: content_text is the content's visible text."""
    note_id = str(uuid4())
    columns = ["id", "user_id", column, "content", "content_type", "content_text"]
    values = [
        note_id,
        USER_ID,
        item_id,
        content,
        content_type,
        note_plain_text(content, content_type),
    ]
    if section is not None:
        columns.append("section")
        values.append(section)
    columns.append("updated_at")
    values.append(OLD)
    cursor.execute(
        f'INSERT INTO "{schema}".context_notes ({", ".join(columns)}) '
        f"VALUES ({', '.join(['%s'] * len(values))})",
        values,
    )
    return note_id


def notes_of(cursor, schema: str, column: str, item_id: str) -> dict[str, tuple]:
    """section -> (content, content_type, content_text) of the item's notes."""
    cursor.execute(
        f"SELECT section, content, content_type, content_text "
        f'FROM "{schema}".context_notes WHERE {column} = %s',
        (item_id,),
    )
    return {row[0]: row[1:] for row in cursor.fetchall()}


def constraint_names(cursor, schema: str) -> set[str]:
    cursor.execute(
        "SELECT conname FROM pg_constraint WHERE conrelid = %s::regclass",
        (f'"{schema}".context_notes',),
    )
    return {row[0] for row in cursor.fetchall()}


def test_sections_make_every_note_an_overview_and_allow_one_log(db):
    cursor, schema = db
    add_note(cursor, schema, "project_id", PROJECT_ID, "<p>Why</p>")

    run_migration(cursor, schema, SECTIONS)
    run_migration(cursor, schema, SECTIONS)  # applied by hand, then at startup

    assert notes_of(cursor, schema, "project_id", PROJECT_ID) == {
        "overview": ("<p>Why</p>", "html", "Why")
    }
    names = constraint_names(cursor, schema)
    assert {
        "context_notes_section_check",
        "unique_project_note_section",
        "unique_goal_note_section",
        "unique_task_note_section",
    } <= names
    assert not {"unique_project_note", "unique_goal_note", "unique_task_note"} & names

    add_note(cursor, schema, "project_id", PROJECT_ID, "<p>Did</p>", section="log")
    for section in ("overview", "log"):
        cursor.execute("SAVEPOINT duplicate")
        with pytest.raises(psycopg2.errors.UniqueViolation):
            add_note(cursor, schema, "project_id", PROJECT_ID, "", section=section)
        cursor.execute("ROLLBACK TO SAVEPOINT duplicate")
    cursor.execute("SAVEPOINT unknown")
    with pytest.raises(psycopg2.errors.CheckViolation):
        add_note(cursor, schema, "goal_id", GOAL_ID, "", section="journal")
    cursor.execute("ROLLBACK TO SAVEPOINT unknown")


def test_agent_appends_move_to_the_log(db):
    cursor, schema = db
    overview = (
        '<h2>Plan</h2><p>Ship &amp; learn</p><img data-attachment-id="x" alt="Fig">'
    )
    log = (
        f"{HEADING}<p>Did <strong>this</strong></p><ul><li><p>one</p></li></ul>"
        f"{LATER_HEADING}<p>Did that</p>"
    )
    note_id = add_note(cursor, schema, "project_id", PROJECT_ID, overview + log)
    run_migration(cursor, schema, SECTIONS)

    run_migration(cursor, schema, MOVE)

    notes = notes_of(cursor, schema, "project_id", PROJECT_ID)
    # Each note's text is what the API would write for its content.
    assert notes == {
        "overview": (overview, "html", note_plain_text(overview, "html")),
        "log": (log, "html", note_plain_text(log, "html")),
    }
    assert notes["overview"][2] == "Plan\nShip & learn\nFig"
    assert notes["log"][2].startswith(
        "エージェントからの追記（2026-11-20、Claude Code）\n"
    )
    cursor.execute(
        f'SELECT id::text, section, user_id::text, updated_at > %s FROM "{schema}".context_notes',
        (OLD,),
    )
    rows = {row[1]: row for row in cursor.fetchall()}
    # The overview is the same row; both count as changed for incremental reads.
    assert rows["overview"] == (note_id, "overview", USER_ID, True)
    assert rows["log"][2:] == (USER_ID, True)


def test_note_that_starts_with_an_append_becomes_the_log(db):
    cursor, schema = db
    log = f"{HEADING}<p>Only this</p>"
    add_note(cursor, schema, "goal_id", GOAL_ID, log)
    run_migration(cursor, schema, SECTIONS)

    run_migration(cursor, schema, MOVE)

    assert notes_of(cursor, schema, "goal_id", GOAL_ID) == {
        "overview": ("", "html", ""),
        "log": (log, "html", note_plain_text(log, "html")),
    }


def test_move_leaves_other_notes_alone_and_runs_once(db):
    cursor, schema = db
    appended = f"<p>Body</p>{HEADING}<p>Summary</p>"
    # A task's note is its body, whoever wrote it.
    add_note(cursor, schema, "task_id", TASK_ID, appended)
    # No agent heading: nothing to move.
    add_note(
        cursor, schema, "project_id", PROJECT_ID, "<p>エージェントからの追記なし</p>"
    )
    # A Markdown note is the user's text, not HTML to cut.
    markdown = f"Text\n{HEADING}"
    add_note(cursor, schema, "goal_id", GOAL_ID, markdown, "markdown")
    run_migration(cursor, schema, SECTIONS)

    run_migration(cursor, schema, MOVE)

    assert notes_of(cursor, schema, "task_id", TASK_ID) == {
        "overview": (appended, "html", note_plain_text(appended, "html"))
    }
    assert notes_of(cursor, schema, "project_id", PROJECT_ID) == {
        "overview": (
            "<p>エージェントからの追記なし</p>",
            "html",
            "エージェントからの追記なし",
        )
    }
    assert notes_of(cursor, schema, "goal_id", GOAL_ID) == {
        "overview": (markdown, "markdown", note_plain_text(markdown, "markdown"))
    }
    cursor.execute(f'SELECT updated_at FROM "{schema}".context_notes')
    assert {row[0] for row in cursor.fetchall()} == {OLD}


@pytest.mark.parametrize("empty", ["", "<p></p>"])
def test_move_fills_a_log_that_was_opened_but_never_written(db, empty: str):
    cursor, schema = db
    log = f"{HEADING}<p>Summary</p>"
    add_note(cursor, schema, "project_id", PROJECT_ID, f"<p>Why</p>{log}")
    run_migration(cursor, schema, SECTIONS)
    # The web creates the row when the log is first opened, before 048 runs.
    log_id = add_note(cursor, schema, "project_id", PROJECT_ID, empty, section="log")

    run_migration(cursor, schema, MOVE)
    run_migration(cursor, schema, MOVE)

    assert notes_of(cursor, schema, "project_id", PROJECT_ID) == {
        "overview": ("<p>Why</p>", "html", "Why"),
        "log": (log, "html", note_plain_text(log, "html")),
    }
    cursor.execute(
        f'SELECT id::text, updated_at > %s FROM "{schema}".context_notes '
        "WHERE section = 'log'",
        (OLD,),
    )
    # The same row, so an editor that has it open gets a conflict, not a copy.
    assert cursor.fetchall() == [(log_id, True)]


def test_move_does_not_split_an_item_that_has_a_log(db):
    cursor, schema = db
    first = f"<p>Why</p>{HEADING}<p>Summary</p>"
    add_note(cursor, schema, "project_id", PROJECT_ID, first)
    run_migration(cursor, schema, SECTIONS)
    run_migration(cursor, schema, MOVE)
    # After the move the user asks an agent to add to the overview itself.
    cursor.execute(
        f'UPDATE "{schema}".context_notes SET content = content || %s, '
        "content_text = content_text || %s "
        "WHERE project_id = %s AND section = 'overview'",
        (f"{LATER_HEADING}<p>Decision</p>", "\nx", PROJECT_ID),
    )
    before = notes_of(cursor, schema, "project_id", PROJECT_ID)

    run_migration(cursor, schema, MOVE)  # applied by hand, then at startup

    assert notes_of(cursor, schema, "project_id", PROJECT_ID) == before
    assert before["overview"][0] == f"<p>Why</p>{LATER_HEADING}<p>Decision</p>"


def test_move_takes_the_images_the_log_shows(db):
    cursor, schema = db
    kept, moved, both = (str(uuid4()) for _ in range(3))

    def image(attachment_id: str) -> str:
        return f'<img data-attachment-id="{attachment_id.upper()}" alt="Fig">'

    content = (
        f"<p>Why</p>{image(kept)}{image(both)}"
        f"{HEADING}<p>Result</p>{image(moved)}{image(both)}"
    )
    note_id = add_note(cursor, schema, "goal_id", GOAL_ID, content)
    for attachment_id in (kept, moved, both):
        cursor.execute(
            f'INSERT INTO "{schema}".note_attachments (id, note_id) VALUES (%s, %s)',
            (attachment_id, note_id),
        )
    run_migration(cursor, schema, SECTIONS)

    run_migration(cursor, schema, MOVE)

    cursor.execute(
        f"SELECT a.id::text, n.section "
        f'FROM "{schema}".note_attachments AS a '
        f'JOIN "{schema}".context_notes AS n ON n.id = a.note_id'
    )
    assert dict(cursor.fetchall()) == {kept: "overview", moved: "log", both: "overview"}


def test_move_requires_sections(db):
    cursor, schema = db
    with pytest.raises(psycopg2.errors.RaiseException, match="047_add_note_sections"):
        run_migration(cursor, schema, MOVE)


def test_rollback_puts_logs_back_into_the_notes(db):
    cursor, schema = db
    original = f"<p>Why</p>{HEADING}<p>Summary</p>"
    add_note(cursor, schema, "project_id", PROJECT_ID, original)
    run_migration(cursor, schema, SECTIONS)
    run_migration(cursor, schema, MOVE)
    # Written after the move: a Markdown overview with a log, a log without an
    # overview, and an image the log holds.
    add_note(cursor, schema, "goal_id", GOAL_ID, " <TODO> a & b\n\n next ", "markdown")
    add_note(cursor, schema, "goal_id", GOAL_ID, "<p>Did</p>", section="log")
    task_log = add_note(
        cursor, schema, "task_id", TASK_ID, f"{HEADING}<p>Done</p>", section="log"
    )
    attachment_id = str(uuid4())
    cursor.execute(
        f'INSERT INTO "{schema}".note_attachments (id, note_id) VALUES (%s, %s)',
        (attachment_id, task_log),
    )

    run_migration(cursor, schema, SECTIONS_ROLLBACK)

    def note(column: str, item_id: str) -> tuple:
        cursor.execute(
            f"SELECT id::text, content, content_type, content_text "
            f'FROM "{schema}".context_notes WHERE {column} = %s',
            (item_id,),
        )
        (row,) = cursor.fetchall()  # one note per item again
        return row

    # The project's note is what it was before 047 and 048.
    assert note("project_id", PROJECT_ID)[1:] == (
        original,
        "html",
        note_plain_text(original, "html"),
    )
    assert note("goal_id", GOAL_ID)[1:] == (
        "<p>&lt;TODO&gt; a &amp; b</p><p>next</p><p>Did</p>",
        "html",
        "<TODO> a & b\nnext\nDid",
    )
    task_note = note("task_id", TASK_ID)
    assert task_note[1:] == (
        f"{HEADING}<p>Done</p>",
        "html",
        note_plain_text(f"{HEADING}<p>Done</p>", "html"),
    )
    cursor.execute(f'SELECT note_id::text FROM "{schema}".note_attachments')
    assert cursor.fetchall() == [(task_note[0],)]
    cursor.execute(f'SELECT updated_at > %s FROM "{schema}".tasks', (OLD,))
    assert cursor.fetchall() == [(True,)]
    cursor.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = 'context_notes' "
        "AND column_name = 'section'",
        (schema,),
    )
    assert cursor.fetchone() is None
    names = constraint_names(cursor, schema)
    assert {"unique_project_note", "unique_goal_note", "unique_task_note"} <= names
    assert not {name for name in names if name.endswith("_section")}

    # 047 and 048 can be applied again afterwards.
    run_migration(cursor, schema, SECTIONS)
    run_migration(cursor, schema, MOVE)
    assert set(notes_of(cursor, schema, "project_id", PROJECT_ID)) == {
        "overview",
        "log",
    }


def test_rollback_keeps_a_markdown_log_as_text_and_marks_the_note_changed(db):
    cursor, schema = db
    add_note(cursor, schema, "project_id", PROJECT_ID, "<p>Why</p>")
    run_migration(cursor, schema, SECTIONS)
    # A log saved as Markdown through the API, on a schema without the
    # updated_at trigger of 035.
    add_note(
        cursor,
        schema,
        "project_id",
        PROJECT_ID,
        " <TODO> a & b\n\n next ",
        "markdown",
        section="log",
    )
    cursor.execute(
        f'DROP TRIGGER update_context_notes_updated_at ON "{schema}".context_notes'
    )

    run_migration(cursor, schema, SECTIONS_ROLLBACK)

    cursor.execute(
        f"SELECT content, content_type, content_text, updated_at > %s "
        f'FROM "{schema}".context_notes',
        (OLD,),
    )
    merged = "<p>Why</p><p>&lt;TODO&gt; a &amp; b</p><p>next</p>"
    # Incremental reads by updated_at pick the merged note up.
    assert cursor.fetchall() == [
        (merged, "html", note_plain_text(merged, "html"), True)
    ]


def test_rollback_requires_sections(db):
    cursor, schema = db
    with pytest.raises(psycopg2.errors.RaiseException, match="nothing to roll back"):
        run_migration(cursor, schema, SECTIONS_ROLLBACK)
