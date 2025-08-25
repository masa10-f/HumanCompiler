#!/usr/bin/env python3
"""
Simple production migration for priority column
"""

import sys
import os

sys.path.insert(0, "/app/src")

from humancompiler_api.database import db
from sqlmodel import Session, text


def main():
    print("🚀 Starting priority column migration...")

    try:
        engine = db.get_engine()

        with Session(engine) as session:
            # Check if priority column exists
            result = session.exec(
                text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'priority'
            """)
            )
            exists = len(list(result)) > 0

            if exists:
                print("✅ Priority column already exists")
                return True

            # Count existing tasks before migration
            result = session.exec(text("SELECT COUNT(*) FROM tasks"))
            task_count_before = result.first()
            print(f"📊 Tasks before migration: {task_count_before}")

            # Add priority column with safe default
            print("🔧 Adding priority column...")
            session.exec(
                text("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 3")
            )
            session.commit()

            # Verify migration
            result = session.exec(text("SELECT COUNT(*) FROM tasks"))
            task_count_after = result.first()
            print(f"📊 Tasks after migration: {task_count_after}")

            if task_count_before != task_count_after:
                print("❌ Task count mismatch - data may be corrupted!")
                return False

            result = session.exec(text("SELECT COUNT(*) FROM tasks WHERE priority = 3"))
            default_priority_count = result.first()
            print(f"📊 Tasks with default priority: {default_priority_count}")

            print("✅ Migration completed successfully!")
            return True

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False


if __name__ == "__main__":
    success = main()
    print("Migration result:", "SUCCESS" if success else "FAILED")
