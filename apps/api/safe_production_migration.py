#!/usr/bin/env python3
"""
Safe production migration script for adding priority column to tasks table.
This script ensures data safety by:
1. Creating backup before any changes
2. Checking existing table structure
3. Adding column with safe defaults
4. Verifying migration success
"""

import os
import sys
import logging
from datetime import datetime, UTC
from pathlib import Path

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from humancompiler_api.database import db
from sqlmodel import Session, text
from humancompiler_api.safe_migration import DataBackupManager

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def check_table_structure(session: Session) -> dict:
    """Check current tasks table structure."""
    logger.info("🔍 Checking current tasks table structure...")

    # Check for PostgreSQL (production) vs SQLite (local)
    try:
        # PostgreSQL query
        result = session.exec(
            text("""
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'tasks'
            ORDER BY ordinal_position
        """)
        )
        columns = {
            row[0]: {"type": row[1], "default": row[2], "nullable": row[3]}
            for row in result
        }
        db_type = "postgresql"
    except Exception:
        # SQLite query
        result = session.exec(text("PRAGMA table_info(tasks)"))
        columns = {
            row[1]: {"type": row[2], "default": row[4], "nullable": row[3] == 0}
            for row in result
        }
        db_type = "sqlite"

    logger.info(f"📊 Database type: {db_type}")
    logger.info(f"📊 Found {len(columns)} columns in tasks table")

    return {"columns": columns, "db_type": db_type}


def safe_add_priority_column(session: Session, db_type: str) -> bool:
    """Safely add priority column to tasks table."""
    logger.info("🔧 Adding priority column to tasks table...")

    try:
        # Use appropriate SQL for database type
        if db_type == "postgresql":
            # PostgreSQL syntax
            session.exec(
                text("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 3")
            )
        else:
            # SQLite syntax
            session.exec(
                text("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 3")
            )

        session.commit()
        logger.info("✅ Successfully added priority column")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to add priority column: {e}")
        session.rollback()
        return False


def verify_migration(session: Session, db_type: str) -> bool:
    """Verify that the migration was successful."""
    logger.info("🔍 Verifying migration success...")

    try:
        # Check that priority column exists
        if db_type == "postgresql":
            result = session.exec(
                text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'priority'
            """)
            )
            has_priority = len(list(result)) > 0
        else:
            result = session.exec(text("PRAGMA table_info(tasks)"))
            columns = [row[1] for row in result]
            has_priority = "priority" in columns

        if not has_priority:
            logger.error("❌ Priority column not found after migration")
            return False

        # Check that existing data is preserved
        result = session.exec(text("SELECT COUNT(*) FROM tasks"))
        task_count = result.first()
        logger.info(f"📊 Total tasks in database: {task_count}")

        # Check that new priority column has default values
        result = session.exec(text("SELECT COUNT(*) FROM tasks WHERE priority = 3"))
        default_priority_count = result.first()
        logger.info(f"📊 Tasks with default priority (3): {default_priority_count}")

        logger.info("✅ Migration verification successful")
        return True

    except Exception as e:
        logger.error(f"❌ Migration verification failed: {e}")
        return False


def main():
    """Main migration function."""
    logger.info("🚀 Starting safe production migration for priority column")

    try:
        # Initialize database connection
        engine = db.get_engine()

        with Session(engine) as session:
            # Step 1: Check current table structure
            structure = check_table_structure(session)
            columns = structure["columns"]
            db_type = structure["db_type"]

            # Check if priority column already exists
            if "priority" in columns:
                logger.info("✅ Priority column already exists - no migration needed")
                return True

            # Step 2: Create backup (for PostgreSQL production data)
            if db_type == "postgresql":
                logger.info("💾 Creating backup of production data...")
                backup_manager = DataBackupManager("production_backups")
                backup_path = backup_manager.create_backup(
                    f"pre_priority_migration_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}"
                )
                logger.info(f"✅ Backup created: {backup_path}")

            # Step 3: Add priority column safely
            success = safe_add_priority_column(session, db_type)
            if not success:
                logger.error("❌ Migration failed - no changes made")
                return False

            # Step 4: Verify migration
            verification_success = verify_migration(session, db_type)
            if not verification_success:
                logger.error("❌ Migration verification failed")
                return False

            logger.info("🎉 Migration completed successfully!")
            return True

    except Exception as e:
        logger.error(f"💥 Migration script failed: {e}")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
