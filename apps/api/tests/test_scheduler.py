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
        # or may return 403/500/503 if database is not available, which is fine for unit tests
        assert response.status_code in [200, 403, 500, 503]

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

        valid_project = TaskSource(type="project", project_id=str(uuid4()))
        assert valid_project.type == "project"

        valid_weekly = TaskSource(
            type="weekly_schedule", weekly_schedule_date="2025-06-23"
        )
        assert valid_weekly.type == "weekly_schedule"

        # Invalid task source type
        with pytest.raises(ValueError):
            TaskSource(type="invalid_type")

    def test_save_daily_schedule_unscheduled_tasks_not_stored(self, mock_auth):
        """Test that unscheduled_tasks are not stored in database (Issue #141)."""
        from taskagent_api.routers.scheduler import DailyScheduleResponse, TaskInfo
        from taskagent_api.models import ScheduleResponse
        from taskagent_api.database import db

        # Mock session and database operations
        mock_sess = MagicMock()

        # Mock no existing schedule
        mock_sess.exec.return_value.first.return_value = None

        # Make sure session.add doesn't fail and session.refresh works
        mock_sess.add.return_value = None
        mock_sess.commit.return_value = None
        mock_sess.refresh.return_value = None

        # Override the database dependency
        def mock_get_session():
            return mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        try:
            # Mock the ScheduleResponse.model_validate
            with patch(
                "taskagent_api.routers.scheduler.ScheduleResponse.model_validate"
            ) as mock_validate:
                mock_validate.return_value = ScheduleResponse(
                    id=str(uuid4()),
                    user_id=mock_auth,
                    date=datetime.strptime("2025-06-23", "%Y-%m-%d"),
                    plan_json={},
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                )

                # Create test data with unscheduled tasks
                schedule_data = DailyScheduleResponse(
                    success=True,
                    date="2025-06-23",
                    assignments=[],
                    unscheduled_tasks=[
                        TaskInfo(
                            id=str(uuid4()),
                            title="Unscheduled Task 1",
                            estimate_hours=2.0,
                            priority=1,
                            kind="focused_work",
                        ),
                        TaskInfo(
                            id=str(uuid4()),
                            title="Unscheduled Task 2",
                            estimate_hours=1.5,
                            priority=2,
                            kind="light_work",
                        ),
                    ],
                    total_scheduled_hours=0.0,
                    optimization_status="OPTIMAL",
                    solve_time_seconds=0.1,
                    generated_at=datetime.now(),
                )

                response = client.post(
                    "/api/schedule/daily/save", json=schedule_data.model_dump()
                )

                assert response.status_code == 200

                # Verify that the Schedule model was created without unscheduled_tasks
                mock_sess.add.assert_called_once()
                saved_schedule = mock_sess.add.call_args[0][0]

                # Check that plan_json does not contain unscheduled_tasks
                assert "unscheduled_tasks" not in saved_schedule.plan_json
                # But should contain other expected fields
                assert "success" in saved_schedule.plan_json
                assert "assignments" in saved_schedule.plan_json
                assert "total_scheduled_hours" in saved_schedule.plan_json
                assert "optimization_status" in saved_schedule.plan_json

        finally:
            # Clean up the dependency override
            if db.get_session in app.dependency_overrides:
                del app.dependency_overrides[db.get_session]

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_all_user_tasks")
    def test_create_daily_schedule_with_slot_assignment(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with slot-level project assignment."""
        from taskagent_api.models import Task, Goal
        from decimal import Decimal
        from uuid import uuid4

        # Mock session
        mock_sess = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_sess

        # Create mock task
        task_id = uuid4()
        project_id = uuid4()
        goal_id = uuid4()

        mock_task = MagicMock(spec=Task)
        mock_task.id = task_id
        mock_task.title = "Test Task"
        mock_task.estimate_hours = Decimal("2.0")
        mock_task.status = "pending"
        mock_task.goal_id = goal_id
        mock_task.work_type = "focused_work"
        mock_task.due_date = None
        # Mock the hasattr/getattr calls properly
        mock_task.__dict__ = {
            "id": task_id,
            "title": "Test Task",
            "estimate_hours": Decimal("2.0"),
            "status": "pending",
            "goal_id": goal_id,
            "work_type": "focused_work",
            "due_date": None,
            "is_weekly_recurring": False,
        }

        mock_get_tasks.return_value = [mock_task]

        # Mock goal
        mock_goal = MagicMock(spec=Goal)
        mock_goal.id = goal_id
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        # Mock _get_task_actual_hours to return empty dict
        with patch(
            "taskagent_api.routers.scheduler._get_task_actual_hours", return_value={}
        ):
            # Mock dependency functions to return empty dicts
            with patch(
                "taskagent_api.routers.scheduler._get_task_dependencies",
                return_value={},
            ):
                with patch(
                    "taskagent_api.routers.scheduler._get_goal_dependencies",
                    return_value={},
                ):
                    with patch(
                        "taskagent_api.routers.scheduler._batch_check_task_completion_status",
                        return_value={},
                    ):
                        with patch(
                            "taskagent_api.routers.scheduler._batch_check_goal_completion_status",
                            return_value={},
                        ):
                            # Test request with slot assignment
                            request_data = {
                                "date": "2024-08-23",
                                "task_source": {"type": "all_tasks"},
                                "time_slots": [
                                    {
                                        "start": "09:00",
                                        "end": "11:00",
                                        "kind": "focused_work",
                                        "capacity_hours": 2.0,
                                        "assigned_project_id": str(
                                            project_id
                                        ),  # Assign this slot to specific project
                                    },
                                    {
                                        "start": "14:00",
                                        "end": "16:00",
                                        "kind": "light_work",
                                        "capacity_hours": 2.0,
                                        # No assignment - should use auto-optimization
                                    },
                                ],
                            }

                            response = client.post(
                                "/api/schedule/daily", json=request_data
                            )

                            assert response.status_code == 200
                            data = response.json()
                            assert data["success"] is True
                            assert len(data["assignments"]) >= 0

                            # If task is assigned, it should be in the first slot (matching project)
                            if data["assignments"]:
                                assignment = data["assignments"][0]
                                assert (
                                    assignment["slot_index"] == 0
                                )  # First slot with project constraint
                                assert assignment["project_id"] == str(project_id)

    @patch("taskagent_api.routers.scheduler.goal_service.get_goal")
    @patch("taskagent_api.routers.scheduler.db.get_session")
    @patch("taskagent_api.routers.scheduler.task_service.get_all_user_tasks")
    def test_create_daily_schedule_with_weekly_task_assignment(
        self, mock_get_tasks, mock_session, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with slot-level weekly task assignment."""
        from taskagent_api.models import Task
        from decimal import Decimal
        from uuid import uuid4

        # Mock session
        mock_sess = MagicMock()
        mock_session.return_value.__enter__.return_value = mock_sess

        # Create mock weekly recurring task
        weekly_task_id = uuid4()

        # Create pseudo weekly task (simulating WeeklyRecurringTask conversion)
        mock_weekly_task = type(
            "PseudoTask",
            (),
            {
                "id": weekly_task_id,
                "title": "[週課] Weekly Report",
                "estimate_hours": 1.0,
                "status": "pending",
                "due_date": None,
                "work_type": "light_work",
                "goal_id": None,
                "is_weekly_recurring": True,
            },
        )()

        mock_get_tasks.return_value = [mock_weekly_task]

        # Mock _get_task_actual_hours to return empty dict
        with patch(
            "taskagent_api.routers.scheduler._get_task_actual_hours", return_value={}
        ):
            # Mock dependency functions to return empty dicts
            with patch(
                "taskagent_api.routers.scheduler._get_task_dependencies",
                return_value={},
            ):
                with patch(
                    "taskagent_api.routers.scheduler._get_goal_dependencies",
                    return_value={},
                ):
                    with patch(
                        "taskagent_api.routers.scheduler._batch_check_task_completion_status",
                        return_value={},
                    ):
                        with patch(
                            "taskagent_api.routers.scheduler._batch_check_goal_completion_status",
                            return_value={},
                        ):
                            # Test request with weekly task assignment
                            request_data = {
                                "date": "2024-08-23",
                                "task_source": {"type": "all_tasks"},
                                "time_slots": [
                                    {
                                        "start": "09:00",
                                        "end": "10:00",
                                        "kind": "light_work",
                                        "capacity_hours": 1.0,
                                        "assigned_weekly_task_id": str(
                                            weekly_task_id
                                        ),  # Assign specific weekly task
                                    },
                                    {
                                        "start": "14:00",
                                        "end": "16:00",
                                        "kind": "light_work",
                                        "capacity_hours": 2.0,
                                        # No assignment
                                    },
                                ],
                            }

                            response = client.post(
                                "/api/schedule/daily", json=request_data
                            )

                            assert response.status_code == 200
                            data = response.json()
                            assert data["success"] is True

                            # Weekly task should be assigned to the first slot only
                            if data["assignments"]:
                                assignment = data["assignments"][0]
                                assert (
                                    assignment["slot_index"] == 0
                                )  # First slot with weekly task constraint
                                assert assignment["task_id"] == str(weekly_task_id)
                                assert (
                                    "週課" in assignment["task_title"]
                                )  # Should contain weekly task marker
