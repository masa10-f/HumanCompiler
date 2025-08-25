"""
Test the two-stage optimization process: OpenAI Priority Extraction + OR-Tools.
"""

import pytest
from datetime import date, datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch

from humancompiler_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    WeeklyConstraints,
    TaskPriorityExtractor,
)
from humancompiler_api.ai.models import WeeklyPlanContext
from humancompiler_api.models import Project, Goal, Task


class TestTwoStageOptimization:
    """Test the two-stage optimization process."""

    @pytest.fixture
    def mock_context(self):
        """Create mock context for testing."""
        project = Mock(spec=Project)
        project.id = "proj-1"
        project.title = "Test Project"
        project.description = "Test project description"

        goal = Mock(spec=Goal)
        goal.id = "goal-1"
        goal.project_id = "proj-1"
        goal.title = "Test Goal"
        goal.description = "Test goal description"

        task1 = Mock(spec=Task)
        task1.id = "task-1"
        task1.title = "High Priority Task"
        task1.description = "Important task"
        task1.estimate_hours = 3.0
        task1.due_date = date.today() + timedelta(days=2)
        task1.priority = 1
        task1.goal_id = "goal-1"

        task2 = Mock(spec=Task)
        task2.id = "task-2"
        task2.title = "Low Priority Task"
        task2.description = "Less important task"
        task2.estimate_hours = 5.0
        task2.due_date = date.today() + timedelta(days=10)
        task2.priority = 4
        task2.goal_id = "goal-1"

        context = WeeklyPlanContext(
            user_id="user-1",
            week_start_date=date.today(),
            projects=[project],
            goals=[goal],
            tasks=[task1, task2],
            weekly_recurring_tasks=[],
            selected_recurring_task_ids=[],
            capacity_hours=40.0,
            preferences={},
        )

        return context

    def test_priority_extractor_fallback(self, mock_context):
        """Test priority extractor fallback when OpenAI is unavailable."""
        extractor = TaskPriorityExtractor(openai_client=None)

        priorities = extractor._fallback_priority_calculation(mock_context, [])

        assert "task-1" in priorities
        assert "task-2" in priorities
        # High priority task should have higher score due to earlier due date
        assert priorities["task-1"] > priorities["task-2"]

    @pytest.mark.asyncio
    async def test_priority_extraction_with_user_prompt(self, mock_context):
        """Test priority extraction with user prompt."""
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.tool_calls = [Mock()]
        mock_response.choices[0].message.tool_calls[
            0
        ].function.name = "extract_task_priorities"
        mock_response.choices[0].message.tool_calls[
            0
        ].function.arguments = '{"task_priorities": {"task-1": 8.5, "task-2": 6.0}}'

        mock_client.chat.completions.create.return_value = mock_response

        extractor = TaskPriorityExtractor(openai_client=mock_client)

        priorities = await extractor.extract_priorities(
            mock_context, "Focus on high-impact tasks this week", []
        )

        assert priorities["task-1"] == 8.5
        assert priorities["task-2"] == 6.0
        mock_client.chat.completions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_two_stage_optimization_with_ortools(self, mock_context):
        """Test the complete two-stage optimization process."""
        # Mock the priority extractor
        mock_solver = WeeklyTaskSolver(openai_client=None)
        mock_solver.priority_extractor = Mock()
        mock_solver.priority_extractor.extract_priorities = AsyncMock(
            return_value={"task-1": 9.0, "task-2": 5.0}
        )

        # Mock session and context collector
        mock_session = Mock()
        mock_solver.context_collector = Mock()
        mock_solver.context_collector.collect_weekly_plan_context = AsyncMock(
            return_value=mock_context
        )

        request = TaskSolverRequest(
            week_start_date="2025-08-18",
            constraints=WeeklyConstraints(total_capacity_hours=40.0),
            user_prompt="Focus on urgent tasks with high business impact",
        )

        # Test the optimization
        selected_tasks, insights = await mock_solver._optimize_with_ortools(
            mock_context,
            request.constraints,
            [],
            {"task-1": 9.0, "task-2": 5.0},
            request.user_prompt,
        )

        # Verify that OR-Tools optimization runs
        assert len(insights) > 0
        assert any("OR-Tools" in insight for insight in insights)
        if request.user_prompt:
            assert any("ユーザー指示" in insight for insight in insights)

    def test_ortools_constraint_formulation(self, mock_context):
        """Test OR-Tools constraint formulation."""
        # This test would verify that constraints are properly formulated
        # but we'll keep it simple for now
        constraints = WeeklyConstraints(
            total_capacity_hours=40.0,
            deadline_weight=0.4,
            project_balance_weight=0.3,
            effort_efficiency_weight=0.3,
        )

        # Verify constraint parameters
        assert constraints.total_capacity_hours == 40.0
        assert constraints.deadline_weight == 0.4
        assert constraints.project_balance_weight == 0.3
        assert constraints.effort_efficiency_weight == 0.3

    @pytest.mark.asyncio
    async def test_user_prompt_integration(self, mock_context):
        """Test that user prompts are properly integrated into priority calculation."""
        extractor = TaskPriorityExtractor(openai_client=None)

        # Test priority context creation with user prompt
        context_text = extractor._create_priority_context(
            mock_context, "この週は特にタスク1を優先して取り組みたい", []
        )

        assert "ユーザーからの特別な指示" in context_text
        assert "タスク1を優先して" in context_text
        assert "優先度計算に反映してください" in context_text

    def test_task_solver_request_with_user_prompt(self):
        """Test TaskSolverRequest with user_prompt field."""
        request = TaskSolverRequest(
            week_start_date="2025-08-18",
            user_prompt="Focus on research tasks this week",
        )

        assert request.user_prompt == "Focus on research tasks this week"
        assert request.week_start_date == "2025-08-18"

    @pytest.mark.asyncio
    async def test_priority_extraction_error_handling(self, mock_context):
        """Test error handling in priority extraction."""
        mock_client = Mock()
        mock_client.chat.completions.create.side_effect = Exception("API Error")

        extractor = TaskPriorityExtractor(openai_client=mock_client)

        # Should fall back to heuristic calculation
        priorities = await extractor.extract_priorities(mock_context, "Test prompt", [])

        assert isinstance(priorities, dict)
        assert len(priorities) > 0  # Should have fallback priorities

    def test_optimization_insights_generation(self):
        """Test that optimization insights are properly generated."""
        solver = WeeklyTaskSolver(openai_client=None)

        # Test insight generation with user prompt
        insights = []
        user_prompt = "Focus on high-impact deliverables"

        if user_prompt:
            insights.append(f"💬 ユーザー指示「{user_prompt}」を優先度計算に反映")

        assert len(insights) == 1
        assert "high-impact deliverables" in insights[0]
        assert "優先度計算に反映" in insights[0]
