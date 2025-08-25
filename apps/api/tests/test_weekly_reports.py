"""Tests for weekly report generation functionality."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock
from sqlmodel import Session

from humancompiler_api.ai.report_generator import WeeklyReportGenerator
from humancompiler_api.models import (
    WeeklyReportRequest,
    WeeklyReportResponse,
    WeeklyWorkSummary,
    ProjectProgressSummary,
    TaskProgressSummary,
    Log,
    Task,
    Goal,
    Project,
    User,
    TaskStatus,
)


class TestWeeklyReportGenerator:
    """Test cases for WeeklyReportGenerator class."""

    @pytest.fixture
    def report_generator(self):
        """Create a WeeklyReportGenerator instance."""
        return WeeklyReportGenerator()

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return Mock(spec=Session)

    @pytest.fixture
    def sample_user(self):
        """Create a sample user for testing."""
        return User(
            id="user-123",
            email="test@example.com",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

    @pytest.fixture
    def sample_project(self, sample_user):
        """Create a sample project for testing."""
        return Project(
            id="project-123",
            owner_id=sample_user.id,
            title="Test Project",
            description="Test project description",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

    @pytest.fixture
    def sample_goal(self, sample_project):
        """Create a sample goal for testing."""
        return Goal(
            id="goal-123",
            project_id=sample_project.id,
            title="Test Goal",
            description="Test goal description",
            estimate_hours=10.0,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

    @pytest.fixture
    def sample_task(self, sample_goal):
        """Create a sample task for testing."""
        return Task(
            id="task-123",
            goal_id=sample_goal.id,
            title="Test Task",
            description="Test task description",
            estimate_hours=5.0,
            status=TaskStatus.IN_PROGRESS,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

    @pytest.fixture
    def sample_log(self, sample_task):
        """Create a sample work log for testing."""
        return Log(
            id="log-123",
            task_id=sample_task.id,
            actual_minutes=120,
            comment="Test work done",
            created_at=datetime.now(),
        )

    def test_get_week_dates(self, report_generator):
        """Test week date calculation."""
        start_date, end_date = report_generator._get_week_dates("2023-12-18")  # Monday

        assert start_date == datetime(2023, 12, 18, 0, 0, 0)
        assert end_date == datetime(2023, 12, 24, 23, 59, 59)

    def test_calculate_task_progress_completed_task(
        self, report_generator, sample_task, sample_log, sample_goal, sample_project
    ):
        """Test task progress calculation for completed task."""
        sample_task.status = TaskStatus.COMPLETED
        sample_task.goal = sample_goal
        sample_goal.project = sample_project

        progress = report_generator._calculate_task_progress(sample_task, [sample_log])

        assert progress.task_id == str(sample_task.id)
        assert progress.task_title == sample_task.title
        assert progress.actual_minutes == 120
        assert (
            progress.completion_percentage == 40.0
        )  # 120 minutes / (5 hours * 60) * 100
        assert progress.status == TaskStatus.COMPLETED

    def test_calculate_task_progress_no_estimate(
        self, report_generator, sample_task, sample_log, sample_goal, sample_project
    ):
        """Test task progress calculation when no estimate provided."""
        sample_task.estimate_hours = 0
        sample_task.status = TaskStatus.COMPLETED
        sample_task.goal = sample_goal
        sample_goal.project = sample_project

        progress = report_generator._calculate_task_progress(sample_task, [sample_log])

        assert progress.completion_percentage == 100  # Completed task with no estimate

    def test_calculate_project_progress(
        self, report_generator, sample_project, sample_task, sample_log, sample_goal
    ):
        """Test project progress calculation."""
        sample_task.goal = sample_goal
        sample_goal.project = sample_project

        progress = report_generator._calculate_project_progress(
            sample_project, [sample_task], [sample_log]
        )

        assert progress.project_id == str(sample_project.id)
        assert progress.project_title == sample_project.title
        assert progress.total_estimated_hours == 5.0
        assert progress.total_actual_minutes == 120
        assert progress.total_tasks == 1

    def test_calculate_weekly_summary(self, report_generator, sample_task, sample_log):
        """Test weekly summary calculation."""
        start_date = datetime(2023, 12, 18)  # Monday

        summary = report_generator._calculate_weekly_summary(
            [sample_log], [sample_task], start_date
        )

        assert summary.total_actual_minutes == 120
        assert summary.total_estimated_hours == 5.0
        assert summary.total_tasks_worked == 1
        assert len(summary.daily_breakdown) == 7

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_generate_markdown_report_with_ai_success(
        self, mock_openai_class, report_generator
    ):
        """Test successful AI report generation."""
        # Mock OpenAI response
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "# Weekly Report\n\nTest content"
        mock_client.chat.completions.create.return_value = mock_response
        mock_openai_class.return_value = mock_client

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=120,
            total_estimated_hours=5.0,
            total_tasks_worked=1,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={},
            project_breakdown={},
        )

        result = report_generator._generate_markdown_report_with_ai(
            "test-api-key", "2023-12-18", work_summary, [], "gpt-4o-mini"
        )

        assert result == "# Weekly Report\n\nTest content"
        mock_client.chat.completions.create.assert_called_once()

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_generate_markdown_report_with_ai_failure_fallback(
        self, mock_openai_class, report_generator
    ):
        """Test AI report generation failure with fallback."""
        # Mock OpenAI to raise an exception
        mock_client = Mock()
        mock_client.chat.completions.create.side_effect = Exception("API Error")
        mock_openai_class.return_value = mock_client

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=120,
            total_estimated_hours=5.0,
            total_tasks_worked=1,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={"2023-12-18": 120},
            project_breakdown={"Test Project": 120},
        )

        result = report_generator._generate_markdown_report_with_ai(
            "test-api-key", "2023-12-18", work_summary, [], "gpt-4o-mini"
        )

        # Should fallback to basic markdown
        assert "# 週間作業報告書 (2023-12-18週)" in result
        assert "**週間合計作業時間**: 2.0時間" in result

    def test_generate_basic_markdown_report(self, report_generator):
        """Test basic markdown report generation."""
        work_summary = WeeklyWorkSummary(
            total_actual_minutes=120,
            total_estimated_hours=5.0,
            total_tasks_worked=1,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={"2023-12-18": 120},
            project_breakdown={"Test Project": 120},
        )

        result = report_generator._generate_basic_markdown_report(
            "2023-12-18", work_summary, []
        )

        assert "# 週間作業報告書 (2023-12-18週)" in result
        assert "**週間合計作業時間**: 2.0時間" in result
        assert "Test Project: 2.0時間" in result

    @patch.object(WeeklyReportGenerator, "_get_work_logs_for_week")
    def test_generate_weekly_report_no_logs(
        self, mock_get_logs, report_generator, mock_session
    ):
        """Test weekly report generation when no work logs exist."""
        mock_get_logs.return_value = []

        request = WeeklyReportRequest(week_start_date="2023-12-18", project_ids=None)

        result = report_generator.generate_weekly_report(
            mock_session, request, "user-123", "test-api-key", "gpt-4o-mini"
        )

        assert isinstance(result, WeeklyReportResponse)
        assert result.work_summary.total_actual_minutes == 0
        assert "作業実績なし" in result.markdown_report

    @patch.object(WeeklyReportGenerator, "_get_work_logs_for_week")
    @patch.object(WeeklyReportGenerator, "_generate_markdown_report_with_ai")
    def test_generate_weekly_report_with_data(
        self,
        mock_generate_ai,
        mock_get_logs,
        report_generator,
        mock_session,
        sample_user,
        sample_project,
        sample_goal,
        sample_task,
        sample_log,
    ):
        """Test weekly report generation with actual data."""
        # Setup relationships
        sample_log.task = sample_task
        sample_task.goal = sample_goal
        sample_goal.project = sample_project

        # Mock database queries
        mock_get_logs.return_value = [sample_log]
        mock_session.exec.return_value.all.return_value = [sample_task]
        mock_generate_ai.return_value = "# AI Generated Report"

        request = WeeklyReportRequest(
            week_start_date="2023-12-18", project_ids=[str(sample_project.id)]
        )

        result = report_generator.generate_weekly_report(
            mock_session, request, str(sample_user.id), "test-api-key", "gpt-4o-mini"
        )

        assert isinstance(result, WeeklyReportResponse)
        assert result.work_summary.total_actual_minutes == 120
        assert result.markdown_report == "# AI Generated Report"
        assert len(result.project_summaries) == 1


class TestWeeklyReportsAPI:
    """Test cases for weekly reports API endpoints."""

    def test_weekly_report_request_validation(self):
        """Test WeeklyReportRequest model validation."""
        # Valid request
        request = WeeklyReportRequest(
            week_start_date="2023-12-18", project_ids=["project-1", "project-2"]
        )
        assert request.week_start_date == "2023-12-18"
        assert request.project_ids == ["project-1", "project-2"]

        # Request without project_ids (optional)
        request2 = WeeklyReportRequest(week_start_date="2023-12-18")
        assert request2.project_ids is None

    def test_weekly_report_response_model(self):
        """Test WeeklyReportResponse model creation."""
        work_summary = WeeklyWorkSummary(
            total_actual_minutes=120,
            total_estimated_hours=5.0,
            total_tasks_worked=1,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={},
            project_breakdown={},
        )

        response = WeeklyReportResponse(
            week_start_date="2023-12-18",
            week_end_date="2023-12-24",
            work_summary=work_summary,
            project_summaries=[],
            markdown_report="# Test Report",
            generated_at=datetime.now(),
        )

        assert response.week_start_date == "2023-12-18"
        assert response.week_end_date == "2023-12-24"
        assert response.work_summary == work_summary
        assert response.markdown_report == "# Test Report"


class TestWeeklyReportErrorCases:
    """Test error handling in weekly report generation."""

    @pytest.fixture
    def report_generator(self):
        return WeeklyReportGenerator()

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_openai_api_key_error(self, mock_openai_class, report_generator):
        """Test handling of OpenAI API key authentication errors."""
        mock_client = Mock()
        mock_client.chat.completions.create.side_effect = Exception(
            "API key authentication failed"
        )
        mock_openai_class.return_value = mock_client

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=0,
            total_estimated_hours=0,
            total_tasks_worked=0,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={},
            project_breakdown={},
        )

        with patch.object(report_generator, "logger") as mock_logger:
            result = report_generator._generate_markdown_report_with_ai(
                "invalid-key", "2023-12-18", work_summary, [], "gpt-4o-mini"
            )

            # Should log the error and fallback to basic report
            mock_logger.error.assert_called()
            assert "週間作業報告書" in result

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_openai_rate_limit_error(self, mock_openai_class, report_generator):
        """Test handling of OpenAI rate limit errors."""
        mock_client = Mock()
        mock_client.chat.completions.create.side_effect = Exception(
            "rate limit exceeded for requests"
        )
        mock_openai_class.return_value = mock_client

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=0,
            total_estimated_hours=0,
            total_tasks_worked=0,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={},
            project_breakdown={},
        )

        with patch.object(report_generator, "logger") as mock_logger:
            result = report_generator._generate_markdown_report_with_ai(
                "test-key", "2023-12-18", work_summary, [], "gpt-4o-mini"
            )

            # Should log rate limit warning
            mock_logger.warning.assert_called()
            assert "週間作業報告書" in result

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_custom_model_usage(self, mock_openai_class, report_generator):
        """Test that custom OpenAI model is used correctly."""
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "# Custom Model Report"
        mock_client.chat.completions.create.return_value = mock_response
        mock_openai_class.return_value = mock_client

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=0,
            total_estimated_hours=0,
            total_tasks_worked=0,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={},
            project_breakdown={},
        )

        # Test with custom model
        result = report_generator._generate_markdown_report_with_ai(
            "test-key", "2023-12-18", work_summary, [], "gpt-4"
        )

        # Verify the custom model was used
        mock_client.chat.completions.create.assert_called_once()
        call_args = mock_client.chat.completions.create.call_args
        assert call_args.kwargs["model"] == "gpt-4"
        assert result == "# Custom Model Report"

    def test_invalid_week_start_date_format(self, report_generator):
        """Test handling of invalid date format."""
        with pytest.raises(ValueError):
            report_generator._get_week_dates("invalid-date")

    def test_empty_response_from_openai(self, report_generator):
        """Test handling when OpenAI returns empty response."""
        with patch.object(report_generator, "_get_openai_client") as mock_get_client:
            mock_client = Mock()
            mock_response = Mock()
            mock_response.choices = []
            mock_client.chat.completions.create.return_value = mock_response
            mock_get_client.return_value = mock_client

            work_summary = WeeklyWorkSummary(
                total_actual_minutes=0,
                total_estimated_hours=0,
                total_tasks_worked=0,
                total_completed_tasks=0,
                overall_completion_percentage=0.0,
                daily_breakdown={},
                project_breakdown={},
            )

            with patch.object(report_generator, "logger") as mock_logger:
                result = report_generator._generate_markdown_report_with_ai(
                    "test-key", "2023-12-18", work_summary, [], "gpt-4o-mini"
                )

                # Should log warning and use fallback
                mock_logger.warning.assert_called()
                assert "週間作業報告書" in result
