# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Back up and import notes on PostgreSQL, where foreign keys are enforced.

Notes have no ORM relationship to the project, goal or task they are on, so an
import that adds them in the same flush as those rows fails on PostgreSQL
(SQLite does not check the foreign keys)."""

from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, text
from sqlmodel import Session, SQLModel, create_engine, select

from humancompiler_api import safe_migration
from humancompiler_api.models import (
    ContextNote,
    Goal,
    Log,
    Project,
    Task,
    User,
    WorkSession,
)
from humancompiler_api.safe_migration import DataBackupManager

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)


@pytest.fixture
def engine(monkeypatch) -> Iterator[Engine]:
    # No production table is touched, even when running against an existing database.
    url = os.environ["NOTEBOOK_TEST_POSTGRES_URL"]
    schema = f"backup_notes_test_{uuid4().hex}"
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        SQLModel.metadata.create_all(scoped)
        monkeypatch.setattr(safe_migration.db, "get_engine", lambda: scoped)
        yield scoped
    finally:
        scoped.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def add_user(engine: Engine) -> UUID:
    user_id = uuid4()
    with Session(engine) as session:
        session.add(User(id=user_id, email=f"{user_id}@example.com"))
        session.commit()
    return user_id


def notes_of(engine: Engine, user_id: UUID) -> dict[str, str]:
    """The user's notes as {what they are on: content}."""
    with Session(engine) as session:
        notes = session.exec(
            select(ContextNote).where(ContextNote.user_id == user_id)
        ).all()
        found = {}
        for note in notes:
            if note.task_id is not None:
                task = session.get(Task, note.task_id)
                assert task is not None
                found[f"task:{task.title}"] = note.content
            elif note.project_id is not None:
                project = session.get(Project, note.project_id)
                assert project is not None
                found[f"project:{project.title}"] = note.content
        return found


def test_user_backup_carries_notes_and_imports_them(engine: Engine, tmp_path: Path):
    source, target = add_user(engine), add_user(engine)
    with Session(engine) as session:
        project = Project(id=uuid4(), owner_id=source, title="Project")
        session.add(project)
        session.flush()
        goal = Goal(id=uuid4(), project_id=project.id, title="Goal")
        session.add(goal)
        session.flush()
        task = Task(
            id=uuid4(), goal_id=goal.id, title="Task", estimate_hours=Decimal("1")
        )
        session.add(task)
        session.flush()
        session.add(
            ContextNote(
                user_id=source,
                task_id=task.id,
                content="<p>Task body</p>",
                content_type="html",
            )
        )
        session.add(
            ContextNote(
                user_id=source,
                project_id=project.id,
                content="<p>Project plan</p>",
                content_type="html",
            )
        )
        # A Runner checkout: the session and the log that carries its time.
        runner_session = WorkSession(
            id=uuid4(),
            user_id=source,
            task_id=task.id,
            planned_checkout_at=datetime(2030, 1, 1, tzinfo=UTC),
            ended_at=datetime(2029, 12, 31, tzinfo=UTC),
        )
        session.add(runner_session)
        session.flush()
        session.add(
            Log(
                id=uuid4(),
                task_id=task.id,
                actual_minutes=45,
                work_session_id=runner_session.id,
            )
        )
        session.commit()

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_user_backup(str(source))

    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    assert backup["metadata"]["total_records"]["context_notes"] == 2
    assert {note["content"] for note in backup["context_notes"]} == {
        "<p>Task body</p>",
        "<p>Project plan</p>",
    }

    # The import does not parse the timestamps a backup stores as text (it
    # fails on the first row that has one, with or without notes), so this
    # test imports the same backup without them.
    for rows in backup.values():
        if isinstance(rows, list):
            for row in rows:
                row.pop("created_at", None)
                row.pop("updated_at", None)
    Path(backup_path).write_text(json.dumps(backup), encoding="utf-8")

    manager.restore_user_data(backup_path, str(target))

    assert notes_of(engine, target) == {
        "task:Task": "<p>Task body</p>",
        "project:Project": "<p>Project plan</p>",
    }
    # The source user's notes are still theirs.
    assert len(notes_of(engine, source)) == 2
    # Sessions are not in a backup: the imported log keeps its time and loses
    # the link, where a dangling one would fail the whole import.
    with Session(engine) as session:
        imported_logs = session.exec(
            select(Log).where(Log.work_session_id.is_(None))  # type: ignore[union-attr]
        ).all()
    assert [log.actual_minutes for log in imported_logs] == [45]


def test_import_of_an_older_backup_puts_task_text_into_notes(
    engine: Engine, tmp_path: Path
):
    target = add_user(engine)
    old_user, project_id, goal_id = str(uuid4()), str(uuid4()), str(uuid4())
    backup = {
        "users": [{"id": old_user, "email": "old@example.com"}],
        "projects": [{"id": project_id, "owner_id": old_user, "title": "Project"}],
        "goals": [{"id": goal_id, "project_id": project_id, "title": "Goal"}],
        "tasks": [
            {
                "id": str(uuid4()),
                "goal_id": goal_id,
                "title": "With text",
                "description": "Why <now>",
                "memo": "Remember",
                "estimate_hours": "1.00",
            },
            {
                "id": str(uuid4()),
                "goal_id": goal_id,
                "title": "Without text",
                "description": None,
                "memo": None,
                "estimate_hours": "1.00",
            },
        ],
        "metadata": {"backup_type": "user_specific", "version": "2.0"},
    }
    backup_path = tmp_path / "old.json"
    backup_path.write_text(json.dumps(backup), encoding="utf-8")

    DataBackupManager(str(tmp_path)).restore_user_data(str(backup_path), str(target))

    assert notes_of(engine, target) == {
        "task:With text": (
            "<p>Why &lt;now&gt;</p><p><strong>メモ</strong></p><p>Remember</p>"
        )
    }
    with Session(engine) as session:
        excerpts = {
            task.title: task.note_excerpt for task in session.exec(select(Task)).all()
        }
    assert excerpts == {"With text": "Why <now> メモ Remember", "Without text": None}
