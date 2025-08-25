"""
Context collection service for AI planning
"""

import logging
from datetime import date
from typing import Any

from humancompiler_api.ai.models import WeeklyPlanContext
from humancompiler_api.services import (
    goal_service,
    project_service,
    task_service,
    weekly_recurring_task_service,
)

logger = logging.getLogger(__name__)


class ContextCollector:
    """Service for collecting context data for AI planning"""

    def __init__(self):
        self.project_service = project_service
        self.goal_service = goal_service
        self.task_service = task_service
        self.weekly_recurring_task_service = weekly_recurring_task_service

    async def collect_weekly_plan_context(
        self,
        session,
        user_id: str,
        week_start_date: date,
        project_filter: list[str] | None = None,
        capacity_hours: float = 40.0,
        preferences: dict[str, Any] | None = None,
        selected_recurring_task_ids: list[str] | None = None,
    ) -> WeeklyPlanContext:
        """Collect context data for weekly planning"""

        logger.debug(f"Context Collection: Starting for user {user_id}")

        # Get user's projects
        projects = self.project_service.get_projects(session, user_id)
        logger.debug(f"Context Collection: Found {len(projects)} projects")

        # Filter projects if specified
        if project_filter:
            projects = [p for p in projects if str(p.id) in project_filter]
            logger.debug(f"Context Collection: Filtered to {len(projects)} projects")

        # Get goals for the projects
        goals = []
        for project in projects:
            project_goals = self.goal_service.get_goals_by_project(
                session, project.id, user_id
            )
            goals.extend(project_goals)

        logger.debug(f"Context Collection: Total {len(goals)} goals found")

        # Get active tasks for the goals
        tasks = []
        for goal in goals:
            goal_tasks = self.task_service.get_tasks_by_goal(session, goal.id, user_id)

            # Include tasks that are not completed or cancelled
            active_tasks = [
                t
                for t in goal_tasks
                if t.status not in ["completed", "cancelled", "done", "finished"]
            ]

            # Debug task filtering
            if len(goal_tasks) > 0:
                logger.info(
                    f"Goal {goal.id} ({goal.title}): {len(goal_tasks)} total tasks, {len(active_tasks)} active"
                )
                if len(goal_tasks) != len(active_tasks):
                    filtered_statuses = [
                        t.status
                        for t in goal_tasks
                        if t.status in ["completed", "cancelled", "done", "finished"]
                    ]
                    logger.info(f"Filtered out statuses: {set(filtered_statuses)}")

            tasks.extend(active_tasks)

        # Add detailed debugging for production issues
        logger.info(
            f"Context Collection: Collected {len(projects)} projects, {len(goals)} goals, {len(tasks)} active tasks"
        )

        # Log detailed context for debugging
        if len(projects) > 0:
            logger.info(f"Project details: {[(p.id, p.title) for p in projects]}")
        if len(goals) > 0:
            logger.info(
                f"Goal details: {[(g.id, g.title, g.project_id) for g in goals]}"
            )
        if len(tasks) > 0:
            logger.info(
                f"Task details: {[(t.id, t.title, t.goal_id, t.status) for t in tasks][:10]}..."
            )  # First 10 tasks
        else:
            logger.warning(
                "🚨 No active tasks found - this may cause AI to return empty plans"
            )

        # Get weekly recurring tasks for the user
        weekly_recurring_tasks = (
            self.weekly_recurring_task_service.get_weekly_recurring_tasks(
                session, user_id, is_active=True
            )
        )

        logger.debug(
            f"Context Collection: Found {len(weekly_recurring_tasks)} active weekly recurring tasks"
        )

        # Filter selected recurring tasks if specified
        selected_recurring_task_ids = selected_recurring_task_ids or []

        context = WeeklyPlanContext(
            user_id=user_id,
            week_start_date=week_start_date,
            projects=projects,
            goals=goals,
            tasks=tasks,
            weekly_recurring_tasks=weekly_recurring_tasks,
            selected_recurring_task_ids=selected_recurring_task_ids,
            capacity_hours=capacity_hours,
            preferences=preferences or {},
        )
        return context
