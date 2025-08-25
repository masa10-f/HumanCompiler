"""
Test cases for weekly schedule validation with non-Monday start dates.
Tests for issue #157: Weekly schedule should support any day of the week as start date.
"""

import pytest
from datetime import datetime
from fastapi import HTTPException

from humancompiler_api.routers.weekly_schedule import validate_week_start_date


# Test dates for different days of the week
TEST_DATES = [
    ("2024-01-01", "Monday"),  # Monday
    ("2024-01-02", "Tuesday"),  # Tuesday
    ("2024-01-03", "Wednesday"),  # Wednesday
    ("2024-01-04", "Thursday"),  # Thursday
    ("2024-01-05", "Friday"),  # Friday
    ("2024-01-06", "Saturday"),  # Saturday
    ("2024-01-07", "Sunday"),  # Sunday
]


class TestValidateWeekStartDate:
    """Test the validate_week_start_date function with various days."""

    @pytest.mark.parametrize("date_str,day_name", TEST_DATES)
    def test_validate_week_start_date_accepts_all_days(self, date_str, day_name):
        """Test that validate_week_start_date accepts all days of the week."""
        result = validate_week_start_date(date_str)
        assert isinstance(result, datetime)
        assert result.strftime("%Y-%m-%d") == date_str

    def test_validate_week_start_date_invalid_format(self):
        """Test that validate_week_start_date rejects invalid date formats."""
        invalid_dates = [
            "2024/01/01",  # Wrong separator
            "01-01-2024",  # Wrong order
            "invalid-date",  # Not a date
            "2024-13-01",  # Invalid month
            "2024-01-32",  # Invalid day
        ]

        for invalid_date in invalid_dates:
            with pytest.raises(HTTPException):
                validate_week_start_date(invalid_date)

    def test_validate_week_start_date_flexible_format(self):
        """Test that validate_week_start_date accepts some flexible formats."""
        # Python's strptime is flexible with some formats
        flexible_dates = [
            "2024-1-1",  # Missing leading zeros - accepted by strptime
            "2024-01-1",  # Partial leading zeros - accepted by strptime
            "2024-1-01",  # Mixed format - accepted by strptime
        ]

        for date_str in flexible_dates:
            result = validate_week_start_date(date_str)
            assert isinstance(result, datetime)
            # All should normalize to 2024-01-01
            assert result.strftime("%Y-%m-%d") == "2024-01-01"

    def test_validate_week_start_date_edge_cases(self):
        """Test edge cases for date validation."""
        # Leap year date
        result = validate_week_start_date("2024-02-29")
        assert result.strftime("%Y-%m-%d") == "2024-02-29"

        # Year boundary dates
        result = validate_week_start_date("2023-12-31")
        assert result.strftime("%Y-%m-%d") == "2023-12-31"

        result = validate_week_start_date("2024-01-01")
        assert result.strftime("%Y-%m-%d") == "2024-01-01"
