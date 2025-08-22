"""
Safe Database Migration Strategy for TaskAgent

This module provides tools and guidelines for safely migrating database schema
without losing existing data, preventing the data loss incident that occurred
during the work_type feature implementation.
"""

import logging
from datetime import datetime, UTC
from typing import Any, Optional, Union
from collections.abc import Callable
from pathlib import Path
import json
import shutil

from sqlmodel import Session, select, text
from sqlalchemy import inspect, MetaData
from sqlalchemy.exc import SQLAlchemyError

from taskagent_api.database import db
from taskagent_api.models import (
    User,
    Project,
    Goal,
    Task,
    Schedule,
    WeeklySchedule,
    WeeklyRecurringTask,
    Log,
    UserSettings,
    ApiUsageLog,
    GoalDependency,
    TaskDependency,
)

logger = logging.getLogger(__name__)


class SafeMigrationError(Exception):
    """Exception raised during safe migration operations"""

    pass


class DataBackupManager:
    """Manages database backups before schema changes"""

    def __init__(self, backup_dir: str = "backups"):
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(exist_ok=True)

    def create_backup(self, backup_name: str | None = None) -> str:
        """Create a full backup of critical data tables"""
        if not backup_name:
            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
            backup_name = f"backup_{timestamp}"

        backup_path = self.backup_dir / f"{backup_name}.json"

        try:
            engine = db.get_engine()
            backup_data = {}

            with Session(engine) as session:
                # Backup users
                users = session.exec(select(User)).all()
                backup_data["users"] = [user.model_dump() for user in users]

                # Backup projects
                projects = session.exec(select(Project)).all()
                backup_data["projects"] = [project.model_dump() for project in projects]

                # Backup goals
                goals = session.exec(select(Goal)).all()
                backup_data["goals"] = [goal.model_dump() for goal in goals]

                # Backup tasks
                tasks = session.exec(select(Task)).all()
                backup_data["tasks"] = [task.model_dump() for task in tasks]

                # Backup schedules
                schedules = session.exec(select(Schedule)).all()
                backup_data["schedules"] = [
                    schedule.model_dump() for schedule in schedules
                ]

                # Backup weekly schedules
                weekly_schedules = session.exec(select(WeeklySchedule)).all()
                backup_data["weekly_schedules"] = [
                    ws.model_dump() for ws in weekly_schedules
                ]

                # Backup weekly recurring tasks
                weekly_recurring_tasks = session.exec(select(WeeklyRecurringTask)).all()
                backup_data["weekly_recurring_tasks"] = [
                    wrt.model_dump() for wrt in weekly_recurring_tasks
                ]

                # Backup logs
                logs = session.exec(select(Log)).all()
                backup_data["logs"] = [log.model_dump() for log in logs]

                # Backup user settings
                user_settings = session.exec(select(UserSettings)).all()
                backup_data["user_settings"] = [us.model_dump() for us in user_settings]

                # Backup API usage logs
                api_usage_logs = session.exec(select(ApiUsageLog)).all()
                backup_data["api_usage_logs"] = [
                    aul.model_dump() for aul in api_usage_logs
                ]

                # Backup goal dependencies
                goal_dependencies = session.exec(select(GoalDependency)).all()
                backup_data["goal_dependencies"] = [
                    gd.model_dump() for gd in goal_dependencies
                ]

                # Backup task dependencies
                task_dependencies = session.exec(select(TaskDependency)).all()
                backup_data["task_dependencies"] = [
                    td.model_dump() for td in task_dependencies
                ]

                # Add metadata
                backup_data["metadata"] = {
                    "created_at": datetime.now(UTC).isoformat(),
                    "version": "2.0",
                    "total_records": {
                        "users": len(backup_data["users"]),
                        "projects": len(backup_data["projects"]),
                        "goals": len(backup_data["goals"]),
                        "tasks": len(backup_data["tasks"]),
                        "schedules": len(backup_data["schedules"]),
                        "weekly_schedules": len(backup_data["weekly_schedules"]),
                        "weekly_recurring_tasks": len(
                            backup_data["weekly_recurring_tasks"]
                        ),
                        "logs": len(backup_data["logs"]),
                        "user_settings": len(backup_data["user_settings"]),
                        "api_usage_logs": len(backup_data["api_usage_logs"]),
                        "goal_dependencies": len(backup_data["goal_dependencies"]),
                        "task_dependencies": len(backup_data["task_dependencies"]),
                    },
                }

            # Write backup file
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(backup_data, f, indent=2, default=str, ensure_ascii=False)

            logger.info(f"✅ Backup created: {backup_path}")
            logger.info(f"   Users: {len(backup_data['users'])}")
            logger.info(f"   Projects: {len(backup_data['projects'])}")
            logger.info(f"   Goals: {len(backup_data['goals'])}")
            logger.info(f"   Tasks: {len(backup_data['tasks'])}")
            logger.info(f"   Schedules: {len(backup_data['schedules'])}")
            logger.info(f"   WeeklySchedules: {len(backup_data['weekly_schedules'])}")
            logger.info(
                f"   WeeklyRecurringTasks: {len(backup_data['weekly_recurring_tasks'])}"
            )
            logger.info(f"   Logs: {len(backup_data['logs'])}")
            logger.info(f"   UserSettings: {len(backup_data['user_settings'])}")
            logger.info(f"   ApiUsageLogs: {len(backup_data['api_usage_logs'])}")
            logger.info(f"   GoalDependencies: {len(backup_data['goal_dependencies'])}")
            logger.info(f"   TaskDependencies: {len(backup_data['task_dependencies'])}")

            return str(backup_path)

        except Exception as e:
            logger.error(f"❌ Failed to create backup: {e}")
            raise SafeMigrationError(f"Backup creation failed: {e}")

    def restore_backup(self, backup_path: str) -> None:
        """Restore data from a backup file"""
        backup_file = Path(backup_path)
        if not backup_file.exists():
            raise SafeMigrationError(f"Backup file not found: {backup_path}")

        try:
            with open(backup_file, encoding="utf-8") as f:
                backup_data = json.load(f)

            engine = db.get_engine()

            with Session(engine) as session:
                # Clear existing data (in reverse dependency order)
                session.exec(text("TRUNCATE tasks, goals, projects, users CASCADE"))
                session.commit()

                # Restore users first
                for user_data in backup_data["users"]:
                    user = User(**user_data)
                    session.add(user)

                # Restore projects
                for project_data in backup_data["projects"]:
                    project = Project(**project_data)
                    session.add(project)

                # Restore goals
                for goal_data in backup_data["goals"]:
                    goal = Goal(**goal_data)
                    session.add(goal)

                # Restore tasks
                for task_data in backup_data["tasks"]:
                    task = Task(**task_data)
                    session.add(task)

                session.commit()

            metadata = backup_data.get("metadata", {})
            logger.info(f"✅ Backup restored from: {backup_path}")
            logger.info(f"   Backup created: {metadata.get('created_at')}")
            logger.info(f"   Records restored: {metadata.get('total_records', {})}")

        except Exception as e:
            logger.error(f"❌ Failed to restore backup: {e}")
            raise SafeMigrationError(f"Backup restoration failed: {e}")

    def create_user_backup(self, user_id: str, backup_name: str | None = None) -> str:
        """Create a backup of all data for a specific user"""
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

                # Backup user's schedules
                schedules = session.exec(
                    select(Schedule).where(Schedule.user_id == user_id)
                ).all()
                backup_data["schedules"] = [
                    schedule.model_dump() for schedule in schedules
                ]

                # Backup user's weekly schedules
                weekly_schedules = session.exec(
                    select(WeeklySchedule).where(WeeklySchedule.user_id == user_id)
                ).all()
                backup_data["weekly_schedules"] = [
                    ws.model_dump() for ws in weekly_schedules
                ]

                # Backup user's weekly recurring tasks
                weekly_recurring_tasks = session.exec(
                    select(WeeklyRecurringTask).where(
                        WeeklyRecurringTask.user_id == user_id
                    )
                ).all()
                backup_data["weekly_recurring_tasks"] = [
                    wrt.model_dump() for wrt in weekly_recurring_tasks
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
                backup_data["user_settings"] = [us.model_dump() for us in user_settings]

                # Backup user's API usage logs
                api_usage_logs = session.exec(
                    select(ApiUsageLog).where(ApiUsageLog.user_id == user_id)
                ).all()
                backup_data["api_usage_logs"] = [
                    aul.model_dump() for aul in api_usage_logs
                ]

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
                        "schedules": len(backup_data["schedules"]),
                        "weekly_schedules": len(backup_data["weekly_schedules"]),
                        "weekly_recurring_tasks": len(
                            backup_data["weekly_recurring_tasks"]
                        ),
                        "logs": len(backup_data["logs"]),
                        "user_settings": len(backup_data["user_settings"]),
                        "api_usage_logs": len(backup_data["api_usage_logs"]),
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

            engine = db.get_engine()

            with Session(engine) as session:
                # Maps to track ID conversions
                project_id_map = {}
                goal_id_map = {}
                task_id_map = {}

                # Import projects with new IDs
                for project_data in backup_data.get("projects", []):
                    old_project_id = project_data["id"]
                    new_project_id = str(uuid.uuid4())
                    project_id_map[old_project_id] = new_project_id

                    project_data["id"] = new_project_id
                    project_data["owner_id"] = target_user_id

                    project = Project(**project_data)
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
                        goal = Goal(**goal_data)
                        session.add(goal)

                # Import tasks with new IDs and updated goal references
                for task_data in backup_data.get("tasks", []):
                    old_task_id = task_data["id"]
                    new_task_id = str(uuid.uuid4())
                    task_id_map[old_task_id] = new_task_id

                    task_data["id"] = new_task_id
                    task_data["goal_id"] = goal_id_map.get(task_data["goal_id"])

                    if task_data["goal_id"]:  # Only add if goal exists
                        task = Task(**task_data)
                        session.add(task)

                # Import schedules with new IDs and updated user reference
                for schedule_data in backup_data.get("schedules", []):
                    schedule_data["id"] = str(uuid.uuid4())
                    schedule_data["user_id"] = target_user_id

                    schedule = Schedule(**schedule_data)
                    session.add(schedule)

                # Import weekly schedules with new IDs and updated user reference
                for ws_data in backup_data.get("weekly_schedules", []):
                    ws_data["id"] = str(uuid.uuid4())
                    ws_data["user_id"] = target_user_id

                    weekly_schedule = WeeklySchedule(**ws_data)
                    session.add(weekly_schedule)

                # Import weekly recurring tasks with new IDs and updated user reference
                for wrt_data in backup_data.get("weekly_recurring_tasks", []):
                    wrt_data["id"] = str(uuid.uuid4())
                    wrt_data["user_id"] = target_user_id

                    weekly_recurring_task = WeeklyRecurringTask(**wrt_data)
                    session.add(weekly_recurring_task)

                # Import logs with new IDs and updated task references
                for log_data in backup_data.get("logs", []):
                    log_data["id"] = str(uuid.uuid4())
                    log_data["task_id"] = task_id_map.get(log_data["task_id"])

                    if log_data["task_id"]:  # Only add if task exists
                        log = Log(**log_data)
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
                        user_settings = UserSettings(**us_data)
                        session.add(user_settings)

                # Import goal dependencies with updated references
                for gd_data in backup_data.get("goal_dependencies", []):
                    gd_data["id"] = str(uuid.uuid4())
                    gd_data["goal_id"] = goal_id_map.get(gd_data["goal_id"])
                    gd_data["depends_on_goal_id"] = goal_id_map.get(
                        gd_data["depends_on_goal_id"]
                    )

                    if gd_data["goal_id"] and gd_data["depends_on_goal_id"]:
                        goal_dependency = GoalDependency(**gd_data)
                        session.add(goal_dependency)

                # Import task dependencies with updated references
                for td_data in backup_data.get("task_dependencies", []):
                    td_data["id"] = str(uuid.uuid4())
                    td_data["task_id"] = task_id_map.get(td_data["task_id"])
                    td_data["depends_on_task_id"] = task_id_map.get(
                        td_data["depends_on_task_id"]
                    )

                    if td_data["task_id"] and td_data["depends_on_task_id"]:
                        task_dependency = TaskDependency(**td_data)
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
