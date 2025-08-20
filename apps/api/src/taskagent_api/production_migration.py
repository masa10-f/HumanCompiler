"""
Production database migration to add priority column to tasks table.
This module provides safe migration functionality for production environments.
"""

import logging
from sqlmodel import Session, text
from taskagent_api.database import db

logger = logging.getLogger(__name__)


def migrate_add_priority_column():
    """
    Safely add priority column to tasks table in production.
    Returns True if successful, False otherwise.
    """
    try:
        engine = db.get_engine()

        with Session(engine) as session:
            # Check if priority column already exists
            result = session.exec(
                text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'priority'
            """)
            )
            exists = len(list(result)) > 0

            if exists:
                logger.info("✅ Priority column already exists - migration skipped")
                return True

            # Count existing data before migration
            result = session.exec(text("SELECT COUNT(*) FROM tasks"))
            task_count_before = result.first()
            logger.info(f"📊 Tasks before migration: {task_count_before}")

            # Add priority column with safe default value
            logger.info("🔧 Adding priority column to tasks table...")
            session.exec(
                text("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 3")
            )
            session.commit()

            # Verify migration success
            result = session.exec(text("SELECT COUNT(*) FROM tasks"))
            task_count_after = result.first()

            if task_count_before != task_count_after:
                logger.error(
                    f"❌ Data corruption detected: {task_count_before} -> {task_count_after}"
                )
                return False

            # Verify all tasks have default priority
            result = session.exec(text("SELECT COUNT(*) FROM tasks WHERE priority = 3"))
            default_priority_count = result.first()

            logger.info("✅ Migration completed successfully!")
            logger.info(f"📊 Tasks after migration: {task_count_after}")
            logger.info(f"📊 Tasks with default priority (3): {default_priority_count}")

            return True

    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        return False


if __name__ == "__main__":
    # Configure logging for direct execution
    logging.basicConfig(level=logging.INFO)

    success = migrate_add_priority_column()
    if success:
        print("✅ Priority column migration completed successfully")
    else:
        print("❌ Priority column migration failed")
        exit(1)
