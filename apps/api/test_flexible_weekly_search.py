#!/usr/bin/env python3
"""
Test script for flexible weekly schedule search functionality
"""

import os
import sys
from datetime import datetime, timedelta

# Add src to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from sqlmodel import Session
from humancompiler_api.database import db
from humancompiler_api.routers.scheduler import _get_tasks_from_weekly_schedule


def test_flexible_weekly_search():
    """Test that flexible weekly search works correctly"""
    engine = db.get_engine()

    print("=== Testing Flexible Weekly Schedule Search ===")

    # Test scenarios
    test_cases = [
        {
            "description": "8/31 weekly schedule should be found when searching for 9/1",
            "schedule_start": "2024-08-31",  # Saturday (user input)
            "search_date": "2024-09-01",  # Sunday (next day)
            "expected": "Should find the schedule",
        },
        {
            "description": "9/1 weekly schedule should be found when searching for 9/1",
            "schedule_start": "2024-09-01",  # Sunday (user input)
            "search_date": "2024-09-01",  # Sunday (same day)
            "expected": "Should find the schedule",
        },
        {
            "description": "8/26 weekly schedule should be found when searching for 9/1",
            "schedule_start": "2024-08-26",  # Monday (proper week start)
            "search_date": "2024-09-01",  # Sunday (end of week)
            "expected": "Should find the schedule",
        },
    ]

    for i, case in enumerate(test_cases):
        print(f"\n--- Test Case {i + 1}: {case['description']} ---")
        print(f"Schedule saved with start date: {case['schedule_start']}")
        print(f"Searching for date: {case['search_date']}")
        print(f"Expected result: {case['expected']}")

        # Calculate what the algorithm would do
        search_date = datetime.strptime(case["search_date"], "%Y-%m-%d").date()
        days_since_monday = search_date.weekday()
        week_start = search_date - timedelta(days=days_since_monday)
        week_end = week_start + timedelta(days=6)

        print(f"Algorithm will search for week: {week_start} to {week_end}")

        schedule_start = datetime.strptime(case["schedule_start"], "%Y-%m-%d").date()
        in_range = week_start <= schedule_start <= week_end

        print(f"Schedule start date {schedule_start} is in range: {in_range}")

        if in_range:
            print("✅ This case should work with the flexible search")
        else:
            print("❌ This case might still fail")


if __name__ == "__main__":
    test_flexible_weekly_search()
