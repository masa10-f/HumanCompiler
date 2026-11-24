# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Back up and import a user's data on PostgreSQL, where foreign keys are enforced.

Notes have no ORM relationship to the project, goal or task they are on, and
logs have none to the Runner session they were measured in, so an import that
adds them in the same flush as those rows fails on PostgreSQL (SQLite does not
check the foreign keys)."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
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
        session.commit()

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_user_backup(str(source))

    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    assert backup["metadata"]["total_records"]["context_notes"] == 2
    assert {note["content"] for note in backup["context_notes"]} == {
        "<p>Task body</p>",
        "<p>Project plan</p>",
    }

    manager.restore_user_data(backup_path, str(target))

    assert notes_of(engine, target) == {
        "task:Task": "<p>Task body</p>",
        "project:Project": "<p>Project plan</p>",
    }
    # The source user's notes are still theirs.
    assert len(notes_of(engine, source)) == 2


def add_task(engine: Engine, owner: UUID, title: str = "Task") -> UUID:
    with Session(engine) as session:
        project = Project(id=uuid4(), owner_id=owner, title="Project")
        session.add(project)
        session.flush()
        goal = Goal(id=uuid4(), project_id=project.id, title="Goal")
        session.add(goal)
        session.flush()
        task = Task(
            id=uuid4(), goal_id=goal.id, title=title, estimate_hours=Decimal("1")
        )
        session.add(task)
        session.commit()
        assert task.id is not None
        return task.id


ENDED = datetime(2029, 12, 31, 10, 0, tzinfo=UTC)


def test_runner_sessions_are_backed_up_and_imported_with_their_logs(
    engine: Engine, tmp_path: Path
):
    source, target = add_user(engine), add_user(engine)
    task_id = add_task(engine, source)
    with Session(engine) as session:
        # A Runner checkout: the session and the log that carries its time.
        checked_out = WorkSession(
            id=uuid4(),
            user_id=source,
            task_id=task_id,
            started_at=ENDED - timedelta(minutes=50),
            planned_checkout_at=ENDED,
            ended_at=ENDED,
            total_paused_seconds=300,
            decision=SessionDecision.SWITCH,
            kpt_keep="Kept focus",
            kpt_try="Start earlier",
            remaining_estimate_hours=Decimal("1.50"),
        )
        # A session whose time record was deleted, and one still running.
        without_log = WorkSession(
            id=uuid4(),
            user_id=source,
            task_id=task_id,
            started_at=ENDED - timedelta(hours=5),
            planned_checkout_at=ENDED - timedelta(hours=4),
            ended_at=ENDED - timedelta(hours=4),
            kpt_problem="Interrupted",
        )
        running = WorkSession(
            id=uuid4(),
            user_id=source,
            task_id=task_id,
            started_at=ENDED + timedelta(hours=1),
            planned_checkout_at=ENDED + timedelta(hours=2),
        )
        session.add_all([checked_out, without_log, running])
        session.flush()
        session.add(
            Log(
                id=uuid4(),
                task_id=task_id,
                actual_minutes=45,
                work_session_id=checked_out.id,
                created_at=ENDED,
            )
        )
        session.add(
            Log(id=uuid4(), task_id=task_id, actual_minutes=20, comment="By hand")
        )
        checked_out_id = checked_out.id
        session.commit()

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_user_backup(str(source))

    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    assert backup["metadata"]["total_records"]["work_sessions"] == 3
    assert len(backup["work_sessions"]) == 3

    # The target user is in a session of their own while they import.
    target_task_id = add_task(engine, target, "Own task")
    with Session(engine) as session:
        session.add(
            WorkSession(
                id=uuid4(),
                user_id=target,
                task_id=target_task_id,
                planned_checkout_at=ENDED,
            )
        )
        session.commit()

    manager.restore_user_data(backup_path, str(target))

    with Session(engine) as session:
        imported_task = session.exec(
            select(Task)
            .join(Goal)
            .join(Project)
            .where(Project.owner_id == target, Task.title == "Task")
        ).one()
        sessions = session.exec(
            select(WorkSession)
            .where(
                WorkSession.user_id == target, WorkSession.task_id == imported_task.id
            )
            .order_by(WorkSession.ended_at.desc())  # type: ignore[union-attr]
        ).all()
        logs = session.exec(
            select(Log)
            .where(Log.task_id == imported_task.id)
            .order_by(Log.actual_minutes.desc())  # type: ignore[attr-defined]
        ).all()
        running_sessions = session.exec(
            select(WorkSession).where(
                WorkSession.user_id == target,
                WorkSession.ended_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()

    # The two ended sessions came over, as the target's, with what they hold.
    assert [work_session.kpt_keep for work_session in sessions] == ["Kept focus", None]
    imported, imported_without_log = sessions
    assert imported.id != checked_out_id
    assert imported.started_at == ENDED - timedelta(minutes=50)
    assert imported.ended_at == ENDED
    assert imported.total_paused_seconds == 300
    assert imported.decision == SessionDecision.SWITCH
    assert imported.kpt_try == "Start earlier"
    assert imported.remaining_estimate_hours == Decimal("1.50")
    assert imported_without_log.kpt_problem == "Interrupted"
    # The log of the checkout points at the imported session, not the original.
    runner_log, manual_log = logs
    assert runner_log.actual_minutes == 45
    assert runner_log.work_session_id == imported.id
    assert runner_log.created_at == ENDED
    assert manual_log.comment == "By hand"
    assert manual_log.work_session_id is None
    # The session that was running in the backup is not running for the target:
    # they keep the one they were in.
    assert [work_session.task_id for work_session in running_sessions] == [
        target_task_id
    ]


def test_a_log_whose_session_is_not_in_the_backup_keeps_its_time(
    engine: Engine, tmp_path: Path
):
    target = add_user(engine)
    old_user, project_id, goal_id, task_id = (str(uuid4()) for _ in range(4))
    # A backup made before sessions were part of it: the log names a session
    # the file does not carry, and a dangling link would fail the whole import.
    backup = {
        "users": [{"id": old_user, "email": "old@example.com"}],
        "projects": [{"id": project_id, "owner_id": old_user, "title": "Project"}],
        "goals": [{"id": goal_id, "project_id": project_id, "title": "Goal"}],
        "tasks": [
            {
                "id": task_id,
                "goal_id": goal_id,
                "title": "Task",
                "estimate_hours": "1.00",
            }
        ],
        "logs": [
            {
                "id": str(uuid4()),
                "task_id": task_id,
                "actual_minutes": 45,
                "work_session_id": str(uuid4()),
                "created_at": "2029-12-31 10:00:00+00:00",
            }
        ],
        "metadata": {"backup_type": "user_specific", "version": "2.0"},
    }
    backup_path = tmp_path / "old.json"
    backup_path.write_text(json.dumps(backup), encoding="utf-8")

    DataBackupManager(str(tmp_path)).restore_user_data(str(backup_path), str(target))

    with Session(engine) as session:
        (log,) = session.exec(select(Log)).all()
    assert log.actual_minutes == 45
    assert log.work_session_id is None
    assert log.created_at == ENDED


def test_every_kind_of_record_survives_export_and_import(
    engine: Engine, tmp_path: Path
):
    """A backup stores timestamps, dates and decimals as text: the import must
    read every table's rows back, not only the ones the other tests fill."""
    source, target = add_user(engine), add_user(engine)
    created = datetime(2029, 6, 1, 9, 30, tzinfo=UTC)
    with Session(engine) as session:
        project = Project(
            id=uuid4(), owner_id=source, title="Project", created_at=created
        )
        session.add(project)
        session.flush()
        goals = [
            Goal(id=uuid4(), project_id=project.id, title=title, created_at=created)
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
                created_at=created,
            )
            for title in ("First task", "Second task")
        ]
        session.add_all(tasks)
        session.flush()
        quick_task = QuickTask(
            id=uuid4(), owner_id=source, title="Quick", created_at=created
        )
        session.add(quick_task)
        session.add(
            Schedule(
                id=uuid4(),
                user_id=source,
                date=datetime(2029, 6, 2),  # the column has no time zone
                plan_json={"assignments": [{"note": "Morning block"}]},
                created_at=created,
            )
        )
        session.add(UserSettings(id=uuid4(), user_id=source, created_at=created))
        session.add(
            TriageCapacitySettings(id=uuid4(), user_id=source, created_at=created)
        )
        run = TaskTriageRun(id=uuid4(), user_id=source, created_at=created)
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

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_user_backup(str(source))
    manager.restore_user_data(backup_path, str(target))

    with Session(engine) as session:
        imported_project = session.exec(
            select(Project).where(Project.owner_id == target)
        ).one()
        imported_goals = session.exec(
            select(Goal).where(Goal.project_id == imported_project.id)
        ).all()
        goal_ids = [goal.id for goal in imported_goals]
        imported_tasks = session.exec(
            select(Task).where(Task.goal_id.in_(goal_ids))  # type: ignore[attr-defined]
        ).all()
        task_by_title = {task.title: task for task in imported_tasks}
        goal_by_title = {goal.title: goal for goal in imported_goals}
        schedule = session.exec(
            select(Schedule).where(Schedule.user_id == target)
        ).one()
        imported_run = session.exec(
            select(TaskTriageRun).where(TaskTriageRun.user_id == target)
        ).one()
        item = session.exec(
            select(TaskTriageItem).where(TaskTriageItem.run_id == imported_run.id)
        ).one()
        goal_dependency = session.exec(
            select(GoalDependency).where(
                GoalDependency.goal_id.in_(goal_ids)  # type: ignore[attr-defined]
            )
        ).one()
        task_dependency = session.exec(
            select(TaskDependency).where(
                TaskDependency.task_id == task_by_title["Second task"].id
            )
        ).one()
        quick_tasks = session.exec(
            select(QuickTask).where(QuickTask.owner_id == target)
        ).all()
        settings = session.exec(
            select(UserSettings).where(UserSettings.user_id == target)
        ).all()
        triage_settings = session.exec(
            select(TriageCapacitySettings).where(
                TriageCapacitySettings.user_id == target
            )
        ).all()

    assert imported_project.created_at == created
    assert set(goal_by_title) == {"First goal", "Second goal"}
    assert set(task_by_title) == {"First task", "Second task"}
    first_task = task_by_title["First task"]
    assert first_task.estimate_hours == Decimal("2.50")
    assert first_task.due_date == datetime(2029, 7, 1, tzinfo=UTC)
    assert first_task.created_at == created
    assert [quick.title for quick in quick_tasks] == ["Quick"]
    assert schedule.date == datetime(2029, 6, 2)
    assert schedule.plan_json == {"assignments": [{"note": "Morning block"}]}
    assert len(settings) == 1
    assert len(triage_settings) == 1
    assert imported_run.created_at == created
    # References inside the imported rows follow the new IDs.
    assert item.task_id == first_task.id
    assert item.goal_id == goal_by_title["First goal"].id
    assert item.project_id == imported_project.id
    assert goal_dependency.goal_id == goal_by_title["Second goal"].id
    assert goal_dependency.depends_on_goal_id == goal_by_title["First goal"].id
    assert task_dependency.depends_on_task_id == first_task.id


def test_a_user_backup_does_not_carry_the_openai_api_key(
    engine: Engine, tmp_path: Path
):
    source, target = add_user(engine), add_user(engine)
    with Session(engine) as session:
        session.add(
            UserSettings(
                id=uuid4(),
                user_id=source,
                openai_api_key_encrypted="encrypted-key",
                ai_features_enabled=True,
                week_start_day="monday",
            )
        )
        session.commit()

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_user_backup(str(source))

    assert "encrypted-key" not in Path(backup_path).read_text(encoding="utf-8")

    manager.restore_user_data(backup_path, str(target))

    with Session(engine) as session:
        imported = session.exec(
            select(UserSettings).where(UserSettings.user_id == target)
        ).one()
        kept = session.exec(
            select(UserSettings).where(UserSettings.user_id == source)
        ).one()
    # The other settings come over; AI features wait for the target's own key.
    assert imported.week_start_day == "monday"
    assert imported.openai_api_key_encrypted is None
    assert imported.ai_features_enabled is False
    # Making a backup changes nothing for the user it is of.
    assert kept.openai_api_key_encrypted == "encrypted-key"
    assert kept.ai_features_enabled is True


def test_import_of_an_older_backup_does_not_bring_its_openai_api_key(
    engine: Engine, tmp_path: Path
):
    target = add_user(engine)
    old_user = str(uuid4())
    # A backup made before keys were left out: the key of the user it is of.
    backup = {
        "users": [{"id": old_user, "email": "old@example.com"}],
        "user_settings": [
            {
                "id": str(uuid4()),
                "user_id": old_user,
                "openai_api_key_encrypted": "encrypted-old-key",
                "ai_features_enabled": True,
                "week_start_day": "monday",
            }
        ],
        "metadata": {"backup_type": "user_specific", "version": "2.0"},
    }
    backup_path = tmp_path / "old.json"
    backup_path.write_text(json.dumps(backup), encoding="utf-8")

    DataBackupManager(str(tmp_path)).restore_user_data(str(backup_path), str(target))

    with Session(engine) as session:
        imported = session.exec(select(UserSettings)).one()
    assert imported.user_id == target
    assert imported.week_start_day == "monday"
    assert imported.openai_api_key_encrypted is None
    assert imported.ai_features_enabled is False


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
