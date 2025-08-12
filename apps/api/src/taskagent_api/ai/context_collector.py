"""
Context collection service for AI planning
"""

import logging
from datetime import date
from typing import Any

from taskagent_api.ai.models import WeeklyPlanContext
from taskagent_api.services import goal_service, project_service, task_service

logger = logging.getLogger(__name__)


class ContextCollector:
    """Service for collecting context data for AI planning"""

    def __init__(self):
        self.project_service = project_service
        self.goal_service = goal_service
        self.task_service = task_service

    async def collect_weekly_plan_context(
        self,
        session,
        user_id: str,
        week_start_date: date,
        project_filter: list[str] | None = None,
        capacity_hours: float = 40.0,
        preferences: dict[str, Any] | None = None,
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

            tasks.extend(active_tasks)

        logger.info(
            f"Context Collection: Collected {len(projects)} projects, {len(goals)} goals, {len(tasks)} active tasks"
        )

        context = WeeklyPlanContext(
            user_id=user_id,
            week_start_date=week_start_date,
            projects=projects,
            goals=goals,
            tasks=tasks,
            capacity_hours=capacity_hours,
            preferences=preferences or {},
        )
        return context
