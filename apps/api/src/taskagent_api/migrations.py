"""
Database migration utilities for TaskAgent.
"""

import logging
from pathlib import Path

from sqlmodel import Session, text

from taskagent_api.database import db

logger = logging.getLogger(__name__)


async def run_migrations() -> None:
    """Run pending database migrations."""
    migrations_dir = Path(__file__).parents[2] / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))

    if not migration_files:
        logger.info("No migration files found")
        return

    engine = db.get_engine()

    with Session(engine) as session:
        # Create migrations tracking table if not exists
        session.exec(
            text("""
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """)
        )
        session.commit()

        # Get already applied migrations
        result = session.exec(text("SELECT filename FROM migrations"))
        applied_migrations = {row[0] for row in result.fetchall()}

        # Run pending migrations
        for migration_file in migration_files:
            filename = migration_file.name

            if filename in applied_migrations:
                logger.info(f"Migration {filename} already applied, skipping")
                continue

            logger.info(f"Applying migration: {filename}")

            try:
                # Read migration file
                with open(migration_file) as f:
                    migration_sql = f.read()

                # Execute migration
                session.exec(text(migration_sql))

                # Record migration as applied
                session.exec(
                    text("INSERT INTO migrations (filename) VALUES (:filename)"),
                    {"filename": filename},
                )
                session.commit()

                logger.info(f"Successfully applied migration: {filename}")

            except Exception as e:
                session.rollback()
                logger.error(f"Failed to apply migration {filename}: {e}")
                raise


def get_pending_migrations() -> list[str]:
    """Get list of pending migration files."""
    migrations_dir = Path(__file__).parents[2] / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))

    if not migration_files:
        return []

    engine = db.get_engine()

    try:
        with Session(engine) as session:
            # Get already applied migrations
            result = session.exec(text("SELECT filename FROM migrations"))
            applied_migrations = {row[0] for row in result.fetchall()}

            # Return pending migrations
            return [f.name for f in migration_files if f.name not in applied_migrations]
    except Exception:
        # If migrations table doesn't exist, all migrations are pending
        return [f.name for f in migration_files]
