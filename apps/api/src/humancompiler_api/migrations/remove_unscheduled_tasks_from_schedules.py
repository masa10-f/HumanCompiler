#!/usr/bin/env python3
"""
Migration script to remove unscheduled_tasks from existing schedules in database.

This script addresses Issue #141 by cleaning up existing schedule records
that contain unscheduled_tasks data, which is no longer needed.

Usage:
    cd apps/api
    PYTHONPATH=src python src/humancompiler_api/migrations/remove_unscheduled_tasks_from_schedules.py
"""

import logging
import sys
from datetime import datetime
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from humancompiler_api.database import db
from humancompiler_api.models import Schedule
from humancompiler_api.safe_migration import DataBackupManager
from sqlmodel import Session, select

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def remove_unscheduled_tasks_from_schedules():
    """
    Remove unscheduled_tasks from all existing schedule records.

    This function:
    1. Creates a backup of current schedule data
    2. Updates all schedule records to remove unscheduled_tasks from plan_json
    3. Reports the number of updated records
    """
    logger.info("Starting removal of unscheduled_tasks from existing schedules")

    try:
        # Create backup before migration
        backup_manager = DataBackupManager()
        backup_path = backup_manager.create_backup("pre_remove_unscheduled_tasks")
        logger.info(f"Created backup at: {backup_path}")

        # Get database engine and session
        engine = db.get_engine()
        with Session(engine) as session:
            # Get all schedules that have unscheduled_tasks in plan_json
            logger.info("Fetching schedules with unscheduled_tasks...")

            schedules = session.exec(select(Schedule)).all()
            updated_count = 0

            for schedule in schedules:
                if (
                    schedule.plan_json
                    and isinstance(schedule.plan_json, dict)
                    and "unscheduled_tasks" in schedule.plan_json
                ):
                    # Remove unscheduled_tasks from plan_json
                    original_keys = list(schedule.plan_json.keys())
                    unscheduled_count = len(schedule.plan_json["unscheduled_tasks"])

                    # Create new plan_json without unscheduled_tasks
                    new_plan_json = {
                        key: value
                        for key, value in schedule.plan_json.items()
                        if key != "unscheduled_tasks"
                    }

                    schedule.plan_json = new_plan_json
                    schedule.updated_at = datetime.utcnow()

                    updated_count += 1
                    logger.info(
                        f"Updated schedule {schedule.id}: removed {unscheduled_count} unscheduled_tasks"
                    )

            if updated_count > 0:
                # Commit all changes
                session.commit()
                logger.info(f"Successfully updated {updated_count} schedule records")
            else:
                logger.info("No schedules found with unscheduled_tasks to remove")

            # Verify the changes
            logger.info("Verifying migration results...")
            remaining_schedules_with_unscheduled = session.exec(select(Schedule)).all()

            remaining_count = 0
            for schedule in remaining_schedules_with_unscheduled:
                if (
                    schedule.plan_json
                    and isinstance(schedule.plan_json, dict)
                    and "unscheduled_tasks" in schedule.plan_json
                ):
                    remaining_count += 1

            if remaining_count == 0:
                logger.info(
                    "✅ Migration completed successfully - no unscheduled_tasks found in any schedules"
                )
            else:
                logger.error(
                    f"❌ Migration incomplete - {remaining_count} schedules still contain unscheduled_tasks"
                )
                return False

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        logger.error(
            "You can restore from backup using DataBackupManager.restore_backup()"
        )
        return False

    return True


def main():
    """Main function to run the migration."""
    logger.info("=== Remove unscheduled_tasks from schedules migration ===")
    logger.info(
        "This migration removes unscheduled_tasks from existing schedule records"
    )
    logger.info("Addressing Issue #141: unassigned schedulesの削除")

    success = remove_unscheduled_tasks_from_schedules()

    if success:
        logger.info("✅ Migration completed successfully")
        sys.exit(0)
    else:
        logger.error("❌ Migration failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
