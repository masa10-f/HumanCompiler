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
from taskagent_api.models import User, Project, Goal, Task

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

                # Add metadata
                backup_data["metadata"] = {
                    "created_at": datetime.now(UTC).isoformat(),
                    "version": "1.0",
                    "total_records": {
                        "users": len(backup_data["users"]),
                        "projects": len(backup_data["projects"]),
                        "goals": len(backup_data["goals"]),
                        "tasks": len(backup_data["tasks"]),
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
