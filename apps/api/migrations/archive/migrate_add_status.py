#!/usr/bin/env python3
"""
Migration script to add status column to goals table
"""

import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def add_status_column():
    """Add status column to goals table if it doesn't exist"""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL environment variable not found")
        return False

    try:
        engine = create_engine(database_url)

        with engine.connect() as conn:
            # Check if column already exists
            result = conn.execute(
                text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'goals' AND column_name = 'status'
            """)
            )

            if result.fetchone():
                logger.info("Column 'status' already exists in goals table")
                return True

            # Add status column with default value
            conn.execute(
                text("""
                ALTER TABLE goals
                ADD COLUMN status VARCHAR(50) DEFAULT 'pending' NOT NULL
            """)
            )

            conn.commit()
            logger.info("✅ Successfully added status column to goals table")
            return True

    except SQLAlchemyError as e:
        logger.error(f"❌ Database error: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        return False


if __name__ == "__main__":
    success = add_status_column()
    exit(0 if success else 1)
