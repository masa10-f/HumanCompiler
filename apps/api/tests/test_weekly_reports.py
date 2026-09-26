"""Tests for weekly report generation functionality."""

import pytest
from datetime import datetime
from unittest.mock import Mock, patch
from sqlmodel import Session

from humancompiler_api.ai.report_generator import (
    ReportBackground,
    WeeklyReportGenerator,
)
from humancompiler_api.models import (
    WeeklyReportNoteReference,
    WeeklyReportRequest,
    WeeklyReportResponse,
    WeeklyWorkSummary,
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
            "test-api-key", "2023-12-18", work_summary, [], "gpt-5.4-mini"
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
            "test-api-key", "2023-12-18", work_summary, [], "gpt-5.4-mini"
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
            mock_session, request, "user-123", "test-api-key", "gpt-5.4-mini"
        )

        assert isinstance(result, WeeklyReportResponse)
        assert result.work_summary.total_actual_minutes == 0
        assert "作業実績なし" in result.markdown_report

    @patch.object(WeeklyReportGenerator, "_collect_report_background")
    @patch.object(WeeklyReportGenerator, "_get_work_logs_for_week")
    @patch.object(WeeklyReportGenerator, "_generate_markdown_report_with_ai")
    def test_generate_weekly_report_with_data(
        self,
        mock_generate_ai,
        mock_get_logs,
        mock_collect_background,
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
        note_reference = WeeklyReportNoteReference(
            entity_type="project",
            entity_id=str(sample_project.id),
            title=sample_project.title,
            project_id=str(sample_project.id),
        )
        background = ReportBackground(referenced_notes=[note_reference])
        mock_collect_background.return_value = background

        request = WeeklyReportRequest(
            week_start_date="2023-12-18", project_ids=[str(sample_project.id)]
        )

        result = report_generator.generate_weekly_report(
            mock_session, request, str(sample_user.id), "test-api-key", "gpt-5.4-mini"
        )

        assert isinstance(result, WeeklyReportResponse)
        assert result.work_summary.total_actual_minutes == 120
        assert result.markdown_report == "# AI Generated Report"
        assert len(result.project_summaries) == 1
        assert result.referenced_notes == [note_reference]
        mock_collect_background.assert_called_once_with(
            mock_session, str(sample_user.id), [sample_task], [sample_project], True
        )
        assert mock_generate_ai.call_args.args[-1] is background


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

        # Request without project_ids (optional); notes are used by default
        request2 = WeeklyReportRequest(week_start_date="2023-12-18")
        assert request2.project_ids is None
        assert request2.include_notes is True

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
                "invalid-key", "2023-12-18", work_summary, [], "gpt-5.4-mini"
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
                "test-key", "2023-12-18", work_summary, [], "gpt-5.4-mini"
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
            "test-key", "2023-12-18", work_summary, [], "gpt-5.4-nano"
        )

        # Verify the custom model was used
        mock_client.chat.completions.create.assert_called_once()
        call_args = mock_client.chat.completions.create.call_args
        assert call_args.kwargs["model"] == "gpt-5.4-nano"
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
                    "test-key", "2023-12-18", work_summary, [], "gpt-5.4-mini"
                )

                # Should log warning and use fallback
                mock_logger.warning.assert_called()
                assert "週間作業報告書" in result


TIPTAP_TASK_NOTE = (
    "<h2>方針</h2><p>週報の&amp;下書きを自動化する</p>"
    '<ul data-type="taskList">'
    '<li data-checked="true" data-type="taskItem"><label>'
    '<input type="checkbox" checked="checked"><span></span></label>'
    "<div><p>API設計</p></div></li>"
    '<li data-checked="false" data-type="taskItem"><label>'
    '<input type="checkbox"><span></span></label>'
    "<div><p>UI実装</p></div></li></ul>"
)


class TestNoteText:
    """Plain-text conversion of editor notes for the report prompt."""

    def test_converts_tiptap_html_to_markdown_like_text(self):
        from humancompiler_api.ai.note_text import note_to_plain_text

        text = note_to_plain_text(TIPTAP_TASK_NOTE, "html")

        assert text == "## 方針\n週報の&下書きを自動化する\n- [x] API設計\n- [ ] UI実装"

    def test_keeps_list_nesting_and_line_breaks(self):
        from humancompiler_api.ai.note_text import note_to_plain_text

        html = (
            "<ul><li><p>親</p><ul><li><p>子</p></li></ul></li></ul>"
            "<p>一行目<br>二行目</p><p></p>"
        )

        assert note_to_plain_text(html, "html") == "- 親\n  - 子\n一行目\n二行目"

    def test_detects_html_saved_with_markdown_type(self):
        from humancompiler_api.ai.note_text import note_to_plain_text

        assert note_to_plain_text("<p>背景メモ</p>", "markdown") == "背景メモ"

    def test_returns_markdown_and_empty_content_as_is(self):
        from humancompiler_api.ai.note_text import note_to_plain_text

        assert note_to_plain_text("  # 見出し\n- a  ", "markdown") == "# 見出し\n- a"
        assert note_to_plain_text("<p></p>", "html") == ""
        assert note_to_plain_text(None, "html") == ""

    def test_truncate_text_marks_the_cut(self):
        from humancompiler_api.ai.note_text import truncate_text

        assert truncate_text("abc", 5) == "abc"
        assert truncate_text("abcdef", 3) == "abc…（以下省略）"


@pytest.fixture
def report_workspace(session: Session):
    """A user's project with notes, worked tasks, and open tasks."""
    from datetime import UTC
    from decimal import Decimal
    from uuid import uuid4

    from humancompiler_api.models import ContextNote, GoalStatus

    user = User(id=uuid4(), email="report-owner@example.com")
    other_user = User(id=uuid4(), email="report-other@example.com")
    project = Project(
        id=uuid4(),
        owner_id=user.id,
        title="週報自動化",
        description="チームの週報作成の手間を減らす",
    )
    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="報告書生成",
        description="週報の下書きを自動生成する",
        estimate_hours=Decimal("10.00"),
        due_date=datetime(2030, 1, 31, 15, 0, tzinfo=UTC),
    )
    done_goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="調査",
        estimate_hours=Decimal("2.00"),
        status=GoalStatus.COMPLETED,
    )
    worked_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="プロンプト改修",
        estimate_hours=Decimal("3.00"),
        status=TaskStatus.IN_PROGRESS,
        memo="出力形式を三点セットにする",
    )
    pending_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="フロント表示",
        estimate_hours=Decimal("2.00"),
        status=TaskStatus.PENDING,
        priority=1,
        due_date=datetime(2030, 1, 19, 15, 0, tzinfo=UTC),  # 2030-01-20 JST
    )
    completed_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="完了済み",
        estimate_hours=Decimal("1.00"),
        status=TaskStatus.COMPLETED,
    )
    task_in_done_goal = Task(
        id=uuid4(),
        goal_id=done_goal.id,
        title="残骸タスク",
        estimate_hours=Decimal("1.00"),
        status=TaskStatus.PENDING,
    )
    review_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="レビュー依頼",
        estimate_hours=Decimal("1.00"),
        status=TaskStatus.PENDING,
        priority=4,
    )
    docs_task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="ドキュメント",
        estimate_hours=Decimal("1.00"),
        status=TaskStatus.PENDING,
        priority=5,
    )
    notes = [
        ContextNote(
            user_id=user.id,
            project_id=project.id,
            content="<p>経営会議で週報の標準化が決まった</p>",
            content_type="html",
        ),
        ContextNote(
            user_id=user.id,
            goal_id=goal.id,
            content="# ゴールメモ\n- 月末までにリリース",
            content_type="markdown",
        ),
        ContextNote(
            user_id=user.id,
            task_id=worked_task.id,
            content=TIPTAP_TASK_NOTE,
            content_type="html",
        ),
        ContextNote(
            user_id=user.id,
            task_id=pending_task.id,
            content="<p>デザインはFigma参照</p>",
            content_type="html",
        ),
        # Notes of excluded tasks, foreign notes, and empty notes are not context
        ContextNote(
            user_id=user.id,
            task_id=task_in_done_goal.id,
            content="<p>完了ゴールのノート</p>",
            content_type="html",
        ),
        ContextNote(
            user_id=other_user.id,
            task_id=review_task.id,
            content="<p>他人のノート</p>",
            content_type="html",
        ),
        ContextNote(
            user_id=user.id,
            task_id=docs_task.id,
            content="<p></p>",
            content_type="html",
        ),
    ]
    session.add_all(
        [
            user,
            other_user,
            project,
            goal,
            done_goal,
            worked_task,
            pending_task,
            completed_task,
            task_in_done_goal,
            review_task,
            docs_task,
        ]
    )
    session.commit()
    # Notes have no ORM relationships, so insert them after their parents
    session.add_all(notes)
    session.commit()
    for entity in (project, goal, worked_task):
        session.refresh(entity)
    worked_task.goal = goal
    goal.project = project

    return {
        "user": user,
        "project": project,
        "goal": goal,
        "worked_task": worked_task,
        "pending_task": pending_task,
    }


class TestWeeklyReportBackground:
    """Notes and open tasks gathered as report context."""

    def test_collects_notes_and_open_tasks(self, session, report_workspace):
        generator = WeeklyReportGenerator()
        project = report_workspace["project"]
        goal = report_workspace["goal"]
        worked_task = report_workspace["worked_task"]
        pending_task = report_workspace["pending_task"]

        background = generator._collect_report_background(
            session,
            str(report_workspace["user"].id),
            [worked_task],
            [project],
        )

        assert background.project_details[str(project.id)] == {
            "description": "チームの週報作成の手間を減らす",
            "note": "経営会議で週報の標準化が決まった",
        }
        assert background.goal_details[str(goal.id)] == {
            "project_id": str(project.id),
            "title": "報告書生成",
            "description": "週報の下書きを自動生成する",
            "status": "pending",
            "due_date": "2030-02-01",  # 15:00 UTC is the next day in JST
            "note": "# ゴールメモ\n- 月末までにリリース",
        }
        assert background.task_details[str(worked_task.id)] == {
            "memo": "出力形式を三点セットにする",
            "note": "## 方針\n週報の&下書きを自動化する\n- [x] API設計\n- [ ] UI実装",
        }
        # In-progress work first; completed tasks and closed goals are excluded
        assert background.upcoming_tasks[str(project.id)] == [
            {
                "title": "プロンプト改修",
                "goal": "報告書生成",
                "status": "in_progress",
                "priority": 3,
                "worked_this_week": True,
            },
            {
                "title": "フロント表示",
                "goal": "報告書生成",
                "status": "pending",
                "priority": 1,
                "due_date": "2030-01-20",
                "worked_this_week": False,
                "note": "デザインはFigma参照",
            },
            {
                "title": "レビュー依頼",
                "goal": "報告書生成",
                "status": "pending",
                "priority": 4,
                "worked_this_week": False,
            },
            {
                "title": "ドキュメント",
                "goal": "報告書生成",
                "status": "pending",
                "priority": 5,
                "worked_this_week": False,
            },
        ]
        assert [
            (note.entity_type, note.title) for note in background.referenced_notes
        ] == [
            ("project", "週報自動化"),
            ("goal", "報告書生成"),
            ("task", "プロンプト改修"),
            ("task", "フロント表示"),
        ]
        assert background.referenced_notes[-1] == WeeklyReportNoteReference(
            entity_type="task",
            entity_id=str(pending_task.id),
            title="フロント表示",
            project_id=str(project.id),
            goal_id=str(goal.id),
        )

    def test_skips_notes_when_disabled(self, session, report_workspace):
        generator = WeeklyReportGenerator()
        project = report_workspace["project"]

        background = generator._collect_report_background(
            session,
            str(report_workspace["user"].id),
            [report_workspace["worked_task"]],
            [project],
            include_notes=False,
        )

        assert background.referenced_notes == []
        assert background.project_details[str(project.id)] == {
            "description": "チームの週報作成の手間を減らす"
        }
        assert all(
            "note" not in task for task in background.upcoming_tasks[str(project.id)]
        )
        assert [
            task["title"] for task in background.upcoming_tasks[str(project.id)]
        ] == ["プロンプト改修", "フロント表示", "レビュー依頼", "ドキュメント"]

    def test_upcoming_tasks_rank_relevance_per_project(self, session):
        """Many open tasks in one project must not crowd out another project."""
        from decimal import Decimal
        from uuid import uuid4

        user = User(id=uuid4(), email="report-busy@example.com")
        busy_project = Project(id=uuid4(), owner_id=user.id, title="Busy")
        quiet_project = Project(id=uuid4(), owner_id=user.id, title="Quiet")
        busy_goal = Goal(
            id=uuid4(),
            project_id=busy_project.id,
            title="Backlog",
            estimate_hours=Decimal("100.00"),
        )
        quiet_goal = Goal(
            id=uuid4(),
            project_id=quiet_project.id,
            title="Current",
            estimate_hours=Decimal("5.00"),
        )
        backlog = [
            Task(
                id=uuid4(),
                goal_id=busy_goal.id,
                title=f"Backlog {index:03d}",
                estimate_hours=Decimal("1.00"),
                priority=1,
            )
            for index in range(300)
        ]
        started = Task(
            id=uuid4(),
            goal_id=busy_goal.id,
            title="Started",
            estimate_hours=Decimal("1.00"),
            status=TaskStatus.IN_PROGRESS,
            priority=5,
        )
        quiet_task = Task(
            id=uuid4(),
            goal_id=quiet_goal.id,
            title="Quiet next step",
            estimate_hours=Decimal("1.00"),
            priority=5,
        )
        session.add_all([user, busy_project, quiet_project, busy_goal, quiet_goal])
        session.commit()
        session.add_all([*backlog, started, quiet_task])
        session.commit()

        upcoming = WeeklyReportGenerator()._get_upcoming_tasks(
            session, user.id, [busy_project.id, quiet_project.id], set()
        )

        busy_titles = [task.title for task in upcoming[busy_project.id]]
        assert busy_titles[0] == "Started"
        assert busy_titles[1:] == [f"Backlog {index:03d}" for index in range(7)]
        assert [task.title for task in upcoming[quiet_project.id]] == [
            "Quiet next step"
        ]


class TestWeeklyReportThreePartOutput:
    """The report is organized as background / done this week / next steps."""

    @pytest.fixture
    def summaries(self):
        from humancompiler_api.models import (
            ProjectProgressSummary,
            TaskProgressSummary,
        )

        work_summary = WeeklyWorkSummary(
            total_actual_minutes=90,
            total_estimated_hours=3.0,
            total_tasks_worked=1,
            total_completed_tasks=0,
            overall_completion_percentage=0.0,
            daily_breakdown={"2030-01-07": 90, "2030-01-08": 0},
            project_breakdown={"週報自動化": 90},
        )
        project_summary = ProjectProgressSummary(
            project_id="project-1",
            project_title="週報自動化",
            total_estimated_hours=3.0,
            total_actual_minutes=90,
            total_tasks=1,
            completed_tasks=0,
            completion_percentage=0.0,
            tasks=[
                TaskProgressSummary(
                    task_id="task-1",
                    task_title="プロンプト改修",
                    project_title="週報自動化",
                    goal_title="報告書生成",
                    estimated_hours=3.0,
                    actual_minutes=90,
                    completion_percentage=50.0,
                    status=TaskStatus.IN_PROGRESS,
                    work_logs=["三点セットの出力形式を実装"],
                )
            ],
        )
        background = ReportBackground(
            project_details={
                "project-1": {
                    "description": "チームの週報作成の手間を減らす",
                    "note": "経営会議で週報の標準化が決まった",
                }
            },
            goal_details={
                "goal-1": {
                    "project_id": "project-1",
                    "title": "報告書生成",
                    "note": "月末までにリリース",
                }
            },
            task_details={"task-1": {"note": "- [ ] UI実装"}},
            upcoming_tasks={
                "project-1": [
                    {
                        "title": "フロント表示",
                        "goal": "報告書生成",
                        "status": "pending",
                        "priority": 1,
                        "due_date": "2030-01-20",
                        "worked_this_week": False,
                    }
                ]
            },
        )
        return work_summary, [project_summary], background

    def test_build_report_context_merges_background(self, summaries):
        work_summary, project_summaries, background = summaries

        context = WeeklyReportGenerator()._build_report_context(
            "2030-01-07", work_summary, project_summaries, background
        )

        project = context["projects"][0]
        assert project["description"] == "チームの週報作成の手間を減らす"
        assert project["note"] == "経営会議で週報の標準化が決まった"
        assert project["goals"] == [
            {"title": "報告書生成", "note": "月末までにリリース"}
        ]
        assert project["tasks_worked"][0]["note"] == "- [ ] UI実装"
        assert project["tasks_worked"][0]["highlights"] == [
            "三点セットの出力形式を実装"
        ]
        assert project["upcoming_tasks"][0]["title"] == "フロント表示"

    @patch("humancompiler_api.ai.report_generator.OpenAI")
    def test_ai_prompt_requests_three_part_sections_with_notes(
        self, mock_openai_class, summaries
    ):
        work_summary, project_summaries, background = summaries
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "# 週間作業報告書"
        mock_client.chat.completions.create.return_value = mock_response
        mock_openai_class.return_value = mock_client

        WeeklyReportGenerator()._generate_markdown_report_with_ai(
            "test-key",
            "2030-01-07",
            work_summary,
            project_summaries,
            "gpt-5.4-mini",
            background,
        )

        prompt = mock_client.chat.completions.create.call_args.kwargs["messages"][1][
            "content"
        ]
        for heading in ("### 背景", "### 今週やったこと", "### 次にやること"):
            assert heading in prompt
        assert "経営会議で週報の標準化が決まった" in prompt
        assert "フロント表示" in prompt

    def test_fallback_report_has_three_part_sections(self, summaries):
        work_summary, project_summaries, background = summaries

        report = WeeklyReportGenerator()._generate_basic_markdown_report(
            "2030-01-07", work_summary, project_summaries, background
        )

        assert report.index("## 週報自動化") < report.index("### 背景")
        assert report.index("### 背景") < report.index("### 今週やったこと")
        assert report.index("### 今週やったこと") < report.index("### 次にやること")
        assert "- チームの週報作成の手間を減らす" in report
        assert "- ノート: 経営会議で週報の標準化が決まった" in report
        assert "- ゴール「報告書生成」: 月末までにリリース" in report
        assert "- **プロンプト改修**（ゴール: 報告書生成）: 1.5時間 / 進行中" in report
        assert "  - 三点セットの出力形式を実装" in report
        assert "- フロント表示（ゴール: 報告書生成 / 期限: 2030-01-20）" in report
        assert "- 2030-01-07: 1.5時間" in report
        assert "2030-01-08" not in report

    def test_fallback_report_without_background(self, summaries):
        work_summary, project_summaries, _ = summaries

        report = WeeklyReportGenerator()._generate_basic_markdown_report(
            "2030-01-07", work_summary, project_summaries
        )

        assert "- プロジェクトの説明やノートは登録されていません" in report
        assert "- 未完了のタスクはありません" in report
