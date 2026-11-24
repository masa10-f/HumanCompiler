# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Restore a full backup on PostgreSQL: the same rows come back, or nothing changes.

A full restore empties the tables before it fills them (TRUNCATE, which SQLite
does not have), so only PostgreSQL can run it. It is also what rolls back a
failed safe migration."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, text
from sqlmodel import Session, SQLModel, create_engine, select

from humancompiler_api import safe_migration
from humancompiler_api.models import (
    ContextNote,
    Goal,
    GoalDependency,
    Log,
    Project,
    QuickTask,
    Schedule,
    SessionDecision,
    Task,
    TaskDependency,
    TaskTriageItem,
    TaskTriageRun,
    TriageCapacitySettings,
    User,
    UserSettings,
    WeeklyNote,
    WorkSession,
)
from humancompiler_api.safe_migration import (
    FULL_BACKUP_MODELS,
    DataBackupManager,
    SafeMigrationError,
    SafeMigrationManager,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

BACKED_UP = set(FULL_BACKUP_MODELS)
CREATED = datetime(2029, 6, 1, 9, 30, tzinfo=UTC)


@pytest.fixture
def engine(monkeypatch) -> Iterator[Engine]:
    # No production table is touched, even when running against an existing database.
    url = os.environ["NOTEBOOK_TEST_POSTGRES_URL"]
    schema = f"backup_restore_test_{uuid4().hex}"
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


def all_rows(engine: Engine) -> dict[str, list[dict[str, Any]]]:
    """Every table's rows as the database holds them, in a stable order."""
    with engine.connect() as connection:
        return {
            table.name: sorted(
                (dict(row) for row in connection.execute(table.select()).mappings()),
                key=lambda row: str(row["id"]),
            )
            for table in SQLModel.metadata.sorted_tables
        }


def add_one_of_everything(engine: Engine) -> UUID:
    """A user with rows in every table a full backup carries. Returns the user."""
    user_id = uuid4()
    with Session(engine) as session:
        session.add(User(id=user_id, email=f"{user_id}@example.com"))
        session.flush()
        project = Project(
            id=uuid4(), owner_id=user_id, title="Project", created_at=CREATED
        )
        session.add(project)
        session.flush()
        goals = [
            Goal(id=uuid4(), project_id=project.id, title=title, created_at=CREATED)
            for title in ("First goal", "Second goal")
        ]
        session.add_all(goals)
        session.flush()
        tasks = [
            Task(
                id=uuid4(),
                goal_id=goals[0].id,
                title=title,
                estimate_hours=Decimal("2.50"),
                due_date=datetime(2029, 7, 1, tzinfo=UTC),
                created_at=CREATED,
            )
            for title in ("First task", "Second task")
        ]
        session.add_all(tasks)
        session.flush()
        session.add(
            ContextNote(
                user_id=user_id,
                task_id=tasks[0].id,
                content="<p>Task body</p>",
                content_type="html",
            )
        )
        session.add(
            ContextNote(
                user_id=user_id,
                project_id=project.id,
                content="<p>Project plan</p>",
                content_type="html",
            )
        )
        quick_task = QuickTask(
            id=uuid4(), owner_id=user_id, title="Quick", created_at=CREATED
        )
        session.add(quick_task)
        session.add(
            Schedule(
                id=uuid4(),
                user_id=user_id,
                date=datetime(2029, 6, 2),  # the column has no time zone
                plan_json={"assignments": [{"note": "Morning block"}]},
                created_at=CREATED,
            )
        )
        # A Runner checkout with its log, and a session still running.
        checked_out = WorkSession(
            id=uuid4(),
            user_id=user_id,
            task_id=tasks[0].id,
            started_at=CREATED,
            planned_checkout_at=CREATED + timedelta(minutes=50),
            ended_at=CREATED + timedelta(minutes=50),
            total_paused_seconds=300,
            decision=SessionDecision.SWITCH,
            kpt_keep="Kept focus",
            remaining_estimate_hours=Decimal("1.50"),
        )
        running = WorkSession(
            id=uuid4(),
            user_id=user_id,
            task_id=tasks[1].id,
            started_at=CREATED + timedelta(hours=1),
            planned_checkout_at=CREATED + timedelta(hours=2),
        )
        session.add_all([checked_out, running])
        session.flush()
        session.add(
            Log(
                id=uuid4(),
                task_id=tasks[0].id,
                actual_minutes=45,
                work_session_id=checked_out.id,
                created_at=CREATED,
            )
        )
        session.add(
            Log(id=uuid4(), task_id=tasks[0].id, actual_minutes=20, comment="By hand")
        )
        session.add(UserSettings(id=uuid4(), user_id=user_id, created_at=CREATED))
        session.add(
            TriageCapacitySettings(id=uuid4(), user_id=user_id, created_at=CREATED)
        )
        run = TaskTriageRun(id=uuid4(), user_id=user_id, created_at=CREATED)
        session.add(run)
        session.flush()
        session.add(
            TaskTriageItem(
                id=uuid4(),
                run_id=run.id,
                item_type="task",
                task_id=tasks[0].id,
                goal_id=goals[0].id,
                project_id=project.id,
                title="First task",
                bucket_key="project",
                bucket_title="Project",
            )
        )
        session.add(
            TaskTriageItem(
                id=uuid4(),
                run_id=run.id,
                item_type="quick_task",
                quick_task_id=quick_task.id,
                title="Quick",
                bucket_key="quick",
                bucket_title="Quick",
            )
        )
        session.add(
            GoalDependency(
                id=uuid4(), goal_id=goals[1].id, depends_on_goal_id=goals[0].id
            )
        )
        session.add(
            TaskDependency(
                id=uuid4(), task_id=tasks[1].id, depends_on_task_id=tasks[0].id
            )
        )
        session.commit()
    return user_id


def change_the_data(engine: Engine, user_id: UUID) -> None:
    """What happens after a backup: rows are edited, deleted and added."""
    with Session(engine) as session:
        project = session.exec(select(Project).where(Project.owner_id == user_id)).one()
        project.title = "Renamed"
        # With the task go its running session and its dependency.
        session.delete(
            session.exec(
                select(Task)
                .join(Goal)
                .where(Goal.project_id == project.id, Task.title == "Second task")
            ).one()
        )
        newcomer = User(id=uuid4(), email="newcomer@example.com")
        session.add(newcomer)
        session.flush()
        session.add(Project(id=uuid4(), owner_id=newcomer.id, title="Later project"))
        session.commit()


def test_a_full_backup_restores_to_the_same_rows(engine: Engine, tmp_path: Path):
    add_one_of_everything(engine)
    user_id = add_one_of_everything(engine)
    before = all_rows(engine)
    # Every table the backup carries has rows to bring back.
    assert all(before[table] for table in BACKED_UP)

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")
    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    # The restore reads everything the backup writes.
    assert set(backup) - {"metadata"} == BACKED_UP

    change_the_data(engine, user_id)
    assert all_rows(engine) != before

    manager.restore_backup(backup_path)

    assert all_rows(engine) == before


def test_a_restore_that_fails_leaves_the_database_as_it_was(
    engine: Engine, tmp_path: Path
):
    user_id = add_one_of_everything(engine)
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")

    # The file is damaged: a task of a goal the backup does not have. Users,
    # projects and goals are inserted before the tasks are refused.
    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    backup["tasks"][0]["goal_id"] = str(uuid4())
    Path(backup_path).write_text(json.dumps(backup), encoding="utf-8")

    change_the_data(engine, user_id)
    with Session(engine) as session:
        # A table the backup does not carry, which the delete would also empty.
        session.add(WeeklyNote(user_id=user_id, week_start=date(2029, 6, 4)))
        session.commit()
    before = all_rows(engine)
    assert before["weekly_notes"]

    with pytest.raises(SafeMigrationError, match="Backup restoration failed"):
        manager.restore_backup(backup_path)

    assert all_rows(engine) == before


def test_a_file_that_is_not_a_full_backup_deletes_nothing(
    engine: Engine, tmp_path: Path
):
    add_one_of_everything(engine)
    before = all_rows(engine)
    not_a_backup = tmp_path / "other.json"
    not_a_backup.write_text(json.dumps({"metadata": {}}), encoding="utf-8")

    with pytest.raises(SafeMigrationError, match="Backup restoration failed"):
        DataBackupManager(str(tmp_path)).restore_backup(str(not_a_backup))

    assert all_rows(engine) == before


def test_tables_the_backup_does_not_carry_are_emptied_and_named(
    engine: Engine, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    user_id = add_one_of_everything(engine)
    with Session(engine) as session:
        session.add(WeeklyNote(user_id=user_id, week_start=date(2029, 6, 4)))
        session.commit()
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")

    with caplog.at_level(logging.WARNING, logger=safe_migration.logger.name):
        manager.restore_backup(backup_path)

    after = all_rows(engine)
    assert after["users"] and after["tasks"]
    assert after["weekly_notes"] == []
    assert "weekly_notes (1 rows)" in caplog.text


def test_an_older_full_backup_restores(engine: Engine, tmp_path: Path):
    """A backup made before notes and Runner sessions were part of it: tasks
    carry their text, and a log names a session the file does not have."""
    add_one_of_everything(engine)
    user_id, project_id, goal_id, task_id = (str(uuid4()) for _ in range(4))
    backup = {
        "users": [{"id": user_id, "email": "old@example.com"}],
        "projects": [{"id": project_id, "owner_id": user_id, "title": "Project"}],
        "goals": [{"id": goal_id, "project_id": project_id, "title": "Goal"}],
        "tasks": [
            {
                "id": task_id,
                "goal_id": goal_id,
                "title": "Task",
                "description": "Why",
                "memo": None,
                "estimate_hours": "1.00",
            }
        ],
        "logs": [
            {
                "id": str(uuid4()),
                "task_id": task_id,
                "actual_minutes": 45,
                "work_session_id": str(uuid4()),
                "created_at": "2029-06-01 09:30:00+00:00",
            }
        ],
        "metadata": {"version": "2.0"},
    }
    backup_path = tmp_path / "old.json"
    backup_path.write_text(json.dumps(backup), encoding="utf-8")

    DataBackupManager(str(tmp_path)).restore_backup(str(backup_path))

    with Session(engine) as session:
        (user,) = session.exec(select(User)).all()
        (task,) = session.exec(select(Task)).all()
        (note,) = session.exec(select(ContextNote)).all()
        (log,) = session.exec(select(Log)).all()
    assert str(user.id) == user_id
    assert str(task.id) == task_id
    assert (str(note.task_id), note.content) == (task_id, "<p>Why</p>")
    assert log.actual_minutes == 45
    assert log.work_session_id is None
    assert log.created_at == CREATED


def test_a_failed_safe_migration_rolls_back_to_the_backup(
    engine: Engine, tmp_path: Path, monkeypatch
):
    add_one_of_everything(engine)
    before = all_rows(engine)
    monkeypatch.chdir(tmp_path)  # the migration writes its backup under ./backups

    class BreaksHalfway(SafeMigrationManager):
        def _apply_migration(self) -> None:
            with Session(engine) as session:
                session.exec(text("DELETE FROM logs"))  # type: ignore[call-overload]
                session.commit()
            raise RuntimeError("second step failed")

    with pytest.raises(SafeMigrationError, match="second step failed"):
        BreaksHalfway().execute_safe_migration("breaks_halfway")

    assert all_rows(engine) == before
