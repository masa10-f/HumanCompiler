#!/usr/bin/env python3
"""
Row Level Security (RLS) Migration Script for TaskAgent

This script safely enables RLS and creates security policies for all tables.
It includes backup functionality and verification steps.

Usage:
    PYTHONPATH=src python src/taskagent_api/enable_rls_migration.py

Requirements:
    - Database connection configured in environment variables
    - Supabase Auth service enabled
    - Proper permissions for DDL operations
"""

import logging
import sys
from pathlib import Path

from taskagent_api.database import db
from taskagent_api.safe_migration import DataBackupManager
from sqlmodel import Session, text

logger = logging.getLogger(__name__)


class RLSMigrationManager:
    """Manages RLS migration with backup and verification"""

    def __init__(self):
        self.backup_manager = DataBackupManager()
        self.engine = db.get_engine()

    def verify_prerequisites(self) -> bool:
        """Verify database connection and prerequisites"""
        try:
            with Session(self.engine) as session:
                # Check database connection
                result = session.exec(text("SELECT 1")).first()
                if result != 1:
                    logger.error("Database connection test failed")
                    return False

                # Check if auth functions are available
                auth_check = session.exec(
                    text(
                        "SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'uid' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth'))"
                    )
                ).first()

                if not auth_check:
                    logger.error(
                        "Supabase auth.uid() function not available. Ensure Supabase Auth is enabled."
                    )
                    return False

                logger.info("✅ Prerequisites verified")
                return True

        except Exception as e:
            logger.error(f"❌ Prerequisites check failed: {e}")
            return False

    def check_current_rls_status(self) -> dict[str, bool]:
        """Check current RLS status for all tables"""
        tables = [
            "users",
            "projects",
            "goals",
            "tasks",
            "schedules",
            "weekly_schedules",
            "weekly_recurring_tasks",
            "logs",
            "user_settings",
            "api_usage_logs",
            "goal_dependencies",
            "task_dependencies",
        ]

        status = {}
        try:
            with Session(self.engine) as session:
                for table in tables:
                    result = session.exec(
                        text(
                            "SELECT relrowsecurity FROM pg_class WHERE relname = :table_name AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')"
                        ),
                        {"table_name": table},
                    ).first()
                    status[table] = bool(result) if result is not None else False

                logger.info(f"Current RLS status: {status}")
                return status

        except Exception as e:
            logger.error(f"❌ Failed to check RLS status: {e}")
            return {}

    def execute_rls_migration(self) -> bool:
        """Execute RLS migration with backup"""
        try:
            # Create backup before migration
            logger.info("📦 Creating backup before RLS migration...")
            backup_path = self.backup_manager.create_backup("pre_rls_migration")
            logger.info(f"✅ Backup created: {backup_path}")

            # Read migration SQL
            migration_file = (
                Path(__file__).parent.parent.parent
                / "migrations"
                / "enable_rls_security.sql"
            )
            if not migration_file.exists():
                logger.error(f"❌ Migration file not found: {migration_file}")
                return False

            with open(migration_file) as f:
                migration_sql = f.read()

            # Execute migration
            logger.info("🔐 Executing RLS migration...")
            with Session(self.engine) as session:
                # Split SQL into individual statements and execute
                statements = [
                    stmt.strip() for stmt in migration_sql.split(";") if stmt.strip()
                ]

                for stmt in statements:
                    if stmt.startswith("--") or not stmt:
                        continue

                    try:
                        session.exec(text(stmt))
                        logger.debug(f"✅ Executed: {stmt[:50]}...")
                    except Exception as stmt_error:
                        logger.error(f"❌ Failed to execute statement: {stmt[:50]}...")
                        logger.error(f"Error: {stmt_error}")
                        session.rollback()
                        return False

                session.commit()
                logger.info("✅ RLS migration completed successfully")
                return True

        except Exception as e:
            logger.error(f"❌ RLS migration failed: {e}")
            return False

    def verify_rls_migration(self) -> bool:
        """Verify RLS migration was successful"""
        try:
            # Check RLS status after migration
            logger.info("🔍 Verifying RLS migration...")
            new_status = self.check_current_rls_status()

            # All tables should have RLS enabled
            failed_tables = [
                table for table, enabled in new_status.items() if not enabled
            ]
            if failed_tables:
                logger.error(f"❌ RLS not enabled on tables: {failed_tables}")
                return False

            # Check policies exist
            with Session(self.engine) as session:
                policy_count = session.exec(
                    text("SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'")
                ).first()

                if (
                    policy_count < 12
                ):  # Should have at least 12 policies (one per table)
                    logger.error(
                        f"❌ Expected at least 12 policies, found {policy_count}"
                    )
                    return False

                logger.info(
                    f"✅ RLS verification successful: {policy_count} policies created"
                )
                return True

        except Exception as e:
            logger.error(f"❌ RLS verification failed: {e}")
            return False

    def run_migration(self) -> bool:
        """Run complete RLS migration with verification"""
        logger.info("🚀 Starting RLS migration for TaskAgent")

        # Step 1: Verify prerequisites
        if not self.verify_prerequisites():
            logger.error("❌ Prerequisites not met. Aborting migration.")
            return False

        # Step 2: Check current status
        current_status = self.check_current_rls_status()
        enabled_tables = [table for table, enabled in current_status.items() if enabled]

        if len(enabled_tables) == len(current_status):
            logger.info("✅ RLS already enabled on all tables")
            return True

        if enabled_tables:
            logger.warning(f"⚠️ RLS partially enabled on tables: {enabled_tables}")

        # Step 3: Execute migration
        if not self.execute_rls_migration():
            logger.error("❌ Migration failed")
            return False

        # Step 4: Verify migration
        if not self.verify_rls_migration():
            logger.error("❌ Migration verification failed")
            return False

        logger.info("🎉 RLS migration completed successfully!")
        return True


def main():
    """Main entry point"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    migration_manager = RLSMigrationManager()

    try:
        success = migration_manager.run_migration()
        if success:
            logger.info("✅ RLS migration completed successfully")
            sys.exit(0)
        else:
            logger.error("❌ RLS migration failed")
            sys.exit(1)

    except KeyboardInterrupt:
        logger.info("Migration cancelled by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
