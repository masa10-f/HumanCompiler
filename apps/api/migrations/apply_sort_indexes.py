#!/usr/bin/env python3
"""
SAFE INDEX MIGRATION for composite sort indexes
This script safely applies performance indexes without affecting data

SAFETY FEATURES:
- Creates backup before any changes
- Only creates indexes (no data modification)
- Uses IF NOT EXISTS to prevent conflicts
- Provides rollback capability
"""

import asyncio
import logging
from pathlib import Path
from datetime import datetime

from sqlmodel import Session, text

from humancompiler_api.database import db
from humancompiler_api.safe_migration import DataBackupManager

logger = logging.getLogger(__name__)


async def apply_sort_indexes_safely():
    """Safely apply composite sort indexes with backup"""
    logger.info("=== SAFE INDEX MIGRATION STARTING ===")

    # 1. CREATE BACKUP FIRST (mandatory safety step)
    backup_manager = DataBackupManager()
    try:
        backup_path = backup_manager.create_backup("pre_index_migration")
        logger.info(f"✅ Backup created successfully: {backup_path}")
    except Exception as e:
        logger.error(f"❌ Backup creation failed: {e}")
        logger.error("MIGRATION ABORTED - Cannot proceed without backup")
        raise

    # 2. Verify this is index-only migration (safety check)
    migration_file = Path(__file__).parent / "add_composite_sort_indexes.sql"

    if not migration_file.exists():
        raise FileNotFoundError(f"Migration file not found: {migration_file}")

    with open(migration_file) as f:
        sql_content = f.read()

    # Safety validation: ensure only safe operations
    dangerous_keywords = ["DROP", "DELETE", "UPDATE", "TRUNCATE", "ALTER TABLE"]
    sql_upper = sql_content.upper()

    for keyword in dangerous_keywords:
        if keyword in sql_upper:
            raise ValueError(
                f"⚠️ UNSAFE OPERATION DETECTED: {keyword} found in migration"
            )

    logger.info("✅ Migration safety validated - index-only operations")

    # 3. Apply indexes
    statements = [stmt.strip() for stmt in sql_content.split(";") if stmt.strip()]
    engine = db.get_engine()

    try:
        with Session(engine) as session:
            logger.info(f"Applying {len(statements)} index statements...")

            for i, statement in enumerate(statements):
                if not statement or statement.startswith("--"):
                    continue

                if "CREATE INDEX" in statement.upper():
                    # Extract index name for logging
                    index_name = "unknown"
                    if "idx_" in statement:
                        start = statement.find("idx_")
                        end = statement.find(" ", start)
                        if end == -1:
                            end = statement.find("\n", start)
                        index_name = statement[start:end].strip()

                    logger.info(
                        f"Creating index {i + 1}/{len(statements)}: {index_name}"
                    )
                    session.exec(text(statement))
                elif "COMMENT" in statement.upper():
                    logger.info(f"Adding comment {i + 1}/{len(statements)}")
                    session.exec(text(statement))

            session.commit()
            logger.info("✅ All composite sort indexes applied successfully!")

        # 4. Verify indexes were created
        await verify_indexes_created(engine)

    except Exception as e:
        logger.error(f"❌ Error applying indexes: {e}")
        logger.error("📋 Backup available for restore if needed")
        logger.error(
            f"   Restore command: python -c \"from humancompiler_api.safe_migration import DataBackupManager; DataBackupManager().restore_backup('{backup_path}')\""
        )
        raise


async def verify_indexes_created(engine):
    """Verify that indexes were created successfully"""
    with Session(engine) as session:
        # Check a few key indexes
        check_query = text("""
            SELECT schemaname, tablename, indexname
            FROM pg_indexes
            WHERE indexname LIKE 'idx_projects_status_%'
               OR indexname LIKE 'idx_goals_status_%'
               OR indexname LIKE 'idx_tasks_status_%'
            ORDER BY tablename, indexname
        """)

        result = session.exec(check_query).fetchall()
        logger.info(f"✅ Created {len(result)} sort indexes successfully")

        for row in result:
            logger.info(f"   - {row.tablename}.{row.indexname}")


def main():
    """Main function to run the safe migration"""
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
    )

    print("🛡️  SAFE INDEX MIGRATION")
    print("This will create performance indexes for sorting functionality")
    print("- Backup will be created automatically")
    print("- Only index creation (no data changes)")
    print("- Rollback available if needed")
    print()

    confirm = input("Continue with safe index migration? (y/N): ").lower()
    if confirm != "y":
        print("Migration cancelled by user")
        return

    try:
        asyncio.run(apply_sort_indexes_safely())
        print("🎉 Index migration completed successfully!")
    except Exception as e:
        print(f"💥 Migration failed: {e}")
        print("📋 Backup was created and can be used for restore if needed")
        return 1


if __name__ == "__main__":
    main()
