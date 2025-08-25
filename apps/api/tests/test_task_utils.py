"""
Tests for AI task utility functions
"""

import uuid
from datetime import date, timedelta

import pytest

from humancompiler_api.ai.models import WeeklyPlanContext
from humancompiler_api.ai.task_utils import filter_valid_tasks


class MockTask:
    """Mock task for testing"""

    def __init__(
        self,
        task_id,
        title,
        estimate_hours=1.0,
        status="pending",
        due_date=None,
        goal_id=None,
    ):
        self.id = task_id
        self.title = title
        self.estimate_hours = estimate_hours
        self.status = status
        self.due_date = due_date
        self.goal_id = goal_id


class MockProject:
    """Mock project for testing"""

    def __init__(self, project_id, title, description=""):
        self.id = project_id
        self.title = title
        self.description = description


class MockGoal:
    """Mock goal for testing"""

    def __init__(self, goal_id, title, project_id, estimate_hours=10.0):
        self.id = goal_id
        self.title = title
        self.project_id = project_id
        self.estimate_hours = estimate_hours


@pytest.fixture
def mock_context():
    """Create mock weekly plan context"""
    task1_id = str(uuid.uuid4())
    task2_id = str(uuid.uuid4())
    task3_id = str(uuid.uuid4())

    context = WeeklyPlanContext(
        user_id="test-user",
        week_start_date=date.today(),
        capacity_hours=40.0,
        preferences={},
        projects=[
            MockProject("proj1", "Test Project 1"),
            MockProject("proj2", "Test Project 2"),
        ],
        goals=[
            MockGoal("goal1", "Test Goal 1", "proj1"),
            MockGoal("goal2", "Test Goal 2", "proj2"),
        ],
        tasks=[
            MockTask(
                task1_id,
                "Valid Task 1",
                2.0,
                "pending",
                date.today() + timedelta(days=3),
                "goal1",
            ),
            MockTask(
                task2_id,
                "Valid Task 2",
                1.5,
                "pending",
                date.today() + timedelta(days=5),
                "goal1",
            ),
            MockTask(
                task3_id,
                "Valid Task 3",
                3.0,
                "pending",
                date.today() + timedelta(days=7),
                "goal2",
            ),
        ],
        weekly_recurring_tasks=[],
        selected_recurring_task_ids=[],
    )

    # Add task IDs to context for easy access
    context.task1_id = task1_id
    context.task2_id = task2_id
    context.task3_id = task3_id

    return context


class TestFilterValidTasks:
    """Test cases for filter_valid_tasks function"""

    def test_filter_all_valid_tasks(self, mock_context):
        """Test filtering when all task IDs are valid"""
        plans = [
            {
                "task_id": mock_context.task1_id,
                "estimated_hours": 2.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-11:00",
                "rationale": "High priority task",
            },
            {
                "task_id": mock_context.task2_id,
                "estimated_hours": 1.5,
                "priority": 2,
                "suggested_day": "Tuesday",
                "suggested_time_slot": "10:00-11:30",
                "rationale": "Medium priority task",
            },
        ]

        valid_tasks, skipped_tasks = filter_valid_tasks(plans, mock_context, "test")

        assert len(valid_tasks) == 2
        assert len(skipped_tasks) == 0
        assert valid_tasks[0].task_title == "Valid Task 1"
        assert valid_tasks[1].task_title == "Valid Task 2"
        assert valid_tasks[0].estimated_hours == 2.0
        assert valid_tasks[1].estimated_hours == 1.5

    def test_filter_mixed_valid_invalid_tasks(self, mock_context):
        """Test filtering when some task IDs are invalid"""
        plans = [
            {
                "task_id": mock_context.task1_id,  # Valid
                "estimated_hours": 2.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-11:00",
                "rationale": "High priority task",
            },
            {
                "task_id": "invalid-task-id-123",  # Invalid
                "estimated_hours": 1.0,
                "priority": 2,
                "suggested_day": "Tuesday",
                "suggested_time_slot": "10:00-11:00",
                "rationale": "Should be filtered out",
            },
            {
                "task_id": mock_context.task2_id,  # Valid
                "estimated_hours": 1.5,
                "priority": 3,
                "suggested_day": "Wednesday",
                "suggested_time_slot": "14:00-15:30",
                "rationale": "Medium priority task",
            },
            {
                "task_id": "another-invalid-id",  # Invalid
                "estimated_hours": 2.5,
                "priority": 4,
                "suggested_day": "Thursday",
                "suggested_time_slot": "09:00-11:30",
                "rationale": "Should also be filtered out",
            },
        ]

        valid_tasks, skipped_tasks = filter_valid_tasks(plans, mock_context, "test")

        assert len(valid_tasks) == 2
        assert len(skipped_tasks) == 2
        assert "invalid-task-id-123" in skipped_tasks
        assert "another-invalid-id" in skipped_tasks

        # Check that valid tasks are correctly processed
        valid_task_ids = {task.task_id for task in valid_tasks}
        assert mock_context.task1_id in valid_task_ids
        assert mock_context.task2_id in valid_task_ids

        # Check that all valid tasks have correct titles (no "Unknown Task")
        for task in valid_tasks:
            assert task.task_title != "Unknown Task"
            assert task.task_title in ["Valid Task 1", "Valid Task 2"]

    def test_filter_all_invalid_tasks(self, mock_context):
        """Test filtering when all task IDs are invalid"""
        plans = [
            {
                "task_id": "invalid-id-1",
                "estimated_hours": 1.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-10:00",
                "rationale": "Invalid task 1",
            },
            {
                "task_id": "invalid-id-2",
                "estimated_hours": 2.0,
                "priority": 2,
                "suggested_day": "Tuesday",
                "suggested_time_slot": "10:00-12:00",
                "rationale": "Invalid task 2",
            },
        ]

        valid_tasks, skipped_tasks = filter_valid_tasks(plans, mock_context, "test")

        assert len(valid_tasks) == 0
        assert len(skipped_tasks) == 2
        assert "invalid-id-1" in skipped_tasks
        assert "invalid-id-2" in skipped_tasks

    def test_filter_empty_plans(self, mock_context):
        """Test filtering with empty plans list"""
        plans = []

        valid_tasks, skipped_tasks = filter_valid_tasks(plans, mock_context, "test")

        assert len(valid_tasks) == 0
        assert len(skipped_tasks) == 0

    def test_filter_task_id_type_conversion(self, mock_context):
        """Test that task ID type conversion works correctly"""
        # Test with UUID object vs string comparison
        plans = [
            {
                "task_id": str(mock_context.task1_id),  # Ensure it's a string
                "estimated_hours": 2.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-11:00",
                "rationale": "String ID test",
            }
        ]

        valid_tasks, skipped_tasks = filter_valid_tasks(plans, mock_context, "test")

        assert len(valid_tasks) == 1
        assert len(skipped_tasks) == 0
        assert valid_tasks[0].task_title == "Valid Task 1"

    def test_context_label_in_logging(self, mock_context, caplog):
        """Test that context label appears in log messages"""
        plans = [
            {
                "task_id": "invalid-task-id",
                "estimated_hours": 1.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-10:00",
                "rationale": "Invalid task",
            }
        ]

        filter_valid_tasks(plans, mock_context, "custom-context")

        # Check that context label appears in log messages
        log_messages = [record.message for record in caplog.records]
        assert any("custom-context" in msg for msg in log_messages)

    def test_user_and_week_in_logging(self, mock_context, caplog):
        """Test that user ID and week date appear in log messages"""
        plans = [
            {
                "task_id": "invalid-task-id",
                "estimated_hours": 1.0,
                "priority": 1,
                "suggested_day": "Monday",
                "suggested_time_slot": "09:00-10:00",
                "rationale": "Invalid task",
            }
        ]

        filter_valid_tasks(plans, mock_context, "test")

        # Check that user and week info appear in log messages
        log_messages = [record.message for record in caplog.records]
        assert any(mock_context.user_id in msg for msg in log_messages)
        assert any(
            mock_context.week_start_date.strftime("%Y-%m-%d") in msg
            for msg in log_messages
        )
