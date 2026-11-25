# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Restore a full backup on PostgreSQL: the same rows come back, or nothing changes.

A full restore empties the tables before it fills them (TRUNCATE, which SQLite
does not have), so only PostgreSQL can run it. It is also what rolls back a
failed safe migration."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
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
    AgentAuditLog,
    AgentChange,
    AgentProposal,
    AgentToken,
    ContextNote,
    DailyPlanDocument,
    EmailNotificationLog,
    EmailNotificationStatus,
    EmailNotificationType,
    Goal,
    GoalDependency,
    Log,
    NoteAttachment,
    Project,
    PushSubscription,
    QuickTask,
    RescheduleDecision,
    RescheduleSuggestion,
    RescheduleTriggerType,
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
    WeeklyRhythmBlock,
    WorkSession,
)
from humancompiler_api.safe_migration import (
    AGENT_TOKEN_LINKS,
    FULL_BACKUP_MODELS,
    DataBackupManager,
    SafeMigrationError,
    SafeMigrationManager,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)

BACKED_UP = set(FULL_BACKUP_MODELS)
# Credentials: a backup leaves them out, and a restore keeps the database's own.
NOT_BACKED_UP = {"agent_tokens", "push_subscriptions"}
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


def all_rows_of(engine: Engine, tables: set[str]) -> dict[str, list[dict[str, Any]]]:
    """The rows of ``tables`` as the database holds them, in a stable order."""
    with engine.connect() as connection:
        return {
            table.name: sorted(
                (dict(row) for row in connection.execute(table.select()).mappings()),
                key=lambda row: str(row["id"]),
            )
            for table in SQLModel.metadata.sorted_tables
            if table.name in tables
        }


def all_rows(engine: Engine) -> dict[str, list[dict[str, Any]]]:
    """Every table that refers to users: all a restore deletes or writes."""
    return all_rows_of(engine, BACKED_UP | NOT_BACKED_UP)


def without_credentials(
    rows: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """What a backup of ``rows`` restores to on a database that holds no
    credentials: the same rows, without them and without the links to them."""
    restored = {
        table: [] if table in NOT_BACKED_UP else found for table, found in rows.items()
    }
    for table, column in AGENT_TOKEN_LINKS.items():
        restored[table] = [{**row, column: None} for row in rows[table]]
    # No OpenAI API key, and so no AI features until the user enters one.
    restored["user_settings"] = [
        {**row, "openai_api_key_encrypted": None, "ai_features_enabled": False}
        for row in rows["user_settings"]
    ]
    return restored


def add_credentials(session: Session, user_id: UUID) -> AgentToken:
    """An agent token and a push subscription of the user. Returns the token."""
    token = AgentToken(
        id=uuid4(),
        user_id=user_id,
        name="Agent",
        scopes=["tasks:read"],
        token_hash=uuid4().hex,
        token_prefix="hc_agent_",
    )
    session.add(token)
    session.add(
        PushSubscription(
            id=uuid4(),
            user_id=user_id,
            endpoint=f"https://push.example.com/{uuid4().hex}",
            p256dh_key="p256dh",
            auth_key="auth",
        )
    )
    session.flush()
    return token


def add_one_of_everything(engine: Engine) -> UUID:
    """A user with rows in every table that refers to users. Returns the user."""
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
        project_note = ContextNote(
            id=uuid4(),
            user_id=user_id,
            project_id=project.id,
            content="<p>Project plan</p>",
            content_type="html",
        )
        session.add(project_note)
        session.flush()
        attachment_id = uuid4()
        session.add(
            NoteAttachment(
                id=attachment_id,
                user_id=user_id,
                note_id=project_note.id,
                bucket="note-attachments",
                object_key=f"{user_id}/{attachment_id}/preview.webp",
                thumb_object_key=f"{user_id}/{attachment_id}/thumb.webp",
                byte_size=64000,
                thumb_byte_size=13000,
                width=1260,
                height=800,
                sha256="a" * 64,
                caption="Loss curve",
                source={"path": "/data/loss.png", "host": "lab"},
                created_at=CREATED,
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
        session.add(
            UserSettings(
                id=uuid4(),
                user_id=user_id,
                openai_api_key_encrypted=f"encrypted-{user_id}",
                ai_features_enabled=True,
                week_start_day="monday",
                created_at=CREATED,
            )
        )
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
        session.add(
            DailyPlanDocument(
                user_id=user_id,
                date=date(2029, 6, 2),
                revision=3,
                document_json={"blocks": [{"type": "text", "text": "Morning"}]},
                search_text="Morning",
                created_at=CREATED,
            )
        )
        session.add(
            WeeklyNote(
                user_id=user_id, week_start=date(2029, 6, 3), content="<p>Week</p>"
            )
        )
        session.add(
            WeeklyRhythmBlock(
                user_id=user_id,
                weekday=0,
                start_time=time(9, 0),
                end_time=time(10, 30),
                project_id=project.id,
            )
        )
        token = add_credentials(session, user_id)
        proposal = AgentProposal(
            id=uuid4(),
            user_id=user_id,
            token_id=token.id,
            agent_name="Agent",
            kind="task_create",
            title="Add a task",
            payload={"title": "Proposed", "estimate_hours": 1.5},
            sources=[{"kind": "note", "id": str(uuid4())}],
            idempotency_key=uuid4().hex,
            project_id=project.id,
            created_at=CREATED,
        )
        session.add(proposal)
        session.add(
            AgentChange(
                user_id=user_id,
                actor="agent",
                agent_token_id=token.id,
                agent_name="Agent",
                proposal_id=proposal.id,
                entity_type="task",
                entity_id=tasks[0].id,
                action="update",
                before={"title": "Before"},
                after={"title": "First task"},
                created_at=CREATED,
            )
        )
        session.add(
            AgentAuditLog(
                id=uuid4(),
                token_id=token.id,
                user_id=user_id,
                token_prefix="hc_agent_",
                method="GET",
                route="/agent/v1/tasks",
                status_code=200,
                duration_ms=12,
                created_at=CREATED,
            )
        )
        session.add(
            EmailNotificationLog(
                user_id=user_id,
                task_id=tasks[0].id,
                notification_type=EmailNotificationType.DEADLINE_REMINDER,
                status=EmailNotificationStatus.SENT,
                sent_at=CREATED,
            )
        )
        suggestion = RescheduleSuggestion(
            id=uuid4(),
            user_id=user_id,
            work_session_id=checked_out.id,
            trigger_type=RescheduleTriggerType.CHECKOUT,
            proposed_schedule_json={"assignments": []},
        )
        session.add(suggestion)
        session.flush()
        session.add(
            RescheduleDecision(
                id=uuid4(),
                suggestion_id=suggestion.id,
                user_id=user_id,
                accepted=True,
                context_json={"reason": "fits"},
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
        assert newcomer.id is not None
        add_credentials(session, newcomer.id)
        session.commit()


def test_a_full_backup_restores_to_the_same_rows(engine: Engine, tmp_path: Path):
    add_one_of_everything(engine)
    user_id = add_one_of_everything(engine)
    before = all_rows(engine)
    # Every table has rows to bring back or to lose.
    assert all(before.values())

    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")
    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    # The restore reads everything the backup writes.
    assert set(backup) - {"metadata"} == BACKED_UP

    change_the_data(engine, user_id)
    assert all_rows(engine) != before

    manager.restore_backup(backup_path)

    # Credentials and the links to them included: the database held them.
    assert all_rows(engine) == before


def test_a_restore_onto_an_empty_database_leaves_no_credentials(
    engine: Engine, tmp_path: Path
):
    """Recovery after the data is gone: a backup has no credentials to give."""
    add_one_of_everything(engine)
    before = all_rows(engine)
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))

    manager.restore_backup(backup_path)

    assert all_rows(engine) == without_credentials(before)


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
    before = all_rows(engine)
    # Including what the backup does not carry, which the delete also empties.
    assert all(before[table] for table in NOT_BACKED_UP)

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


def test_credentials_are_not_in_the_backup_file(engine: Engine, tmp_path: Path):
    add_one_of_everything(engine)

    backup_path = DataBackupManager(str(tmp_path)).create_backup("full")

    file_text = Path(backup_path).read_text(encoding="utf-8")
    assert not NOT_BACKED_UP & set(json.loads(file_text))
    with Session(engine) as session:
        token = session.exec(select(AgentToken)).one()
        subscription = session.exec(select(PushSubscription)).one()
        settings = session.exec(select(UserSettings)).one()
    assert settings.openai_api_key_encrypted
    for secret in (
        token.token_hash,
        subscription.p256dh_key,
        subscription.endpoint,
        settings.openai_api_key_encrypted,
    ):
        assert secret not in file_text


def test_a_restore_keeps_the_credentials_the_database_holds_now(
    engine: Engine, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    user_id = add_one_of_everything(engine)
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")

    # Since the backup: the token is replaced by a new one, the key by a new
    # key, and a user the backup does not have arrives with credentials.
    change_the_data(engine, user_id)
    with Session(engine) as session:
        session.delete(
            session.exec(select(AgentToken).where(AgentToken.user_id == user_id)).one()
        )
        session.flush()
        new_token = add_credentials(session, user_id)
        settings = session.exec(select(UserSettings)).one()
        settings.openai_api_key_encrypted = "encrypted-new-key"
        new_token_id = new_token.id
        session.commit()
    credentials = all_rows_of(engine, NOT_BACKED_UP)

    with caplog.at_level(logging.WARNING, logger=safe_migration.logger.name):
        manager.restore_backup(backup_path)

    after = all_rows(engine)
    # The user's credentials are the ones they had when the restore started.
    assert after["agent_tokens"] == [
        row for row in credentials["agent_tokens"] if row["user_id"] == user_id
    ]
    assert [row["id"] for row in after["agent_tokens"]] == [new_token_id]
    assert after["push_subscriptions"] == [
        row for row in credentials["push_subscriptions"] if row["user_id"] == user_id
    ]
    assert len(after["push_subscriptions"]) == 2
    (restored_settings,) = after["user_settings"]
    assert restored_settings["openai_api_key_encrypted"] == "encrypted-new-key"
    assert restored_settings["ai_features_enabled"] is True
    assert restored_settings["week_start_day"] == "monday"
    # The proposal came through the token that is gone: it is kept, unlinked.
    (proposal,) = after["agent_proposals"]
    assert (proposal["token_id"], proposal["agent_name"]) == (None, "Agent")
    # The newcomer is not in the backup, and their credentials go with them.
    assert "agent_tokens (1 rows)" in caplog.text
    assert "push_subscriptions (1 rows)" in caplog.text


def test_a_key_in_an_older_backup_file_is_not_restored(engine: Engine, tmp_path: Path):
    add_one_of_everything(engine)
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")
    # A backup made before keys were left out: the file holds the key.
    backup = json.loads(Path(backup_path).read_text(encoding="utf-8"))
    (settings_record,) = backup["user_settings"]
    settings_record["openai_api_key_encrypted"] = "encrypted-old-key"
    settings_record["ai_features_enabled"] = True
    Path(backup_path).write_text(json.dumps(backup), encoding="utf-8")
    # Since then the user deleted their key.
    with Session(engine) as session:
        settings = session.exec(select(UserSettings)).one()
        settings.openai_api_key_encrypted = None
        settings.ai_features_enabled = False
        session.commit()

    manager.restore_backup(backup_path)

    (restored_settings,) = all_rows(engine)["user_settings"]
    assert restored_settings["openai_api_key_encrypted"] is None
    assert restored_settings["ai_features_enabled"] is False
    assert restored_settings["week_start_day"] == "monday"


def test_every_table_is_backed_up_or_left_out_on_purpose():
    """A new table must be added to the backup, or named here as left out."""
    tables = {table.name for table in SQLModel.metadata.sorted_tables}
    assert tables == BACKED_UP | NOT_BACKED_UP


def test_every_restored_reference_is_to_a_restored_table():
    """A row that names a table the restore leaves empty cannot be inserted."""
    for table, model in FULL_BACKUP_MODELS.items():
        for key in model.__table__.foreign_keys:  # type: ignore[attr-defined]
            assert (
                key.column.table.name in FULL_BACKUP_MODELS
                or AGENT_TOKEN_LINKS.get(table) == key.parent.name
            ), f"{table}.{key.parent.name}"


def test_a_table_the_database_does_not_have_yet_does_not_stop_a_restore(
    engine: Engine, tmp_path: Path
):
    # A model whose migration is not applied yet: the database has no such
    # table. Here it is one a backup does not carry.
    add_one_of_everything(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE push_subscriptions"))
    before = all_rows_of(engine, BACKED_UP)
    manager = DataBackupManager(str(tmp_path))
    backup_path = manager.create_backup("full")

    manager.restore_backup(backup_path)

    assert all_rows_of(engine, BACKED_UP) == before


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

    # Nothing is revoked: the credentials are the database's own.
    assert all_rows(engine) == before
