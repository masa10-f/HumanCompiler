"""Tests for weekly planning context collection."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from humancompiler_api.ai.context_collector import ContextCollector
from humancompiler_api.models import ProjectStatus


@pytest.mark.asyncio
async def test_collect_weekly_plan_context_uses_in_progress_projects_only():
    collector = ContextCollector()
    session = Mock()
    active_project = SimpleNamespace(
        id="active-project",
        title="Active Project",
        status=ProjectStatus.IN_PROGRESS,
    )
    pending_project = SimpleNamespace(
        id="pending-project",
        title="Pending Project",
        status=ProjectStatus.PENDING,
    )
    completed_project = SimpleNamespace(
        id="completed-project",
        title="Completed Project",
        status=ProjectStatus.COMPLETED,
    )

    collector.project_service = Mock()
    collector.project_service.get_projects.return_value = [
        pending_project,
        active_project,
        completed_project,
    ]
    collector.goal_service = Mock()
    collector.goal_service.get_goals_by_project.return_value = []
    collector.task_service = Mock()
    collector.weekly_recurring_task_service = Mock()
    collector.weekly_recurring_task_service.get_weekly_recurring_tasks.return_value = []

    context = await collector.collect_weekly_plan_context(
        session=session,
        user_id="user-1",
        week_start_date=date(2026, 7, 6),
    )

    assert context.projects == [active_project]
    collector.goal_service.get_goals_by_project.assert_called_once_with(
        session,
        active_project.id,
        "user-1",
    )
