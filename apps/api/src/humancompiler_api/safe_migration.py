"""
Safe Database Migration Strategy for TaskAgent

This module provides tools and guidelines for safely migrating database schema
without losing existing data, preventing the data loss incident that occurred
during the work_type feature implementation.
"""

import logging
from datetime import datetime, UTC
from functools import cache
from typing import Any, TypeVar
from collections.abc import Callable
from pathlib import Path
import json

from pydantic import TypeAdapter
from sqlmodel import Session, SQLModel, select, text
from sqlalchemy import Table, func, inspect

from humancompiler_api.database import db
from humancompiler_api.models import (
    AgentAuditLog,
    AgentChange,
    AgentProposal,
    ContextNote,
    DailyPlanDocument,
    EmailNotificationLog,
    RescheduleDecision,
    RescheduleSuggestion,
    User,
    Project,
    Goal,
    Task,
    Schedule,
    QuickTask,
    Log,
    UserSettings,
    GoalDependency,
    TaskDependency,
    TriageCapacitySettings,
    TaskTriageRun,
    TaskTriageItem,
    WeeklyNote,
    WeeklyRhythmBlock,
    WorkSession,
)

from humancompiler_api.note_text import (
    former_task_text_html,
    note_plain_text,
    plain_text_to_note_html,
)

logger = logging.getLogger(__name__)

RowT = TypeVar("RowT", bound=SQLModel)


@cache
def _column_readers(model: type[SQLModel]) -> dict[str, TypeAdapter[Any]]:
    return {
        name: TypeAdapter(field.annotation)
        for name, field in model.model_fields.items()
    }


def backup_row(model: type[RowT], data: dict[str, Any]) -> RowT:
    """A table row from a backup's record.

    A backup is JSON: timestamps, dates, decimals and UUIDs are text in it, and
    a table model takes what it is given without converting it, which the
    database then refuses. Each value is read back as its column's type; keys
    the model no longer has (a column since dropped) are left out."""
    readers = _column_readers(model)
    return model(
        **{
            name: readers[name].validate_python(value)
            for name, value in data.items()
            if name in readers
        }
    )


def notes_with_former_task_text(backup_data: dict[str, Any]) -> list[dict[str, Any]]:
    """The backup's notes, with each task's former description and memo on top.

    A backup made before tasks lost those two fields carries them in its task
    rows and has no notes. Restoring it must not drop that text, so it goes to
    the top of the task's note, the way migration 044 copies it (a Markdown
    note becomes HTML paragraphs of the same text); a task without a note gets
    one owned by its project's owner. Notes of newer backups pass
    through unchanged. The IDs are the backup's own."""
    notes = [dict(note) for note in backup_data.get("context_notes", [])]
    note_by_task = {
        str(note["task_id"]): note for note in notes if note.get("task_id") is not None
    }
    project_by_goal = {
        str(goal["id"]): str(goal["project_id"])
        for goal in backup_data.get("goals", [])
    }
    owner_by_project = {
        str(project["id"]): project["owner_id"]
        for project in backup_data.get("projects", [])
    }
    for task in backup_data.get("tasks", []):
        block = former_task_text_html(task.get("description"), task.get("memo"))
        if not block:
            continue
        task_id = str(task["id"])
        note = note_by_task.get(task_id)
        if note is None:
            owner_id = owner_by_project.get(
                project_by_goal.get(str(task["goal_id"]), "")
            )
            if owner_id is None:
                continue
            note = {"user_id": owner_id, "task_id": task["id"], "content": ""}
            note_by_task[task_id] = note
            notes.append(note)
        existing = note.get("content") or ""
        if note.get("content_type") != "html":
            # A Markdown note's text is kept as it reads, not parsed as tags.
            existing = plain_text_to_note_html(existing)
        note["content"] = block + existing
        note["content_type"] = "html"
        # With the text already current, restoring the note leaves its task's
        # updated_at as the backup has it.
        note["content_text"] = note_plain_text(note["content"], "html")
    return notes


# The tables of a full backup by name, which is also each one's key in the
# file. Each comes after the ones it references: the order their rows can be
# inserted in.
#
# Left out on purpose: agent tokens and push subscriptions. They are
# credentials, not work: a token is issued again and a browser subscribes
# again, and a backup file should not hold them. For the same reason user
# settings are written without the OpenAI API key (see ``backup_record``). A
# restore keeps the credentials the database holds (see ``restore_backup``).
FULL_BACKUP_MODELS: dict[str, type[SQLModel]] = {
    "users": User,
    "projects": Project,
    "goals": Goal,
    "tasks": Task,
    "context_notes": ContextNote,
    "quick_tasks": QuickTask,
    "schedules": Schedule,
    "work_sessions": WorkSession,
    "logs": Log,
    "user_settings": UserSettings,
    "triage_capacity_settings": TriageCapacitySettings,
    "task_triage_runs": TaskTriageRun,
    "task_triage_items": TaskTriageItem,
    "goal_dependencies": GoalDependency,
    "task_dependencies": TaskDependency,
    "daily_plan_documents": DailyPlanDocument,
    "weekly_notes": WeeklyNote,
    "weekly_rhythm_blocks": WeeklyRhythmBlock,
    "agent_proposals": AgentProposal,
    "agent_changes": AgentChange,
    "agent_audit_logs": AgentAuditLog,
    "email_notification_logs": EmailNotificationLog,
    "reschedule_suggestions": RescheduleSuggestion,
    "reschedule_decisions": RescheduleDecision,
}

# The column of each table that names the agent token a row came through. A
# backup has no tokens, so a link whose token the database no longer holds
# comes back empty, as deleting a token leaves it (ON DELETE SET NULL); the
# row keeps the agent's name or the token's prefix.
AGENT_TOKEN_LINKS = {
    "agent_proposals": "token_id",
    "agent_changes": "agent_token_id",
    "agent_audit_logs": "token_id",
}

# The tables of credentials a backup leaves out. Each row is one user's.
CREDENTIAL_TABLES = ("agent_tokens", "push_subscriptions")


def backup_record(row: SQLModel) -> dict[str, Any]:
    """A row as a backup file holds it.

    User settings go without the OpenAI API key: it is a credential the user
    enters again, and a backup file should not hold it, encrypted or not. AI
    features are off without a key, as deleting the key in the app leaves them.
    """
    record = row.model_dump()
    if isinstance(row, UserSettings):
        record["openai_api_key_encrypted"] = None
        record["ai_features_enabled"] = False
    return record


# What a full restore truncates by name; CASCADE reaches the rest from these.
_TRUNCATED_TABLES = ("tasks", "goals", "projects", "users")


def _tables_emptied_without_restore() -> list[Table]:
    """The tables a full restore empties and a full backup does not carry."""
    emptied = set(_TRUNCATED_TABLES)
    # Parents come first in sorted_tables, so one pass follows every chain.
    for table in SQLModel.metadata.sorted_tables:
        if any(key.column.table.name in emptied for key in table.foreign_keys):
            emptied.add(table.name)
    return [
        table
        for table in SQLModel.metadata.sorted_tables
        if table.name in emptied and table.name not in FULL_BACKUP_MODELS
    ]


class SafeMigrationError(Exception):
    """Exception raised during safe migration operations"""

    pass


class DataBackupManager:
    """Manages database backups before schema changes"""

    def __init__(self, backup_dir: str = "backups"):
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(exist_ok=True)

    def create_backup(self, backup_name: str | None = None) -> str:
        """Write every table of ``FULL_BACKUP_MODELS`` to a JSON file.

        Agent tokens, push subscriptions and the OpenAI API key in user
        settings are not written."""
        if not backup_name:
            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
            backup_name = f"backup_{timestamp}"

        backup_path = self.backup_dir / f"{backup_name}.json"

        try:
            engine = db.get_engine()
            backup_data: dict[str, Any] = {}

            with Session(engine) as session:
                for table, model in FULL_BACKUP_MODELS.items():
                    backup_data[table] = [
                        backup_record(row) for row in session.exec(select(model)).all()
                    ]

            total_records = {table: len(rows) for table, rows in backup_data.items()}
            backup_data["metadata"] = {
                "created_at": datetime.now(UTC).isoformat(),
                "version": "2.0",
                "total_records": total_records,
            }

            # Write backup file
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(backup_data, f, indent=2, default=str, ensure_ascii=False)

            logger.info(f"✅ Backup created: {backup_path}")
            logger.info(f"   Records: {total_records}")

            return str(backup_path)

        except Exception as e:
            logger.error(f"❌ Failed to create backup: {e}")
            raise SafeMigrationError(f"Backup creation failed: {e}")

    def restore_backup(self, backup_path: str) -> None:
        """Replace the database's data with a full backup's. PostgreSQL only.

        Every table ``create_backup`` writes (``FULL_BACKUP_MODELS``) comes back
        as the backup has it, IDs included. A backup made before a table was
        part of it leaves that table empty, and one made before notes or
        Runner sessions were is read as ``restore_user_data`` reads one.

        The delete and the inserts are one transaction: a restore that fails
        leaves the database as it was.

        Credentials are not in a backup, so the ones the database holds when
        the restore starts are kept, for every user the backup brings back:
        agent tokens, push subscriptions and the OpenAI API key (with whether
        AI features are on). Rolling back a failed migration therefore revokes
        nothing. They are read and written back inside the transaction and
        never reach a file.

        NOT restored: credentials the database does not hold. On an empty
        database, or for a user it no longer has, agents need new tokens,
        browsers subscribe again and the user enters the OpenAI API key again
        (AI features are off until then); proposals, changes and audit logs
        come back without the link to a token that is gone. The delete is
        ``TRUNCATE ... CASCADE`` from users, which empties every table that
        refers to users: rows it removes that are not put back are counted in
        a warning.
        """
        backup_file = Path(backup_path)
        if not backup_file.exists():
            raise SafeMigrationError(f"Backup file not found: {backup_path}")

        try:
            with open(backup_file, encoding="utf-8") as f:
                backup_data = json.load(f)

            missing = [table for table in _TRUNCATED_TABLES if table not in backup_data]
            if missing:
                # Not a full backup: stop before anything is deleted.
                raise SafeMigrationError(f"Backup has no {', '.join(missing)}")

            records: dict[str, list[dict[str, Any]]] = {
                table: backup_data.get(table, []) for table in FULL_BACKUP_MODELS
            }
            # Notes carry the text older backups kept on tasks.
            records["context_notes"] = notes_with_former_task_text(backup_data)
            # A log keeps its time when its session is not in the backup (an
            # older backup has none); a dangling link would fail.
            session_ids = {str(row["id"]) for row in records["work_sessions"]}
            records["logs"] = [
                log
                if str(log.get("work_session_id")) in session_ids
                else {**log, "work_session_id": None}
                for log in records["logs"]
            ]
            user_ids = {str(user["id"]) for user in records["users"]}

            engine = db.get_engine()

            with Session(engine) as session:
                connection = session.connection()
                # A model can be ahead of the database (note_attachments has
                # no table yet): only what exists holds rows.
                existing = set(inspect(connection).get_table_names())

                # A backup has no credentials. Those in the database stay, for
                # the users the backup brings back: read now, written back
                # below, in this transaction only.
                credentials = {
                    name: [
                        dict(row)
                        for row in connection.execute(
                            SQLModel.metadata.tables[name].select()
                        ).mappings()
                        if str(row["user_id"]) in user_ids
                    ]
                    for name in CREDENTIAL_TABLES
                    if name in existing
                }
                api_keys = {
                    str(user_id): (api_key, ai_features_enabled)
                    for user_id, api_key, ai_features_enabled in session.exec(
                        select(
                            UserSettings.user_id,
                            UserSettings.openai_api_key_encrypted,
                            UserSettings.ai_features_enabled,
                        )
                    )
                    if api_key
                }
                records["user_settings"] = [
                    {
                        **settings,
                        "openai_api_key_encrypted": api_keys[str(settings["user_id"])][
                            0
                        ],
                        "ai_features_enabled": api_keys[str(settings["user_id"])][1],
                    }
                    if not settings.get("openai_api_key_encrypted")
                    and str(settings["user_id"]) in api_keys
                    else settings
                    for settings in records["user_settings"]
                ]
                token_ids = {
                    str(token["id"]) for token in credentials.get("agent_tokens", [])
                }
                for table, column in AGENT_TOKEN_LINKS.items():
                    records[table] = [
                        row
                        if str(row.get(column)) in token_ids
                        else {**row, column: None}
                        for row in records[table]
                    ]

                # Read before anything is deleted: a record that cannot be
                # read ends the restore here.
                rows = {
                    table: [backup_row(model, record) for record in records[table]]
                    for table, model in FULL_BACKUP_MODELS.items()
                }

                # What the delete removes and nothing puts back.
                lost = {
                    table.name: session.exec(
                        select(func.count()).select_from(table)
                    ).one()
                    - len(credentials.get(table.name, []))
                    for table in _tables_emptied_without_restore()
                    if table.name in existing
                }

                # No commit until every row is back: this delete is undone
                # with the rest if an insert fails.
                session.exec(text(f"TRUNCATE {', '.join(_TRUNCATED_TABLES)} CASCADE"))

                # Few of these tables have an ORM relationship to the rows
                # they reference, so each is inserted before the next.
                for table in FULL_BACKUP_MODELS:
                    session.add_all(rows[table])
                    session.flush()
                    if table == "users":
                        # Next, so that what names a token finds it.
                        for name, kept in credentials.items():
                            if kept:
                                connection.execute(
                                    SQLModel.metadata.tables[name].insert(), kept
                                )

                session.commit()

            metadata = backup_data.get("metadata", {})
            logger.info(f"✅ Backup restored from: {backup_path}")
            logger.info(f"   Backup created: {metadata.get('created_at')}")
            restored = {table: len(found) for table, found in records.items()}
            logger.info(f"   Records restored: {restored}")
            lost_rows = [
                f"{table} ({count} rows)" for table, count in lost.items() if count
            ]
            if lost_rows:
                logger.warning(
                    "⚠️  Not in the backup, lost in the restore: " + ", ".join(lost_rows)
                )

        except Exception as e:
            logger.error(f"❌ Failed to restore backup: {e}")
            raise SafeMigrationError(f"Backup restoration failed: {e}")

    def create_user_backup(self, user_id: str, backup_name: str | None = None) -> str:
        """Create a backup of all data for a specific user.

        User settings are written without the OpenAI API key."""
        if not backup_name:
            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
            backup_name = f"user_{user_id}_backup_{timestamp}"

        backup_path = self.backup_dir / f"{backup_name}.json"

        try:
            engine = db.get_engine()
            backup_data = {}

            with Session(engine) as session:
                # Backup user data
                user = session.exec(select(User).where(User.id == user_id)).first()
                if not user:
                    raise SafeMigrationError(f"User not found: {user_id}")
                backup_data["users"] = [user.model_dump()]

                # Backup user's projects
                projects = session.exec(
                    select(Project).where(Project.owner_id == user_id)
                ).all()
                backup_data["projects"] = [project.model_dump() for project in projects]

                # Get project IDs for related data
                project_ids = [p.id for p in projects]

                # Backup goals related to user's projects
                goals = []
                if project_ids:
                    goals = session.exec(
                        select(Goal).where(Goal.project_id.in_(project_ids))
                    ).all()
                backup_data["goals"] = [goal.model_dump() for goal in goals]

                # Get goal IDs for related data
                goal_ids = [g.id for g in goals]

                # Backup tasks related to user's goals
                tasks = []
                if goal_ids:
                    tasks = session.exec(
                        select(Task).where(Task.goal_id.in_(goal_ids))
                    ).all()
                backup_data["tasks"] = [task.model_dump() for task in tasks]

                # Get task IDs for related data
                task_ids = [t.id for t in tasks]

                # Backup the user's notes: a task's note is its body
                notes = session.exec(
                    select(ContextNote).where(ContextNote.user_id == user_id)
                ).all()
                backup_data["context_notes"] = [note.model_dump() for note in notes]

                # Backup user's quick tasks
                quick_tasks = session.exec(
                    select(QuickTask).where(QuickTask.owner_id == user_id)
                ).all()
                backup_data["quick_tasks"] = [
                    quick_task.model_dump() for quick_task in quick_tasks
                ]

                # Backup user's schedules
                schedules = session.exec(
                    select(Schedule).where(Schedule.user_id == user_id)
                ).all()
                backup_data["schedules"] = [
                    schedule.model_dump() for schedule in schedules
                ]

                # Backup the user's Runner sessions: the reflection on a
                # piece of work, which its log refers to
                work_sessions = session.exec(
                    select(WorkSession).where(WorkSession.user_id == user_id)
                ).all()
                backup_data["work_sessions"] = [
                    work_session.model_dump() for work_session in work_sessions
                ]

                # Backup logs for user's tasks
                logs = []
                if task_ids:
                    logs = session.exec(
                        select(Log).where(Log.task_id.in_(task_ids))
                    ).all()
                backup_data["logs"] = [log.model_dump() for log in logs]

                # Backup user settings
                user_settings = session.exec(
                    select(UserSettings).where(UserSettings.user_id == user_id)
                ).all()
                backup_data["user_settings"] = [
                    backup_record(us) for us in user_settings
                ]

                # Backup user's capacity triage data
                triage_settings = session.exec(
                    select(TriageCapacitySettings).where(
                        TriageCapacitySettings.user_id == user_id
                    )
                ).all()
                backup_data["triage_capacity_settings"] = [
                    row.model_dump() for row in triage_settings
                ]
                triage_runs = session.exec(
                    select(TaskTriageRun).where(TaskTriageRun.user_id == user_id)
                ).all()
                backup_data["task_triage_runs"] = [
                    row.model_dump() for row in triage_runs
                ]
                triage_run_ids = [row.id for row in triage_runs]
                triage_items = []
                if triage_run_ids:
                    triage_items = session.exec(
                        select(TaskTriageItem).where(
                            TaskTriageItem.run_id.in_(triage_run_ids)
                        )
                    ).all()
                backup_data["task_triage_items"] = [
                    row.model_dump() for row in triage_items
                ]

                # Backup user's API usage logs

                # Backup goal dependencies for user's goals
                goal_dependencies = []
                if goal_ids:
                    goal_dependencies = session.exec(
                        select(GoalDependency).where(
                            (GoalDependency.goal_id.in_(goal_ids))
                            | (GoalDependency.depends_on_goal_id.in_(goal_ids))
                        )
                    ).all()
                backup_data["goal_dependencies"] = [
                    gd.model_dump() for gd in goal_dependencies
                ]

                # Backup task dependencies for user's tasks
                task_dependencies = []
                if task_ids:
                    task_dependencies = session.exec(
                        select(TaskDependency).where(
                            (TaskDependency.task_id.in_(task_ids))
                            | (TaskDependency.depends_on_task_id.in_(task_ids))
                        )
                    ).all()
                backup_data["task_dependencies"] = [
                    td.model_dump() for td in task_dependencies
                ]

                # Add metadata
                backup_data["metadata"] = {
                    "created_at": datetime.now(UTC).isoformat(),
                    "version": "2.0",
                    "backup_type": "user_specific",
                    "user_id": user_id,
                    "total_records": {
                        "users": len(backup_data["users"]),
                        "projects": len(backup_data["projects"]),
                        "goals": len(backup_data["goals"]),
                        "tasks": len(backup_data["tasks"]),
                        "context_notes": len(backup_data["context_notes"]),
                        "quick_tasks": len(backup_data["quick_tasks"]),
                        "schedules": len(backup_data["schedules"]),
                        "work_sessions": len(backup_data["work_sessions"]),
                        "logs": len(backup_data["logs"]),
                        "user_settings": len(backup_data["user_settings"]),
                        "triage_capacity_settings": len(
                            backup_data["triage_capacity_settings"]
                        ),
                        "task_triage_runs": len(backup_data["task_triage_runs"]),
                        "task_triage_items": len(backup_data["task_triage_items"]),
                        "goal_dependencies": len(backup_data["goal_dependencies"]),
                        "task_dependencies": len(backup_data["task_dependencies"]),
                    },
                }

            # Write backup file
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(backup_data, f, indent=2, default=str, ensure_ascii=False)

            logger.info(f"✅ User backup created: {backup_path}")
            logger.info(f"   User ID: {user_id}")
            logger.info(f"   Projects: {len(backup_data['projects'])}")
            logger.info(f"   Goals: {len(backup_data['goals'])}")
            logger.info(f"   Tasks: {len(backup_data['tasks'])}")

            return str(backup_path)

        except Exception as e:
            logger.error(f"❌ Failed to create user backup: {e}")
            raise SafeMigrationError(f"User backup creation failed: {e}")

    def restore_user_data(self, backup_path: str, target_user_id: str) -> None:
        """Restore user data from a backup file, merging with existing data"""
        backup_file = Path(backup_path)
        if not backup_file.exists():
            raise SafeMigrationError(f"Backup file not found: {backup_path}")

        try:
            import uuid

            with open(backup_file, encoding="utf-8") as f:
                backup_data = json.load(f)

            # Validate backup data structure
            metadata = backup_data.get("metadata", {})
            if metadata.get("backup_type") != "user_specific":
                raise SafeMigrationError(
                    "This backup file is not a user-specific backup"
                )

            # Read before the loops below replace the backup's IDs in place.
            notes = notes_with_former_task_text(backup_data)

            engine = db.get_engine()

            with Session(engine) as session:
                # Maps to track ID conversions
                project_id_map = {}
                goal_id_map = {}
                task_id_map = {}
                quick_task_id_map = {}
                triage_run_id_map = {}
                work_session_id_map = {}

                # Import projects with new IDs
                for project_data in backup_data.get("projects", []):
                    old_project_id = project_data["id"]
                    new_project_id = str(uuid.uuid4())
                    project_id_map[old_project_id] = new_project_id

                    project_data["id"] = new_project_id
                    project_data["owner_id"] = target_user_id

                    project = backup_row(Project, project_data)
                    session.add(project)

                # Import goals with new IDs and updated project references
                for goal_data in backup_data.get("goals", []):
                    old_goal_id = goal_data["id"]
                    new_goal_id = str(uuid.uuid4())
                    goal_id_map[old_goal_id] = new_goal_id

                    goal_data["id"] = new_goal_id
                    goal_data["project_id"] = project_id_map.get(
                        goal_data["project_id"]
                    )

                    if goal_data["project_id"]:  # Only add if project exists
                        goal = backup_row(Goal, goal_data)
                        session.add(goal)

                # Import tasks with new IDs and updated goal references
                for task_data in backup_data.get("tasks", []):
                    old_task_id = task_data["id"]
                    new_task_id = str(uuid.uuid4())
                    task_id_map[old_task_id] = new_task_id

                    task_data["id"] = new_task_id
                    task_data["goal_id"] = goal_id_map.get(task_data["goal_id"])

                    if task_data["goal_id"]:  # Only add if goal exists
                        task = backup_row(Task, task_data)
                        session.add(task)

                # Import notes with new IDs and updated references. Notes have
                # no ORM relationship to what they are on, so the projects,
                # goals and tasks they reference must be inserted first.
                session.flush()
                id_maps = {
                    "project_id": project_id_map,
                    "goal_id": goal_id_map,
                    "task_id": task_id_map,
                }
                for note_data in notes:
                    for column, id_map in id_maps.items():
                        if note_data.get(column) is not None:
                            note_data[column] = id_map.get(str(note_data[column]))
                    if not any(note_data.get(column) for column in id_maps):
                        continue  # its project, goal or task was not imported
                    note_data["id"] = str(uuid.uuid4())
                    note_data["user_id"] = target_user_id
                    session.add(backup_row(ContextNote, note_data))

                # Import quick tasks with new IDs and updated user reference
                for quick_task_data in backup_data.get("quick_tasks", []):
                    old_quick_task_id = quick_task_data["id"]
                    new_quick_task_id = str(uuid.uuid4())
                    quick_task_id_map[old_quick_task_id] = new_quick_task_id

                    quick_task_data["id"] = new_quick_task_id
                    quick_task_data["owner_id"] = target_user_id

                    quick_task = backup_row(QuickTask, quick_task_data)
                    session.add(quick_task)

                # Import schedules with new IDs and updated user reference
                for schedule_data in backup_data.get("schedules", []):
                    schedule_data["id"] = str(uuid.uuid4())
                    schedule_data["user_id"] = target_user_id

                    schedule = backup_row(Schedule, schedule_data)
                    session.add(schedule)

                # Import Runner sessions with new IDs and updated references.
                # Only ended ones: a session that was running when the backup
                # was made is not running now, and a user has one at a time.
                for work_session_data in backup_data.get("work_sessions", []):
                    old_work_session_id = work_session_data["id"]
                    work_session_data["task_id"] = task_id_map.get(
                        work_session_data["task_id"]
                    )
                    if not work_session_data["task_id"]:
                        continue  # its task was not imported
                    if not work_session_data.get("ended_at"):
                        continue
                    new_work_session_id = str(uuid.uuid4())
                    work_session_id_map[old_work_session_id] = new_work_session_id

                    work_session_data["id"] = new_work_session_id
                    work_session_data["user_id"] = target_user_id
                    session.add(backup_row(WorkSession, work_session_data))

                # Logs have no ORM relationship to the session they were
                # measured in, so the sessions must be inserted first.
                session.flush()

                # Import logs with new IDs and updated task references
                for log_data in backup_data.get("logs", []):
                    log_data["id"] = str(uuid.uuid4())
                    log_data["task_id"] = task_id_map.get(log_data["task_id"])
                    # A log keeps its time when its session is not imported (an
                    # older backup has none); a dangling link would fail.
                    old_work_session_id = log_data.get("work_session_id")
                    log_data["work_session_id"] = (
                        work_session_id_map.get(str(old_work_session_id))
                        if old_work_session_id
                        else None
                    )

                    if log_data["task_id"]:  # Only add if task exists
                        log = backup_row(Log, log_data)
                        session.add(log)

                # Import user settings (skip if already exists)
                for us_data in backup_data.get("user_settings", []):
                    us_data["id"] = str(uuid.uuid4())
                    us_data["user_id"] = target_user_id

                    # Check if user settings already exist
                    existing_us = session.exec(
                        select(UserSettings).where(
                            UserSettings.user_id == target_user_id
                        )
                    ).first()

                    if not existing_us:
                        user_settings = backup_row(UserSettings, us_data)
                        session.add(user_settings)

                # Import triage capacity settings (skip if already exists)
                for triage_settings_data in backup_data.get(
                    "triage_capacity_settings", []
                ):
                    triage_settings_data["id"] = str(uuid.uuid4())
                    triage_settings_data["user_id"] = target_user_id

                    existing_triage_settings = session.exec(
                        select(TriageCapacitySettings).where(
                            TriageCapacitySettings.user_id == target_user_id
                        )
                    ).first()
                    if not existing_triage_settings:
                        triage_settings = backup_row(
                            TriageCapacitySettings, triage_settings_data
                        )
                        session.add(triage_settings)

                # Import triage runs and items with updated references
                for run_data in backup_data.get("task_triage_runs", []):
                    old_run_id = run_data["id"]
                    new_run_id = str(uuid.uuid4())
                    triage_run_id_map[old_run_id] = new_run_id
                    run_data["id"] = new_run_id
                    run_data["user_id"] = target_user_id
                    triage_run = backup_row(TaskTriageRun, run_data)
                    session.add(triage_run)

                for item_data in backup_data.get("task_triage_items", []):
                    item_data["id"] = str(uuid.uuid4())
                    item_data["run_id"] = triage_run_id_map.get(item_data["run_id"])
                    if not item_data["run_id"]:
                        continue

                    if item_data.get("task_id"):
                        item_data["task_id"] = task_id_map.get(item_data["task_id"])
                    if item_data.get("quick_task_id"):
                        item_data["quick_task_id"] = quick_task_id_map.get(
                            item_data["quick_task_id"]
                        )

                    if item_data.get("item_type") == "task" and not item_data.get(
                        "task_id"
                    ):
                        continue
                    if item_data.get("item_type") == "quick_task" and not item_data.get(
                        "quick_task_id"
                    ):
                        continue

                    if item_data.get("project_id"):
                        item_data["project_id"] = project_id_map.get(
                            item_data["project_id"]
                        )
                    if item_data.get("goal_id"):
                        item_data["goal_id"] = goal_id_map.get(item_data["goal_id"])

                    triage_item = backup_row(TaskTriageItem, item_data)
                    session.add(triage_item)

                # Import goal dependencies with updated references
                for gd_data in backup_data.get("goal_dependencies", []):
                    gd_data["id"] = str(uuid.uuid4())
                    gd_data["goal_id"] = goal_id_map.get(gd_data["goal_id"])
                    gd_data["depends_on_goal_id"] = goal_id_map.get(
                        gd_data["depends_on_goal_id"]
                    )

                    if gd_data["goal_id"] and gd_data["depends_on_goal_id"]:
                        goal_dependency = backup_row(GoalDependency, gd_data)
                        session.add(goal_dependency)

                # Import task dependencies with updated references
                for td_data in backup_data.get("task_dependencies", []):
                    td_data["id"] = str(uuid.uuid4())
                    td_data["task_id"] = task_id_map.get(td_data["task_id"])
                    td_data["depends_on_task_id"] = task_id_map.get(
                        td_data["depends_on_task_id"]
                    )

                    if td_data["task_id"] and td_data["depends_on_task_id"]:
                        task_dependency = backup_row(TaskDependency, td_data)
                        session.add(task_dependency)

                session.commit()

            logger.info(f"✅ User data restored from: {backup_path}")
            logger.info(f"   Target user: {target_user_id}")
            logger.info(f"   Projects imported: {len(project_id_map)}")
            logger.info(f"   Goals imported: {len(goal_id_map)}")
            logger.info(f"   Tasks imported: {len(task_id_map)}")

        except Exception as e:
            logger.error(f"❌ Failed to restore user data: {e}")
            raise SafeMigrationError(f"User data restoration failed: {e}")


class SchemaValidator:
    """Validates database schema changes before applying"""

    def __init__(self):
        self.engine = db.get_engine()

    def validate_schema_changes(self, new_models: list[type]) -> dict[str, Any]:
        """Validate that schema changes are safe"""
        inspector = inspect(self.engine)
        existing_tables = inspector.get_table_names()

        validation_results = {
            "safe": True,
            "warnings": [],
            "errors": [],
            "recommendations": [],
        }

        # Check for table drops
        model_tables = {
            model.__tablename__
            for model in new_models
            if hasattr(model, "__tablename__")
        }
        dropped_tables = set(existing_tables) - model_tables

        if dropped_tables:
            validation_results["errors"].append(
                f"Tables will be dropped: {dropped_tables}. This may cause data loss!"
            )
            validation_results["safe"] = False

        # Check for column changes in existing tables
        for model in new_models:
            if not hasattr(model, "__tablename__"):
                continue

            table_name = model.__tablename__
            if table_name in existing_tables:
                existing_columns = {
                    col["name"] for col in inspector.get_columns(table_name)
                }
                model_columns = set(model.model_fields.keys())

                removed_columns = existing_columns - model_columns
                if removed_columns:
                    validation_results["warnings"].append(
                        f"Columns may be removed from {table_name}: {removed_columns}"
                    )

        return validation_results


class SafeMigrationManager:
    """Manages safe database migrations with automatic backups"""

    def __init__(self):
        self.backup_manager = DataBackupManager()
        self.schema_validator = SchemaValidator()

    def execute_safe_migration(
        self,
        migration_name: str,
        pre_migration_callback: Callable | None = None,
        post_migration_callback: Callable | None = None,
        force: bool = False,
    ) -> str:
        """Execute a migration with automatic backup and rollback capability"""

        logger.info(f"🚀 Starting safe migration: {migration_name}")

        try:
            # Step 1: Create backup
            backup_path = self.backup_manager.create_backup(f"pre_{migration_name}")
            logger.info(f"📦 Backup created: {backup_path}")

            # Step 2: Validate schema changes (if validator provided)
            if hasattr(self, "new_models"):
                validation = self.schema_validator.validate_schema_changes(
                    self.new_models
                )

                if not validation["safe"] and not force:
                    logger.error("❌ Migration validation failed:")
                    for error in validation["errors"]:
                        logger.error(f"   - {error}")
                    raise SafeMigrationError(
                        "Migration aborted due to validation errors"
                    )

                for warning in validation["warnings"]:
                    logger.warning(f"⚠️  {warning}")

            # Step 3: Execute pre-migration callback
            if pre_migration_callback:
                logger.info("🔄 Executing pre-migration callback...")
                pre_migration_callback()

            # Step 4: Apply migration (this should be implemented by subclasses)
            logger.info("🔧 Applying migration...")
            self._apply_migration()

            # Step 5: Execute post-migration callback
            if post_migration_callback:
                logger.info("🔄 Executing post-migration callback...")
                post_migration_callback()

            logger.info(f"✅ Migration completed successfully: {migration_name}")
            return backup_path

        except Exception as e:
            logger.error(f"❌ Migration failed: {e}")
            logger.info("🔄 Rolling back changes...")

            try:
                # Attempt rollback using backup
                self.backup_manager.restore_backup(backup_path)
                logger.info("✅ Rollback completed successfully")
            except Exception as rollback_error:
                logger.error(f"❌ Rollback failed: {rollback_error}")
                logger.error(
                    "🚨 CRITICAL: Manual database restoration may be required!"
                )

            raise SafeMigrationError(f"Migration failed: {e}")

    def _apply_migration(self):
        """Override this method in subclasses to implement specific migrations"""
        raise NotImplementedError("Subclasses must implement _apply_migration method")


# Example usage for adding new columns safely
class AddColumnMigration(SafeMigrationManager):
    """Example migration for adding new columns"""

    def __init__(self, table_name: str, column_definition: str):
        super().__init__()
        self.table_name = table_name
        self.column_definition = column_definition

    def _apply_migration(self):
        """Add column to existing table"""
        engine = db.get_engine()

        with engine.connect() as conn:
            # Add column with default value to prevent NULL constraint issues
            sql = text(
                f"ALTER TABLE {self.table_name} ADD COLUMN {self.column_definition}"
            )
            conn.execute(sql)
            conn.commit()

        logger.info(f"✅ Added column to {self.table_name}: {self.column_definition}")


# Example usage for enum modifications
class EnumMigration(SafeMigrationManager):
    """Example migration for modifying enum types"""

    def __init__(self, enum_name: str, old_values: list[str], new_values: list[str]):
        super().__init__()
        self.enum_name = enum_name
        self.old_values = old_values
        self.new_values = new_values

    def _apply_migration(self):
        """Safely modify enum type"""
        engine = db.get_engine()

        with engine.connect() as conn:
            # Add new enum values first
            for value in set(self.new_values) - set(self.old_values):
                sql = text(f"ALTER TYPE {self.enum_name} ADD VALUE '{value}'")
                conn.execute(sql)

            conn.commit()

        logger.info(f"✅ Updated enum {self.enum_name}: {self.new_values}")
