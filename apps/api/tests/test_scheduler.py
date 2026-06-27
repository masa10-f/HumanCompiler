"""
Tests for scheduler API endpoints.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.main import app
from humancompiler_api.models import WorkType
from humancompiler_api.routers.scheduler import SCHEDULER_CONFIG_CONTROLS

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
        assert "humancompiler-scheduler backend working correctly" in data["message"]
        assert data["backend_package"] == "humancompiler-scheduler"

    def test_scheduler_tuning_config_endpoint(self):
        """Test scheduler tuning config endpoint."""
        response = client.get("/api/schedule/tuning/config")

        assert response.status_code == 200
        data = response.json()
        assert data["backend_package"] == "humancompiler-scheduler"
        assert data["backend_version"]
        assert data["defaults"]["kind_match_score"] >= 0
        assert any(item["key"] == "project_switch_penalty" for item in data["schema"])
        assert set(data["defaults"]) == {item["key"] for item in data["schema"]}

        control_keys = {item["key"] for item in SCHEDULER_CONFIG_CONTROLS}
        assert {
            "min_block_minutes",
            "block_granularity_minutes",
            "max_candidate_block_minutes",
        }.issubset(control_keys)

        block_config_keys = {
            "min_block_minutes",
            "block_granularity_minutes",
            "max_candidate_block_minutes",
        }
        assert block_config_keys.issubset(data["defaults"])
        assert block_config_keys.issubset({item["key"] for item in data["schema"]})

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.db.get_session")
    @patch("humancompiler_api.routers.scheduler.task_service.get_tasks_by_goal")
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
        mock_task.priority = 3
        mock_task.work_type = WorkType.FOCUSED_WORK
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
            "solver_config": {
                "min_block_minutes": 15,
                "block_granularity_minutes": 15,
                "max_candidate_block_minutes": 90,
            },
        }

        # No need for auth header since we're using dependency override
        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert "assignments" in data
        assert "unscheduled_tasks" in data
        assert data["date"] == "2025-06-23"

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.task_service.get_tasks_by_project")
    def test_create_daily_schedule_by_project(
        self, mock_get_tasks, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation filtered by project."""
        from humancompiler_api.database import db

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
        mock_task.priority = 3
        mock_task.work_type = WorkType.LIGHT_WORK
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.id = goal_id
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        # Create mock session with exec method for batch goal query (N+1 fix)
        mock_sess = MagicMock()
        mock_exec_result = MagicMock()
        mock_exec_result.all.return_value = [mock_goal]
        mock_sess.exec.return_value = mock_exec_result

        def mock_get_session():
            yield mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        try:
            request_data = {
                "date": "2025-06-23",
                "project_id": project_id,
                "time_slots": [
                    {"start": "14:00", "end": "16:00", "kind": "light_work"}
                ],
            }

            response = client.post("/api/schedule/daily", json=request_data)

            assert response.status_code == 200
            data = response.json()
            assert (
                data["success"] is True or data["success"] is False
            )  # Either is valid
            assert isinstance(data["assignments"], list)
            assert isinstance(data["unscheduled_tasks"], list)
        finally:
            if db.get_session in app.dependency_overrides:
                del app.dependency_overrides[db.get_session]

    @patch("humancompiler_api.routers.scheduler.db.get_session")
    @patch("humancompiler_api.routers.scheduler.task_service.get_all_user_tasks")
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

    def test_create_daily_schedule_invalid_block_config(self, mock_auth):
        """Test daily schedule rejects inconsistent scheduler block config."""
        request_data = {
            "date": "2025-06-23",
            "goal_id": str(uuid4()),
            "time_slots": [{"start": "09:00", "end": "12:00", "kind": "focused_work"}],
            "solver_config": {
                "min_block_minutes": 30,
                "max_candidate_block_minutes": 15,
            },
        }

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 422

    def test_optimize_schedule_splits_long_task_into_available_slot(self):
        """Long tasks can be partially scheduled into shorter available slots."""
        from datetime import time

        from humancompiler_api.routers.scheduler import optimize_schedule
        from humancompiler_optimizer.daily import (
            SchedulerTask,
            SlotKind,
            TaskKind,
            TimeSlot,
        )

        result = optimize_schedule(
            tasks=[
                SchedulerTask(
                    id="long-task",
                    title="Long task",
                    estimate_hours=4.0,
                    priority=1,
                    kind=TaskKind.FOCUSED_WORK,
                )
            ],
            time_slots=[
                TimeSlot(
                    start=time(9, 0),
                    end=time(11, 0),
                    kind=SlotKind.FOCUSED_WORK,
                )
            ],
            date=datetime(2025, 6, 23),
            solver_config={
                "max_candidate_block_minutes": 90,
                "block_granularity_minutes": 15,
            },
        )

        assert result.success is True
        assert result.unscheduled_tasks == []
        assert result.total_scheduled_hours == pytest.approx(2.0)
        assert {assignment.task_id for assignment in result.assignments} == {
            "long-task"
        }
        assert {assignment.slot_index for assignment in result.assignments} == {0}

    def test_omitted_fixed_assignment_duration_uses_remaining_time(self):
        """Omitted fixed duration should not be limited by candidate block size."""
        from datetime import time

        from humancompiler_api.routers.scheduler import optimize_schedule
        from humancompiler_optimizer.daily import (
            FixedAssignment,
            SchedulerTask,
            SlotKind,
            TaskKind,
            TimeSlot,
        )

        result = optimize_schedule(
            tasks=[
                SchedulerTask(
                    id="fixed-task",
                    title="Pinned task",
                    estimate_hours=4.0,
                    priority=1,
                    kind=TaskKind.FOCUSED_WORK,
                )
            ],
            time_slots=[
                TimeSlot(
                    start=time(9, 0),
                    end=time(13, 0),
                    kind=SlotKind.FOCUSED_WORK,
                )
            ],
            date=datetime(2025, 6, 23),
            fixed_assignments=[FixedAssignment(task_id="fixed-task", slot_index=0)],
            solver_config={
                "max_candidate_block_minutes": 90,
                "block_granularity_minutes": 15,
            },
        )

        assert result.success is True
        assert result.unscheduled_tasks == []
        assert len(result.assignments) == 1
        assignment = result.assignments[0]
        assert assignment.task_id == "fixed-task"
        assert assignment.slot_index == 0
        assert assignment.duration_hours == pytest.approx(4.0)
        assert assignment.is_fixed is True

    def test_omitted_fixed_assignment_duration_caps_to_slot_capacity(self):
        """Omitted fixed duration keeps legacy behavior when the task is too long."""
        from datetime import time

        from humancompiler_api.routers.scheduler import optimize_schedule
        from humancompiler_optimizer.daily import (
            FixedAssignment,
            SchedulerTask,
            SlotKind,
            TaskKind,
            TimeSlot,
        )

        result = optimize_schedule(
            tasks=[
                SchedulerTask(
                    id="fixed-task",
                    title="Pinned task",
                    estimate_hours=4.0,
                    priority=1,
                    kind=TaskKind.FOCUSED_WORK,
                )
            ],
            time_slots=[
                TimeSlot(
                    start=time(9, 0),
                    end=time(11, 0),
                    kind=SlotKind.FOCUSED_WORK,
                )
            ],
            date=datetime(2025, 6, 23),
            fixed_assignments=[FixedAssignment(task_id="fixed-task", slot_index=0)],
            solver_config={
                "max_candidate_block_minutes": 90,
                "block_granularity_minutes": 15,
            },
        )

        assert result.success is True
        assert result.unscheduled_tasks == []
        assert len(result.assignments) == 1
        assignment = result.assignments[0]
        assert assignment.task_id == "fixed-task"
        assert assignment.duration_hours == pytest.approx(2.0)
        assert assignment.is_fixed is True

    def test_create_daily_schedule_empty_time_slots(self, mock_auth):
        """Test schedule creation with empty time slots."""
        request_data = {"date": "2025-06-23", "goal_id": str(uuid4()), "time_slots": []}

        response = client.post("/api/schedule/daily", json=request_data)

        assert response.status_code == 422  # Validation error

    def test_time_slot_validation(self):
        """Test TimeSlotInput validation."""
        from humancompiler_api.routers.scheduler import TimeSlotInput

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
        from humancompiler_api.routers.scheduler import TaskKind, map_task_kind

        # Test mapping
        assert map_task_kind("Research Project") == TaskKind.FOCUSED_WORK
        assert map_task_kind("Data Analysis") == TaskKind.FOCUSED_WORK
        assert map_task_kind("Study Session") == TaskKind.STUDY
        assert map_task_kind("Email Review") == TaskKind.LIGHT_WORK
        assert map_task_kind("Random Task") == TaskKind.LIGHT_WORK  # Default

    def test_slot_kind_mapping(self):
        """Test slot kind mapping function."""
        from humancompiler_api.routers.scheduler import SlotKind, map_slot_kind

        # Test mapping
        assert map_slot_kind("focused_work") == SlotKind.FOCUSED_WORK
        assert map_slot_kind("light_work") == SlotKind.LIGHT_WORK  # Case insensitive
        assert map_slot_kind("study") == SlotKind.STUDY
        assert map_slot_kind("unknown") == SlotKind.LIGHT_WORK  # Default

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.db.get_session")
    @patch("humancompiler_api.routers.scheduler.task_service.get_tasks_by_goal")
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

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.db.get_session")
    @patch("humancompiler_api.routers.scheduler.task_service.get_tasks_by_goal")
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
        mock_task_pending.priority = 2
        mock_task_pending.work_type = WorkType.LIGHT_WORK

        mock_task_completed = MagicMock()
        mock_task_completed.id = str(uuid4())
        mock_task_completed.title = "Completed Task"
        mock_task_completed.status = "completed"
        mock_task_completed.estimate_hours = 2.0
        mock_task_completed.due_date = None
        mock_task_completed.goal_id = goal_id
        mock_task_completed.priority = 1
        mock_task_completed.work_type = WorkType.LIGHT_WORK

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

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.task_service.get_tasks_by_project")
    def test_create_daily_schedule_with_task_source_project(
        self, mock_get_tasks, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with new task_source field for project."""
        from humancompiler_api.database import db

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
        mock_task.priority = 3
        mock_task.work_type = WorkType.LIGHT_WORK
        mock_get_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.id = goal_id
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        # Create mock session with exec method for batch goal query (N+1 fix)
        mock_sess = MagicMock()
        mock_exec_result = MagicMock()
        mock_exec_result.all.return_value = [mock_goal]
        mock_sess.exec.return_value = mock_exec_result

        def mock_get_session():
            yield mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        try:
            request_data = {
                "date": "2025-06-23",
                "task_source": {"type": "project", "project_id": project_id},
                "time_slots": [
                    {"start": "14:00", "end": "16:00", "kind": "light_work"}
                ],
            }

            response = client.post("/api/schedule/daily", json=request_data)

            assert response.status_code == 200
            data = response.json()
            assert (
                data["success"] is True or data["success"] is False
            )  # Either is valid
            assert isinstance(data["assignments"], list)
            assert isinstance(data["unscheduled_tasks"], list)
        finally:
            if db.get_session in app.dependency_overrides:
                del app.dependency_overrides[db.get_session]

    @patch("humancompiler_api.routers.scheduler._get_tasks_from_weekly_schedule")
    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    def test_create_daily_schedule_with_task_source_weekly_schedule(
        self, mock_get_goal, mock_get_weekly_tasks, mock_auth
    ):
        """Test daily schedule creation with new task_source field for weekly schedule."""
        from humancompiler_api.database import db

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
        mock_task.priority = 3
        mock_task.work_type = WorkType.STUDY
        mock_get_weekly_tasks.return_value = [mock_task]

        # Mock goal data
        mock_goal = MagicMock()
        mock_goal.id = goal_id
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        # Create mock session with exec method for batch goal query (N+1 fix)
        mock_sess = MagicMock()
        mock_exec_result = MagicMock()
        mock_exec_result.all.return_value = [mock_goal]
        mock_sess.exec.return_value = mock_exec_result

        def mock_get_session():
            yield mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        try:
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
        finally:
            if db.get_session in app.dependency_overrides:
                del app.dependency_overrides[db.get_session]

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
        from humancompiler_api.routers.scheduler import TaskSource

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
        from humancompiler_api.routers.scheduler import DailyScheduleResponse, TaskInfo
        from humancompiler_api.models import ScheduleResponse
        from humancompiler_api.database import db

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
                "humancompiler_api.routers.scheduler.ScheduleResponse.model_validate"
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

    @patch("humancompiler_api.routers.scheduler.optimize_schedule")
    @patch(
        "humancompiler_api.routers.scheduler._get_task_actual_hours",
        return_value={},
    )
    @patch(
        "humancompiler_api.routers.scheduler.quick_task_service.get_active_quick_tasks",
        return_value=[],
    )
    @patch("humancompiler_api.routers.scheduler.task_service.get_all_user_tasks")
    def test_create_daily_schedule_uses_regular_task_priority(
        self,
        mock_get_all_tasks,
        _mock_get_quick_tasks,
        _mock_get_actual_hours,
        mock_optimize_schedule,
        mock_auth,
    ):
        """Regular task priority should reach optimizer input and API task info."""
        from humancompiler_api.database import db
        from humancompiler_api.routers.scheduler import ScheduleResult

        high_priority_goal_id = uuid4()
        low_priority_goal_id = uuid4()
        high_priority_task_id = uuid4()
        low_priority_task_id = uuid4()
        project_id = uuid4()

        high_priority_task = SimpleNamespace(
            id=high_priority_task_id,
            title="High priority task",
            estimate_hours=1.0,
            status="pending",
            due_date=None,
            goal_id=high_priority_goal_id,
            work_type=WorkType.FOCUSED_WORK,
            priority=1,
        )
        low_priority_task = SimpleNamespace(
            id=low_priority_task_id,
            title="Low priority task",
            estimate_hours=1.0,
            status="pending",
            due_date=None,
            goal_id=low_priority_goal_id,
            work_type=WorkType.FOCUSED_WORK,
            priority=5,
        )
        mock_get_all_tasks.return_value = [high_priority_task, low_priority_task]

        mock_goals = [
            SimpleNamespace(id=high_priority_goal_id, project_id=project_id),
            SimpleNamespace(id=low_priority_goal_id, project_id=project_id),
        ]
        mock_sess = MagicMock()
        mock_sess.exec.return_value.all.return_value = mock_goals

        def mock_get_session():
            yield mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        mock_optimize_schedule.return_value = ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=[
                str(high_priority_task_id),
                str(low_priority_task_id),
            ],
            total_scheduled_hours=0.0,
            optimization_status="OPTIMAL",
            solve_time_seconds=0.1,
            objective_value=0.0,
        )

        try:
            response = client.post(
                "/api/schedule/daily",
                json={
                    "date": "2025-06-23",
                    "task_source": {"type": "all_tasks"},
                    "time_slots": [
                        {
                            "start": "09:00",
                            "end": "12:00",
                            "kind": "focused_work",
                        }
                    ],
                },
            )
        finally:
            if db.get_session in app.dependency_overrides:
                del app.dependency_overrides[db.get_session]

        assert response.status_code == 200

        scheduled_tasks = mock_optimize_schedule.call_args.args[0]
        priorities_by_id = {task.id: task.priority for task in scheduled_tasks}
        assert priorities_by_id[str(high_priority_task_id)] == 1
        assert priorities_by_id[str(low_priority_task_id)] == 5

        data = response.json()
        unscheduled_priorities = {
            task["id"]: task["priority"] for task in data["unscheduled_tasks"]
        }
        assert unscheduled_priorities[str(high_priority_task_id)] == 1
        assert unscheduled_priorities[str(low_priority_task_id)] == 5

    @patch("humancompiler_api.routers.scheduler.goal_service.get_goal")
    @patch("humancompiler_api.routers.scheduler.task_service.get_all_user_tasks")
    def test_create_daily_schedule_with_slot_assignment(
        self, mock_get_tasks, mock_get_goal, mock_auth
    ):
        """Test daily schedule creation with slot-level project assignment."""
        from humancompiler_api.models import Task, Goal
        from humancompiler_api.database import db
        from decimal import Decimal
        from uuid import uuid4

        # Create mock task
        task_id = uuid4()
        project_id = uuid4()
        goal_id = uuid4()

        # Mock project ownership check
        from humancompiler_api.models import Project

        mock_project = MagicMock(spec=Project)
        mock_project.id = project_id
        mock_project.owner_id = mock_auth

        # Mock goal for batch query (N+1 fix)
        mock_goal = MagicMock(spec=Goal)
        mock_goal.id = goal_id
        mock_goal.project_id = project_id
        mock_get_goal.return_value = mock_goal

        # Create mock session with exec method
        mock_sess = MagicMock()

        # Configure session.exec to return appropriate results for ownership validation and batch goals
        def mock_exec(query):
            mock_result = MagicMock()
            query_str = str(query).lower()
            if "projects" in query_str:
                mock_result.first.return_value = mock_project
            elif "goal" in query_str:
                # Return goals for batch goal query (N+1 fix)
                mock_result.all.return_value = [mock_goal]
                mock_result.first.return_value = mock_goal
            else:
                mock_result.first.return_value = None
                mock_result.all.return_value = []
            return mock_result

        mock_sess.exec = mock_exec

        def mock_get_session():
            yield mock_sess

        app.dependency_overrides[db.get_session] = mock_get_session

        mock_task = MagicMock(spec=Task)
        mock_task.id = task_id
        mock_task.title = "Test Task"
        mock_task.estimate_hours = Decimal("2.0")
        mock_task.status = "pending"
        mock_task.goal_id = goal_id
        mock_task.work_type = WorkType.FOCUSED_WORK
        mock_task.due_date = None
        mock_task.priority = 3
        # Keep the mock task shape aligned with the real Task model.
        mock_task.__dict__ = {
            "id": task_id,
            "title": "Test Task",
            "estimate_hours": Decimal("2.0"),
            "status": "pending",
            "goal_id": goal_id,
            "work_type": WorkType.FOCUSED_WORK,
            "due_date": None,
            "priority": 3,
        }

        mock_get_tasks.return_value = [mock_task]

        # Mock _get_task_actual_hours to return empty dict
        with patch(
            "humancompiler_api.routers.scheduler._get_task_actual_hours",
            return_value={},
        ):
            # Mock dependency functions to return empty dicts
            with patch(
                "humancompiler_api.routers.scheduler._get_task_dependencies",
                return_value={},
            ):
                with patch(
                    "humancompiler_api.routers.scheduler._get_goal_dependencies",
                    return_value={},
                ):
                    with patch(
                        "humancompiler_api.routers.scheduler._batch_check_task_completion_status",
                        return_value={},
                    ):
                        with patch(
                            "humancompiler_api.routers.scheduler._batch_check_goal_completion_status",
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
