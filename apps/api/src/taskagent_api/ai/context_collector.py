"""
Context collection service for AI planning
"""

from datetime import date
from typing import Dict, List, Optional, Any

from taskagent_api.services import project_service, goal_service, task_service
from .models import WeeklyPlanContext


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
        project_filter: Optional[List[str]] = None,
        capacity_hours: float = 40.0,
        preferences: Optional[Dict[str, Any]] = None
    ) -> WeeklyPlanContext:
        """Collect context data for weekly planning"""
        
        # Get user's projects
        projects = self.project_service.get_projects(session, user_id)
        
        # Filter projects if specified
        if project_filter:
            projects = [p for p in projects if str(p.id) in project_filter]
        
        # Get goals for the projects
        goals = []
        for project in projects:
            project_goals = self.goal_service.get_goals_by_project(session, project.id, user_id)
            goals.extend(project_goals)
        
        # Get pending tasks for the goals
        tasks = []
        for goal in goals:
            goal_tasks = self.task_service.get_tasks_by_goal(session, goal.id, user_id)
            # Only include pending and in-progress tasks
            pending_tasks = [t for t in goal_tasks if t.status in ['pending', 'in_progress']]
            tasks.extend(pending_tasks)
        
        return WeeklyPlanContext(
            user_id=user_id,
            week_start_date=week_start_date,
            projects=projects,
            goals=goals,
            tasks=tasks,
            capacity_hours=capacity_hours,
            preferences=preferences or {}
        )