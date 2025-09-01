#!/usr/bin/env python3
"""
Debug script to check weekly schedule data structure
"""

import os
import sys
import json
from datetime import datetime, timedelta

# Add src to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from sqlmodel import Session, select
from humancompiler_api.database import db
from humancompiler_api.models import WeeklySchedule, User


def debug_weekly_schedules():
    """Debug weekly schedule data structure"""
    engine = db.get_engine()

    with Session(engine) as session:
        print("=== Weekly Schedules Debug ===\n")

        # Get all users
        users = session.exec(select(User)).all()
        print(f"Found {len(users)} users:")
        for user in users:
            print(f"  - {user.id}: {user.email}")

        if not users:
            print("No users found!")
            return

        # Get all weekly schedules
        weekly_schedules = session.exec(
            select(WeeklySchedule).order_by(WeeklySchedule.week_start_date.desc())
        ).all()

        print(f"\nFound {len(weekly_schedules)} weekly schedules:")

        for i, schedule in enumerate(weekly_schedules):
            print(f"\n--- Schedule {i + 1} ---")
            print(f"ID: {schedule.id}")
            print(f"User ID: {schedule.user_id}")
            print(f"Week Start Date: {schedule.week_start_date}")
            print(f"Created: {schedule.created_at}")
            print(f"Updated: {schedule.updated_at}")

            # Analyze schedule_json structure
            schedule_data = schedule.schedule_json
            if schedule_data:
                print("\nSchedule JSON keys:")
                for key in schedule_data.keys():
                    value = schedule_data[key]
                    if isinstance(value, list):
                        print(f"  - {key}: list with {len(value)} items")
                        if value and key == "selected_tasks":
                            print(
                                f"    First item keys: {list(value[0].keys()) if isinstance(value[0], dict) else 'Not a dict'}"
                            )
                    else:
                        print(f"  - {key}: {type(value).__name__}")

                # Show selected_tasks in detail
                if "selected_tasks" in schedule_data:
                    selected_tasks = schedule_data["selected_tasks"]
                    print(f"\nSelected tasks ({len(selected_tasks)} items):")
                    for j, task in enumerate(selected_tasks[:3]):  # Show first 3 tasks
                        print(
                            f"  Task {j + 1}: {json.dumps(task, default=str, indent=4)}"
                        )
                    if len(selected_tasks) > 3:
                        print(f"  ... and {len(selected_tasks) - 3} more tasks")

                # Show selected_recurring_task_ids
                if "selected_recurring_task_ids" in schedule_data:
                    recurring_ids = schedule_data["selected_recurring_task_ids"]
                    print(f"\nSelected recurring task IDs: {recurring_ids}")
                else:
                    print("\nNo selected_recurring_task_ids found")

            else:
                print("Schedule JSON is None or empty")

            print("-" * 50)


if __name__ == "__main__":
    debug_weekly_schedules()
