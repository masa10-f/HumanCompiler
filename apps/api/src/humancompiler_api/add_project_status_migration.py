#!/usr/bin/env python3
"""
Safe migration script to add status column to projects table.

This script adds a status column with ProjectStatus enum values to the projects table.
It includes automatic backup creation and validation.
"""

import logging
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from humancompiler_api.database import db
from humancompiler_api.safe_migration import DataBackupManager, SafeMigrationError


class AddProjectStatusMigration:
    """Safe migration to add status column to projects table"""

    def __init__(self) -> None:
        self.backup_manager = DataBackupManager()

    def execute_migration(self, backup_name: str | None = None) -> str:
        """Execute the project status migration safely"""
        try:
            # Create backup before migration
            backup_path = self.backup_manager.create_backup(
                backup_name or "pre_project_status_migration"
            )
            logging.info(f"Backup created: {backup_path}")

            # Execute migration
            self._add_status_column()
            logging.info("Migration completed successfully")

            return backup_path

        except Exception as e:
            logging.error(f"Migration failed: {e}")
            raise SafeMigrationError(f"Migration failed: {e}")

    def _add_status_column(self) -> None:
        """Add status column to projects table"""
        engine = db.get_engine()

        with Session(engine) as session:
            try:
                # Check if column already exists
                result = session.exec(text("PRAGMA table_info(projects)")).fetchall()

                existing_columns = [row[1] for row in result]  # row[1] is column name

                if "status" in existing_columns:
                    logging.info("Status column already exists in projects table")
                    return

                # Add status column with default value
                session.exec(
                    text("""
                        ALTER TABLE projects
                        ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL
                    """)
                )

                # Update existing records to have pending status
                session.exec(
                    text("""
                        UPDATE projects
                        SET status = 'pending'
                        WHERE status IS NULL
                    """)
                )

                session.commit()
                logging.info("Added status column to projects table")

            except Exception as e:
                session.rollback()
                raise SafeMigrationError(f"Failed to add status column: {e}")

    def validate_migration(self) -> bool:
        """Validate that the migration was successful"""
        try:
            engine = db.get_engine()

            with Session(engine) as session:
                # Check if status column exists
                result = session.exec(text("PRAGMA table_info(projects)")).fetchall()

                status_column = None
                for row in result:
                    if row[1] == "status":  # row[1] is column name
                        status_column = row
                        break

                if not status_column:
                    logging.error("Status column not found in projects table")
                    return False

                # Check if all existing projects have a status value
                count_result = session.exec(
                    text("SELECT COUNT(*) FROM projects WHERE status IS NULL")
                ).fetchone()

                if count_result and count_result[0] > 0:
                    logging.error(f"Found {count_result[0]} projects with NULL status")
                    return False

                logging.info("Migration validation successful")
                return True

        except Exception as e:
            logging.error(f"Migration validation failed: {e}")
            return False


def main() -> None:
    """Main migration execution function"""
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
    )

    migration = AddProjectStatusMigration()

    try:
        backup_path = migration.execute_migration()

        # Validate migration
        if migration.validate_migration():
            print("✅ Migration completed successfully")
            print(f"✅ Backup created: {backup_path}")
        else:
            print("❌ Migration validation failed")

    except SafeMigrationError as e:
        print(f"❌ Migration failed: {e}")
        return


if __name__ == "__main__":
    main()
