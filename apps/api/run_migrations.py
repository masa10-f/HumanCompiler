#!/usr/bin/env python3
"""
Database migration runner for TaskAgent.
This script runs SQL migrations in order for the current environment.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent / "src"))

from taskagent_api.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migrations():
    """Run database migrations."""
    migrations_dir = Path(__file__).parent / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))

    if not migration_files:
        logger.warning("No migration files found")
        return

    # Connect to database
    try:
        # Parse database URL
        import urllib.parse

        parsed = urllib.parse.urlparse(settings.database_url)

        connection = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],  # Remove leading /
            user=parsed.username,
            password=parsed.password,
            sslmode="require",
        )
        connection.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

        logger.info(f"Connected to database: {parsed.hostname}")

        with connection.cursor() as cursor:
            # Create migrations tracking table if not exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS migrations (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255) NOT NULL UNIQUE,
                    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Get already applied migrations
            cursor.execute("SELECT filename FROM migrations")
            applied_migrations = {row[0] for row in cursor.fetchall()}

            # Run pending migrations
            for migration_file in migration_files:
                filename = migration_file.name

                if filename in applied_migrations:
                    logger.info(f"Migration {filename} already applied, skipping")
                    continue

                logger.info(f"Applying migration: {filename}")

                # Read and execute migration
                with open(migration_file) as f:
                    migration_sql = f.read()

                try:
                    cursor.execute(migration_sql)

                    # Record migration as applied
                    cursor.execute(
                        "INSERT INTO migrations (filename) VALUES (%s)", (filename,)
                    )

                    logger.info(f"Successfully applied migration: {filename}")

                except Exception as e:
                    logger.error(f"Failed to apply migration {filename}: {e}")
                    raise

        connection.close()
        logger.info("All migrations completed successfully")

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run_migrations()
