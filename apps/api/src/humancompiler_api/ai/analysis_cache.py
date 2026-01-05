"""
Caching wrappers for AI analysis functions
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlmodel import Session

from core.cache import cached
from humancompiler_api.services import goal_service, project_service, task_service

if TYPE_CHECKING:
    from humancompiler_api.services import GoalService, ProjectService, TaskService


@cached(cache_type="extended", key_prefix="workload_analysis")
def analyze_workload_cached(
    session: Session, user_id: str, project_ids: list[str] | None = None
) -> dict[str, Any]:
    """
    Cached version of workload analysis
    Returns analysis results with 15-minute cache TTL
    """
    # Get user's data
    if project_ids:
        projects = []
        for project_id in project_ids:
            project = project_service.get_project(session, project_id, user_id)
            if project:
                projects.append(project)
    else:
        projects = project_service.get_projects(session, user_id)

    # Collect all goals and tasks
    all_goals = []
    all_tasks = []

    for project in projects:
        goals = goal_service.get_goals_by_project(session, project.id, user_id)
        all_goals.extend(goals)

        for goal in goals:
            tasks = task_service.get_tasks_by_goal(session, goal.id, user_id)
            pending_tasks = [t for t in tasks if t.status in ["pending", "in_progress"]]
            all_tasks.extend(pending_tasks)

    # Calculate workload metrics
    total_hours = sum(task.estimate_hours for task in all_tasks)
    overdue_tasks = []
    urgent_tasks = []

    today = date.today()
    for task in all_tasks:
        if task.due_date:
            if task.due_date.date() < today:
                overdue_tasks.append(task)
            elif (task.due_date.date() - today).days <= 3:
                urgent_tasks.append(task)

    # Project distribution
    project_hours = {}
    for task in all_tasks:
        goal = next((g for g in all_goals if g.id == task.goal_id), None)
        if goal:
            project = next((p for p in projects if p.id == goal.project_id), None)
            if project:
                project_hours[project.title] = (
                    project_hours.get(project.title, 0) + task.estimate_hours
                )

    # Generate recommendations
    recommendations = []

    if total_hours > 40:
        recommendations.append(
            f"Workload is {total_hours:.1f} hours - consider prioritizing or deferring some tasks"
        )

    if len(overdue_tasks) > 0:
        recommendations.append(
            f"{len(overdue_tasks)} overdue tasks require immediate attention"
        )

    if len(urgent_tasks) > 0:
        recommendations.append(f"{len(urgent_tasks)} tasks are due within 3 days")

    if len(project_hours) > 3:
        recommendations.append(
            "Consider focusing on fewer projects to maintain momentum"
        )

    if not recommendations:
        recommendations.append("Workload appears well-balanced")

    return {
        "success": True,
        "analysis": {
            "total_estimated_hours": total_hours,
            "total_tasks": len(all_tasks),
            "overdue_tasks": len(overdue_tasks),
            "urgent_tasks": len(urgent_tasks),
            "projects_involved": len(projects),
            "project_distribution": project_hours,
        },
        "recommendations": recommendations,
        "generated_at": datetime.now().isoformat(),
    }


@cached(cache_type="extended", key_prefix="priority_suggestions")
def suggest_priorities_cached(
    session: Session, user_id: str, project_id: str | None = None
) -> dict[str, Any]:
    """
    Cached version of priority suggestions
    Returns priority analysis with 15-minute cache TTL
    """
    # Get tasks for analysis
    if project_id:
        project = project_service.get_project(session, project_id, user_id)
        if not project:
            return {"success": False, "error": "Project not found"}

        goals = goal_service.get_goals_by_project(session, project_id, user_id)
        tasks = []
        for goal in goals:
            goal_tasks = task_service.get_tasks_by_goal(session, goal.id, user_id)
            tasks.extend(
                [t for t in goal_tasks if t.status in ["pending", "in_progress"]]
            )
    else:
        # Get all user tasks
        projects = project_service.get_projects(session, user_id)
        tasks = []
        for project in projects:
            goals = goal_service.get_goals_by_project(session, project.id, user_id)
            for goal in goals:
                goal_tasks = task_service.get_tasks_by_goal(session, goal.id, user_id)
                tasks.extend(
                    [t for t in goal_tasks if t.status in ["pending", "in_progress"]]
                )

    # Priority scoring algorithm
    task_scores = []
    today = date.today()

    for task in tasks:
        score = 0
        reasons = []

        # Due date urgency (0-40 points)
        if task.due_date:
            days_until_due = (task.due_date.date() - today).days
            if days_until_due < 0:
                score += 40  # Overdue
                reasons.append("Task is overdue")
            elif days_until_due <= 1:
                score += 35  # Due today/tomorrow
                reasons.append("Due very soon")
            elif days_until_due <= 3:
                score += 25  # Due this week
                reasons.append("Due this week")
            elif days_until_due <= 7:
                score += 15  # Due next week
                reasons.append("Due next week")

        # Effort vs impact (0-30 points)
        if task.estimate_hours <= 2:
            score += 20  # Quick wins
            reasons.append("Quick win (low effort)")
        elif task.estimate_hours >= 8:
            score += 10  # Major tasks
            reasons.append("Major task (high impact potential)")
        else:
            score += 15  # Medium tasks
            reasons.append("Medium complexity")

        # Goal completion progress (0-20 points)
        score += 10  # Base goal contribution
        reasons.append("Contributes to goal progress")

        # Default priority boost (0-10 points)
        score += 5

        task_scores.append(
            {
                "task_id": task.id,
                "task_title": task.title,
                "current_estimate_hours": task.estimate_hours,
                "due_date": task.due_date.isoformat() if task.due_date else None,
                "priority_score": score,
                "suggested_priority": min(
                    5, max(1, 6 - (score // 15))
                ),  # Convert to 1-5 scale
                "reasoning": reasons,
            }
        )

    # Sort by priority score (highest first)
    task_scores.sort(key=lambda x: x["priority_score"], reverse=True)

    return {
        "success": True,
        "total_tasks_analyzed": len(task_scores),
        "priority_suggestions": task_scores,
        "methodology": {
            "factors": [
                "Due date urgency (0-40 points)",
                "Effort vs impact ratio (0-30 points)",
                "Goal contribution (0-20 points)",
                "Base priority (0-10 points)",
            ],
            "priority_scale": "1 (highest) to 5 (lowest)",
        },
        "generated_at": datetime.now().isoformat(),
    }


# Service instances (singleton pattern)
_project_service = None
_goal_service = None
_task_service = None


def get_services() -> tuple["ProjectService", "GoalService", "TaskService"]:
    """Get singleton service instances"""
    global _project_service, _goal_service, _task_service

    if _project_service is None:
        from humancompiler_api.services import ProjectService, GoalService, TaskService

        _project_service = ProjectService()
        _goal_service = GoalService()
        _task_service = TaskService()

    return _project_service, _goal_service, _task_service


# Initialize services
project_service, goal_service, task_service = get_services()
