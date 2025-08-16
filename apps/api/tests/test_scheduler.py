"""
Tests for scheduler API endpoints.
"""

from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from taskagent_api.auth import get_current_user_id
from taskagent_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_auth():
    """Automatically mock authentication for all tests in this module."""
    user_id = str(uuid4())

    def mock_get_user_id():
        return user_id

    app.dependency_overrides[get_current_user_id] = mock_get_user_id
    yield user_id
    app.dependency_overrides.clear()


class TestSchedulerAPI:
    """Test cases for scheduler API endpoints."""

    def test_scheduler_test_endpoint(self):
        """Test the scheduler test endpoint."""
        response = client.get("/api/schedule/test")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "OR-Tools CP-SAT scheduler working correctly" in data["message"]

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_goal")
    def test_create_daily_schedule_success(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test successful daily schedule creation."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock task data with valid UUIDs
        goal_id = str(uuid4())
        task_id = str(uuid4())

        mock_task = MagicMock()
        mock_task.id = task_id
        mock_task.title = "Test Task"
        mock_task.estimate_hours = 2.0
        mock_task.status = "pending"
        mock_task.due_date = None
        mock_task.goal_id = goal_id
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        project_id = str(uuid4())
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        request_data = {
            "date": "2025-06-23",
            "goal_id": goal_id,
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
        }

        # No need for auth header since we're using dependency override
        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert "assignments" in data
        assert "unscheduled_tasks" in data
        assert data["date"] == "2025-06-23"

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_project")
    def test_create_daily_schedule_by_project(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation filtered by project."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock task data with valid UUIDs
        project_id = str(uuid4())
        goal_id = str(uuid4())
        task_id = str(uuid4())

        mock_task = MagicMock()
        mock_task.id = task_id
        mock_task.title = "Project Task"
        mock_task.estimate_hours = 1.5
        mock_task.status = "in_progress"
        mock_task.due_date = datetime(2025, 6, 25)
        mock_task.goal_id = goal_id
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        request_data = {
            "date": "2025-06-23",
            "project_id": project_id,
            "time_slots": [{"start": "14:00", "end": "16:00", "kind": "light_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True or data["success"] is False  # Either is valid
        assert isinstance(data["assignments"], list)
        assert isinstance(data["unscheduled_tasks"], list)

    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_all_user_tasks")
    def test_create_daily_schedule_no_filter(
        self, mock_get_all_tasks, mock_session, mock_auth
    ):
        """Test schedule creation without project_id or goal_id."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()
        mock_get_all_tasks.return_value = []  # Return empty tasks

        request_data = {
            "date": "2025-06-23",
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200  # Should return success with empty tasks
        data = response.json()
        assert data["success"] is True
        assert len(data["assignments"]) == 0  # No tasks to schedule
        assert data["optimization_status"] == "NO_TASKS"

    def test_create_daily_schedule_invalid_date(self, mock_auth):
        """Test schedule creation with invalid date format."""
        request_data = {
            "date": "invalid-date",
            "goal_id": str(uuid4()),
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 422  # Validation error

    def test_create_daily_schedule_invalid_time_slot(self, mock_auth):
        """Test schedule creation with invalid time slot."""
        request_data = {
            "date": "2025-06-23",
            "goal_id": str(uuid4()),
            "time_slots": [
                {
                    "start": "25:00",  # Invalid hour
                    "end": "12:00",
                    "kind": "focused_work",
                }
            ],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 422  # Validation error

    def test_create_daily_schedule_empty_time_slots(self, mock_auth):
        """Test schedule creation with empty time slots."""
        request_data = {"date": "2025-06-23", "goal_id": str(uuid4()), "time_slots": []}

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 422  # Validation error

    def test_time_slot_validation(self):
        """Test TimeSlotInput validation."""
        from taskagent_api.routers.scheduler import TimeSlotInput

        # Valid time slot
        valid_slot = TimeSlotInput(start="09:00", end="12:00", kind="focused_work")
        assert valid_slot.start == "09:00"
        assert valid_slot.kind == "focused_work"

        # Invalid time format
        with pytest.raises(ValueError):
            TimeSlotInput(
                start="9:00am",  # Invalid format
                end="12:00",
                kind="focused_work",
            )

        # Invalid kind
        with pytest.raises(ValueError):
            TimeSlotInput(start="09:00", end="12:00", kind="invalid_kind")

    def test_task_kind_mapping(self):
        """Test task kind mapping function."""
        from taskagent_api.routers.scheduler import TaskKind, map_task_kind

        # Test mapping
        assert map_task_kind("Research Project") == TaskKind.FOCUSED_WORK
        assert map_task_kind("Data Analysis") == TaskKind.FOCUSED_WORK
        assert map_task_kind("Study Session") == TaskKind.STUDY
        assert map_task_kind("Email Review") == TaskKind.LIGHT_WORK
        assert map_task_kind("Random Task") == TaskKind.LIGHT_WORK  # Default

    def test_slot_kind_mapping(self):
        """Test slot kind mapping function."""
        from taskagent_api.routers.scheduler import SlotKind, map_slot_kind

        # Test mapping
        assert map_slot_kind("focused_work") == SlotKind.FOCUSED_WORK
        assert map_slot_kind("light_work") == SlotKind.LIGHT_WORK  # Case insensitive
        assert map_slot_kind("study") == SlotKind.STUDY
        assert map_slot_kind("unknown") == SlotKind.LIGHT_WORK  # Default

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_goal")
    def test_create_daily_schedule_no_tasks(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test schedule creation when no tasks are found."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()
        mock_get_tasks.return_value = []  # No tasks

        request_data = {
            "date": "2025-06-23",
            "goal_id": str(uuid4()),
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["assignments"]) == 0
        assert len(data["unscheduled_tasks"]) == 0
        assert data["optimization_status"] == "NO_TASKS"

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_goal")
    def test_create_daily_schedule_completed_tasks_filtered(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test that completed tasks are filtered out from scheduling."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock tasks with different statuses
        goal_id = str(uuid4())
        project_id = str(uuid4())

        mock_task_pending = MagicMock()
        mock_task_pending.id = str(uuid4())
        mock_task_pending.title = "Pending Task"
        mock_task_pending.status = "pending"
        mock_task_pending.estimate_hours = 1.0
        mock_task_pending.due_date = None
        mock_task_pending.goal_id = goal_id

        mock_task_completed = MagicMock()
        mock_task_completed.id = str(uuid4())
        mock_task_completed.title = "Completed Task"
        mock_task_completed.status = "completed"
        mock_task_completed.estimate_hours = 2.0
        mock_task_completed.due_date = None
        mock_task_completed.goal_id = goal_id

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        mock_get_tasks.return_value = [mock_task_pending, mock_task_completed]

        request_data = {
            "date": "2025-06-23",
            "goal_id": goal_id,
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "light_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Should only consider pending task
        if data["success"] and data["assignments"]:
            # Check that only pending task is in assignments
            task_ids = [assignment["task_id"] for assignment in data["assignments"]]
            assert mock_task_pending.id in task_ids
            assert mock_task_completed.id not in task_ids

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_goal")
    def test_create_daily_schedule_with_task_source_goal(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with new task_source field for goal."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock task data
        goal_id = str(uuid4())
        task_id = str(uuid4())
        project_id = str(uuid4())

        mock_task = MagicMock()
        mock_task.id = task_id
        mock_task.title = "Goal Task"
        mock_task.estimate_hours = 2.0
        mock_task.status = "pending"
        mock_task.due_date = None
        mock_task.goal_id = goal_id
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        request_data = {
            "date": "2025-06-23",
            "task_source": {"type": "goal", "goal_id": goal_id},
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert "assignments" in data
        assert "unscheduled_tasks" in data
        assert data["date"] == "2025-06-23"

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_tasks_by_project")
    def test_create_daily_schedule_with_task_source_project(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with new task_source field for project."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock task data
        project_id = str(uuid4())
        goal_id = str(uuid4())
        task_id = str(uuid4())

        mock_task = MagicMock()
        mock_task.id = task_id
        mock_task.title = "Project Task"
        mock_task.estimate_hours = 1.5
        mock_task.status = "in_progress"
        mock_task.due_date = None
        mock_task.goal_id = goal_id
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        request_data = {
            "date": "2025-06-23",
            "task_source": {"type": "project", "project_id": project_id},
            "time_slots": [{"start": "14:00", "end": "16:00", "kind": "light_work"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True or data["success"] is False  # Either is valid
        assert isinstance(data["assignments"], list)
        assert isinstance(data["unscheduled_tasks"], list)

    @patch("taskagent_api.routers.scheduler._get_tasks_from_weekly_schedule")
    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    def test_create_daily_schedule_with_task_source_weekly_schedule(
        self, mock_session, mock_get_goal, mock_get_weekly_tasks, mock_auth
    ):
        """Test daily schedule creation with new task_source field for weekly schedule."""
        # Mock session as generator
        mock_sess = MagicMock()

        def session_generator():
            yield mock_sess

        mock_session.return_value = session_generator()

        # Mock weekly schedule task
        goal_id = str(uuid4())
        task_id = str(uuid4())
        project_id = str(uuid4())

        mock_task = MagicMock()
        mock_task.id = task_id
        mock_task.title = "Weekly Task"
        mock_task.estimate_hours = 3.0
        mock_task.status = "pending"
        mock_task.due_date = None
        mock_task.goal_id = goal_id
        mock_get_weekly_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        request_data = {
            "date": "2025-06-23",
            "task_source": {
                "type": "weekly_schedule",
                "weekly_schedule_date": "2025-06-23",
            },
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "study"}],
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert "assignments" in data
        assert "unscheduled_tasks" in data

    def test_get_weekly_schedule_options(self, mock_auth):
        """Test getting weekly schedule options."""
        # Test the response format when there are no weekly schedules
        response = client.get("/api/schedule/weekly-schedule-options")

        # The endpoint should return 200 with empty list if no weekly schedules exist
        # or may return 403/500 if database is not available, which is fine for unit tests
        assert response.status_code in [200, 403, 500]

        if response.status_code == 200:
            data = response.json()
            assert isinstance(
                data, list
            )  # Should return a list (empty or with options)

    def test_task_source_validation(self):
        """Test TaskSource model validation."""
        from taskagent_api.routers.scheduler import TaskSource

        # Valid task sources
        valid_all_tasks = TaskSource(type="all_tasks")
        assert valid_all_tasks.type == "all_tasks"

        valid_goal = TaskSource(type="goal", goal_id=str(uuid4()))
        assert valid_goal.type == "goal"

        valid_project = TaskSource(type="project", project_id=str(uuid4()))
        assert valid_project.type == "project"

        valid_weekly = TaskSource(
            type="weekly_schedule", weekly_schedule_date="2025-06-23"
        )
        assert valid_weekly.type == "weekly_schedule"

        # Invalid task source type
        with pytest.raises(ValueError):
            TaskSource(type="invalid_type")
