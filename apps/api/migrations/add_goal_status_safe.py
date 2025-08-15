#!/usr/bin/env python3
"""
Production-safe migration script for adding status column to goals table.
This script includes backup functionality as required by CLAUDE.md guidelines.
"""

import os
import json
import logging
from datetime import datetime, UTC
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def create_backup(engine, backup_dir="backups"):
    """Create backup of goals table before migration"""
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(exist_ok=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"goals_backup_{timestamp}.json"

    try:
        with engine.connect() as conn:
            # Backup goals table
            result = conn.execute(text("SELECT * FROM goals"))
            goals_data = [dict(row._mapping) for row in result.fetchall()]

            # Backup users table (for reference)
            result = conn.execute(text("SELECT * FROM users"))
            users_data = [dict(row._mapping) for row in result.fetchall()]

            # Backup projects table (for reference)
            result = conn.execute(text("SELECT * FROM projects"))
            projects_data = [dict(row._mapping) for row in result.fetchall()]

            backup_data = {
                "metadata": {
                    "created_at": datetime.now(UTC).isoformat(),
                    "migration": "add_goal_status_column",
                    "version": "1.0",
                },
                "goals": goals_data,
                "users": users_data,
                "projects": projects_data,
                "counts": {
                    "goals": len(goals_data),
                    "users": len(users_data),
                    "projects": len(projects_data),
                },
            }

            with open(backup_file, "w", encoding="utf-8") as f:
                json.dump(backup_data, f, indent=2, default=str, ensure_ascii=False)

            logger.info(f"✅ Backup created successfully: {backup_file}")
            logger.info(f"   Goals: {len(goals_data)}")
            logger.info(f"   Users: {len(users_data)}")
            logger.info(f"   Projects: {len(projects_data)}")

            return str(backup_file)

    except Exception as e:
        logger.error(f"❌ Failed to create backup: {e}")
        raise


def check_column_exists(engine, table_name, column_name):
    """Check if column already exists in table"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = :column_name
            """),
                {"table_name": table_name, "column_name": column_name},
            )

            return result.fetchone() is not None
    except Exception as e:
        logger.error(f"❌ Error checking column existence: {e}")
        return False


def add_status_column(engine):
    """Add status column to goals table with proper constraints"""
    try:
        with engine.connect() as conn:
            # Begin transaction
            trans = conn.begin()

            try:
                # Add status column with default value
                conn.execute(
                    text("""
                    ALTER TABLE goals
                    ADD COLUMN status VARCHAR(50) DEFAULT 'pending' NOT NULL
                """)
                )

                # Add comment for documentation
                conn.execute(
                    text("""
                    COMMENT ON COLUMN goals.status IS 'Goal status: pending, in_progress, completed, cancelled'
                """)
                )

                # Create index for performance
                conn.execute(
                    text("""
                    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)
                """)
                )

                # Commit transaction
                trans.commit()
                logger.info("✅ Successfully added status column to goals table")
                return True

            except Exception as e:
                trans.rollback()
                logger.error(f"❌ Error adding status column: {e}")
                raise

    except Exception as e:
        logger.error(f"❌ Database operation failed: {e}")
        return False


def verify_migration(engine):
    """Verify that the migration was successful"""
    try:
        with engine.connect() as conn:
            # Check if column exists
            result = conn.execute(
                text("""
                SELECT column_name, data_type, column_default, is_nullable
                FROM information_schema.columns
                WHERE table_name = 'goals' AND column_name = 'status'
            """)
            )

            column_info = result.fetchone()
            if column_info:
                logger.info(f"✅ Status column exists: {dict(column_info._mapping)}")

                # Check if index exists
                result = conn.execute(
                    text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE tablename = 'goals' AND indexname = 'idx_goals_status'
                """)
                )

                if result.fetchone():
                    logger.info("✅ Index idx_goals_status exists")
                else:
                    logger.warning("⚠️ Index idx_goals_status not found")

                # Test a simple query
                result = conn.execute(
                    text("SELECT COUNT(*) as count FROM goals WHERE status = 'pending'")
                )
                count = result.fetchone().count
                logger.info(
                    f"✅ Test query successful: {count} goals with pending status"
                )

                return True
            else:
                logger.error("❌ Status column not found after migration")
                return False

    except Exception as e:
        logger.error(f"❌ Migration verification failed: {e}")
        return False


def main():
    """Main migration function"""
    logger.info("🚀 Starting production migration: add status column to goals table")

    # Get database URL
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable not found")
        return False

    try:
        # Create database engine
        engine = create_engine(database_url)
        logger.info("✅ Database connection established")

        # Step 1: Check if column already exists
        if check_column_exists(engine, "goals", "status"):
            logger.info("ℹ️ Status column already exists in goals table")
            return True

        # Step 2: Create backup
        logger.info("📦 Creating backup before migration...")
        backup_file = create_backup(engine)
        logger.info(f"✅ Backup completed: {backup_file}")

        # Step 3: Add status column
        logger.info("🔧 Adding status column to goals table...")
        if not add_status_column(engine):
            logger.error("❌ Failed to add status column")
            return False

        # Step 4: Verify migration
        logger.info("🔍 Verifying migration...")
        if not verify_migration(engine):
            logger.error("❌ Migration verification failed")
            return False

        logger.info("✅ Migration completed successfully!")
        logger.info(f"📄 Backup saved to: {backup_file}")
        return True

    except SQLAlchemyError as e:
        logger.error(f"❌ Database error: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
