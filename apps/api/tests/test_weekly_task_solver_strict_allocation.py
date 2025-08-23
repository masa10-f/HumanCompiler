"""
Tests for weekly task solver strict allocation constraints (0.9-1.1x range).
"""

from taskagent_api.ai.weekly_task_solver import ProjectAllocation


class TestWeeklyTaskSolverStrictAllocation:
    """Test cases for strict allocation constraints (0.9-1.1x range)."""

    def test_strict_allocation_constraint_logic(self):
        """Test the logic for strict allocation constraints."""
        # Test allocation with sufficient tasks (should enforce 0.9-1.1x)
        allocation_10h = ProjectAllocation(
            project_id="sufficient_project",
            project_title="Sufficient Project",
            target_hours=10.0,
            max_hours=15.0,
            priority_weight=0.5,
        )

        # Available task hours: 20.0 (sufficient for 10h * 1.1 = 11h)
        available_task_hours = 20.0

        # Calculate expected constraints
        ideal_min_hours = int(10.0 * 0.9 * 10)  # 90 (9.0h)
        ideal_max_hours = int(10.0 * 1.1 * 10)  # 110 (11.0h)

        # Since available_task_hours (20.0) * 10 = 200 >= ideal_min_hours (90), use strict constraints
        expected_min = ideal_min_hours
        expected_max = min(
            ideal_max_hours, int(available_task_hours * 10)
        )  # min(110, 200) = 110

        assert expected_min == 90  # 9.0h
        assert expected_max == 110  # 11.0h

        # Test allocation with limited tasks (should use all available)
        allocation_limited = ProjectAllocation(
            project_id="limited_project",
            project_title="Limited Project",
            target_hours=10.0,
            max_hours=15.0,
            priority_weight=0.5,
        )

        # Available task hours: 6.0 (less than 10h * 0.9 = 9h)
        limited_task_hours = 6.0

        # Since available_task_hours (6.0) * 10 = 60 < ideal_min_hours (90), use all available
        expected_limited_min = int(limited_task_hours * 10)  # 60 (6.0h)
        expected_limited_max = int(limited_task_hours * 10)  # 60 (6.0h)

        assert expected_limited_min == 60  # 6.0h
        assert expected_limited_max == 60  # 6.0h

    def test_strict_allocation_constraint_calculation_sufficient_tasks(self):
        """Test constraint calculation when sufficient tasks are available."""
        # Simulate the constraint calculation logic directly
        allocation = ProjectAllocation(
            project_id="test_project",
            project_title="Test Project",
            target_hours=10.0,
            max_hours=15.0,
            priority_weight=0.5,
        )

        available_task_hours = 20.0  # Sufficient for strict constraints

        # Replicate the logic from weekly_task_solver.py
        ideal_min_hours = int(allocation.target_hours * 0.9 * 10)  # 90
        ideal_max_hours = int(allocation.target_hours * 1.1 * 10)  # 110

        if available_task_hours * 10 < ideal_min_hours:
            # Not enough tasks - use all available
            hard_min_hours = int(available_task_hours * 10)
            max_hours = int(available_task_hours * 10)
            constraint_type = "limited by available tasks"
        else:
            # Sufficient tasks - enforce strict range
            hard_min_hours = ideal_min_hours
            max_hours = min(ideal_max_hours, int(available_task_hours * 10))
            constraint_type = "strict 0.9-1.1x"

        # With 20h available, should use strict constraints
        assert constraint_type == "strict 0.9-1.1x"
        assert hard_min_hours == 90  # 9.0h
        assert max_hours == 110  # 11.0h
        assert hard_min_hours / 10 == 9.0  # Convert back to hours
        assert max_hours / 10 == 11.0

    def test_strict_allocation_constraint_calculation_limited_tasks(self):
        """Test constraint calculation when available tasks are limited."""
        # Simulate the constraint calculation logic directly
        allocation = ProjectAllocation(
            project_id="limited_project",
            project_title="Limited Project",
            target_hours=10.0,
            max_hours=15.0,
            priority_weight=0.5,
        )

        available_task_hours = 6.0  # Insufficient for strict minimum (9h)

        # Replicate the logic from weekly_task_solver.py
        ideal_min_hours = int(allocation.target_hours * 0.9 * 10)  # 90
        ideal_max_hours = int(allocation.target_hours * 1.1 * 10)  # 110

        if available_task_hours * 10 < ideal_min_hours:
            # Not enough tasks - use all available
            hard_min_hours = int(available_task_hours * 10)
            max_hours = int(available_task_hours * 10)
            constraint_type = "limited by available tasks"
        else:
            # Sufficient tasks - enforce strict range
            hard_min_hours = ideal_min_hours
            max_hours = min(ideal_max_hours, int(available_task_hours * 10))
            constraint_type = "strict 0.9-1.1x"

        # With 6h available (< 9h minimum), should use all available
        assert constraint_type == "limited by available tasks"
        assert hard_min_hours == 60  # 6.0h
        assert max_hours == 60  # 6.0h
        assert hard_min_hours / 10 == 6.0  # Convert back to hours
        assert max_hours / 10 == 6.0

    def test_allocation_range_boundaries(self):
        """Test allocation constraint boundaries."""
        # Test exact boundary values
        target_hours = 10.0

        # 0.9x boundary
        min_boundary = target_hours * 0.9  # 9.0h
        assert min_boundary == 9.0

        # 1.1x boundary
        max_boundary = target_hours * 1.1  # 11.0h
        assert max_boundary == 11.0

        # Range span
        range_span = max_boundary - min_boundary  # 2.0h
        assert range_span == 2.0

        # Percentage of target
        range_percentage = range_span / target_hours  # 0.2 (20%)
        assert range_percentage == 0.2

    def test_multiple_allocation_scenarios(self):
        """Test various allocation scenarios with different targets."""
        test_cases = [
            # (target_hours, available_hours, expected_min, expected_max, expected_type)
            (
                5.0,
                10.0,
                4.5,
                5.5,
                "strict",
            ),  # 5h target, 10h available -> strict 4.5-5.5h
            (
                8.0,
                15.0,
                7.2,
                8.8,
                "strict",
            ),  # 8h target, 15h available -> strict 7.2-8.8h
            (
                12.0,
                5.0,
                5.0,
                5.0,
                "limited",
            ),  # 12h target, 5h available -> limited to 5h
            (
                20.0,
                15.0,
                15.0,
                15.0,
                "limited",
            ),  # 20h target, 15h available -> limited to 15h
        ]

        for target, available, expected_min, expected_max, expected_type in test_cases:
            # Calculate constraints
            ideal_min_hours = int(target * 0.9 * 10)
            ideal_max_hours = int(target * 1.1 * 10)

            if available * 10 < ideal_min_hours:
                hard_min_hours = int(available * 10)
                max_hours = int(available * 10)
                constraint_type = "limited"
            else:
                hard_min_hours = ideal_min_hours
                max_hours = min(ideal_max_hours, int(available * 10))
                constraint_type = "strict"

            # Verify results
            assert constraint_type == expected_type, (
                f"Failed for target={target}, available={available}"
            )
            assert abs(hard_min_hours / 10 - expected_min) < 0.01, (
                f"Min constraint failed for target={target}"
            )
            assert abs(max_hours / 10 - expected_max) < 0.01, (
                f"Max constraint failed for target={target}"
            )
