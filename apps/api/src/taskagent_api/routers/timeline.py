"""Timeline visualization API endpoints for project progress tracking"""

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select, and_, or_
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, AuthUser
from ..database import get_session
from ..rate_limiter import limiter
from ..config import settings
from ..models import (
    User,
    Project,
    Goal,
    Task,
    Log,
    TaskStatus,
    GoalStatus,
    GoalDependency,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def conditional_rate_limit(rate: str):
    """Apply rate limiting only in non-test environments"""

    def decorator(func):
        if settings.environment == "test":
            return func
        else:
            return limiter.limit(rate)(func)

    return decorator


@router.get("/projects/{project_id}")
@conditional_rate_limit("15/minute")
async def get_project_timeline(
    project_id: UUID,
    request: Request = None,
    start_date: datetime = Query(None, description="Timeline start date"),
    end_date: datetime = Query(None, description="Timeline end date"),
    time_unit: str = Query("day", description="Time unit: day, week, month"),
    weekly_work_hours: float = Query(
        40.0, description="Weekly work hours for timeline calculation"
    ),
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """
    Get timeline data for a specific project

    Returns project timeline with goals and tasks arranged by time periods
    """
    try:
        logger.info(
            f"Getting timeline for project {project_id}, user {current_user.user_id} ({current_user.email})"
        )

        # Verify project ownership
        project = session.get(Project, project_id)
        logger.info(f"Project lookup result: {project is not None}")

        if not project:
            logger.warning(f"Project {project_id} not found in database")
            raise HTTPException(status_code=404, detail="Project not found")

        logger.info(f"Project found: {project.title}, owner: {project.owner_id}")
        logger.info(
            f"Type check - project.owner_id: {type(project.owner_id)}, current_user.user_id: {type(current_user.user_id)}"
        )
        logger.info(
            f"Values - project.owner_id: '{project.owner_id}', current_user.user_id: '{current_user.user_id}'"
        )

        # Convert both to strings for comparison to avoid UUID vs string issues
        project_owner_str = str(project.owner_id)
        user_id_str = str(current_user.user_id)

        if project_owner_str != user_id_str:
            logger.warning(
                f"Project {project_id} ownership mismatch: owner={project_owner_str}, user={user_id_str}"
            )
            raise HTTPException(status_code=404, detail="Project not found")

        logger.info(f"Project ownership verified for {project_id}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying project {project_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify project")

    # Set default date range if not provided
    if not start_date:
        start_date = project.created_at.replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    if not end_date:
        end_date = datetime.now().replace(
            hour=23, minute=59, second=59, microsecond=999999
        )

    # Get all goals for the project with tasks, logs, and dependencies in a single query (fix N+1 problem)
    goals_statement = (
        select(Goal)
        .options(
            selectinload(Goal.tasks).selectinload(Task.logs),
            selectinload(Goal.dependencies),
            selectinload(Goal.dependent_goals),
        )
        .where(Goal.project_id == project_id)
    )
    goals = session.exec(goals_statement).all()

    timeline_data = {
        "project": {
            "id": str(project.id),
            "title": project.title,
            "description": project.description,
            "weekly_work_hours": weekly_work_hours,
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
        },
        "timeline": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "time_unit": time_unit,
        },
        "goals": [],
    }

    for goal in goals:
        # Use preloaded tasks from the relationship (N+1 problem fixed)
        tasks = goal.tasks

        # Get dependency goal IDs
        dependency_ids = [str(dep.depends_on_goal_id) for dep in goal.dependencies]

        goal_data = {
            "id": str(goal.id),
            "title": goal.title,
            "description": goal.description,
            "status": goal.status,
            "estimate_hours": float(goal.estimate_hours),
            "start_date": None,
            "end_date": None,
            "dependencies": dependency_ids,
            "created_at": goal.created_at.isoformat(),
            "updated_at": goal.updated_at.isoformat(),
            "tasks": [],
        }

        for task in tasks:
            # Use preloaded logs from the relationship (N+1 problem fixed)
            logs = task.logs

            total_actual_minutes = sum(log.actual_minutes for log in logs)
            estimate_minutes = float(task.estimate_hours) * 60
            progress_percentage = (
                min((total_actual_minutes / estimate_minutes) * 100, 100)
                if estimate_minutes > 0
                else 0
            )

            # Determine task status color
            status_color = _get_status_color(task.status, progress_percentage)

            task_data = {
                "id": str(task.id),
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "estimate_hours": float(task.estimate_hours),
                "due_date": task.due_date.isoformat() if task.due_date else None,
                "created_at": task.created_at.isoformat(),
                "updated_at": task.updated_at.isoformat(),
                "progress_percentage": round(progress_percentage, 1),
                "status_color": status_color,
                "actual_hours": round(total_actual_minutes / 60, 2),
                "logs_count": len(logs),
            }

            goal_data["tasks"].append(task_data)

        # Sort tasks by created_at for timeline display
        goal_data["tasks"].sort(key=lambda x: x["created_at"])
        timeline_data["goals"].append(goal_data)

    # Sort goals by created_at for timeline display
    timeline_data["goals"].sort(key=lambda x: x["created_at"])

    return timeline_data


@router.get("/overview")
@conditional_rate_limit("30/minute")
async def get_timeline_overview(
    start_date: datetime = Query(None, description="Timeline start date"),
    request: Request = None,
    end_date: datetime = Query(None, description="Timeline end date"),
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """
    Get timeline overview for all projects of the current user

    Returns summary timeline data for dashboard display
    """
    try:
        logger.info(
            f"Getting timeline overview for user {current_user.user_id} ({current_user.email})"
        )
        # Set default date range if not provided
        if not start_date:
            # Default to last 3 months
            start_date = (datetime.now() - timedelta(days=90)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        if not end_date:
            end_date = datetime.now().replace(
                hour=23, minute=59, second=59, microsecond=999999
            )

        # Get all projects for the user with goals and tasks preloaded (fix N+1 problem)
        # Convert user_id to UUID for proper comparison
        user_id = current_user.user_id
        if isinstance(user_id, str):
            from uuid import UUID

            user_id = UUID(user_id)

        projects_statement = (
            select(Project)
            .options(selectinload(Project.goals).selectinload(Goal.tasks))
            .where(Project.owner_id == user_id)
        )
        projects = session.exec(projects_statement).all()

        logger.info(f"Found {len(projects)} projects for user {current_user.user_id}")

        if len(projects) == 0:
            logger.warning(f"No projects found for user {current_user.user_id}")

        overview_data = {
            "timeline": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
            "projects": [],
        }

        for project in projects:
            # Use preloaded goals from the relationship (N+1 problem fixed)
            goals = project.goals

            total_goals = len(goals)
            completed_goals = len(
                [g for g in goals if g.status == GoalStatus.COMPLETED]
            )
            in_progress_goals = len(
                [g for g in goals if g.status == GoalStatus.IN_PROGRESS]
            )

            # Get all tasks for this project from preloaded relationships (N+1 problem fixed)
            all_tasks = []
            for goal in goals:
                all_tasks.extend(goal.tasks)

            total_tasks = len(all_tasks)
            completed_tasks = len(
                [t for t in all_tasks if t.status == TaskStatus.COMPLETED]
            )
            in_progress_tasks = len(
                [t for t in all_tasks if t.status == TaskStatus.IN_PROGRESS]
            )

            project_data = {
                "id": str(project.id),
                "title": project.title,
                "description": project.description,
                "created_at": project.created_at.isoformat(),
                "updated_at": project.updated_at.isoformat(),
                "statistics": {
                    "total_goals": total_goals,
                    "completed_goals": completed_goals,
                    "in_progress_goals": in_progress_goals,
                    "total_tasks": total_tasks,
                    "completed_tasks": completed_tasks,
                    "in_progress_tasks": in_progress_tasks,
                    "goals_completion_rate": round(
                        (completed_goals / total_goals) * 100, 1
                    )
                    if total_goals > 0
                    else 0,
                    "tasks_completion_rate": round(
                        (completed_tasks / total_tasks) * 100, 1
                    )
                    if total_tasks > 0
                    else 0,
                },
            }

            overview_data["projects"].append(project_data)

        # Sort projects by updated_at (most recent first)
        overview_data["projects"].sort(key=lambda x: x["updated_at"], reverse=True)

        return overview_data

    except Exception as e:
        logger.error(
            f"Error getting timeline overview for user {current_user.user_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to get timeline overview: {str(e)}"
        )


def _get_status_color(status: TaskStatus, progress_percentage: float) -> str:
    """
    Get color code for task status visualization

    Returns appropriate color for timeline display
    """
    if status == TaskStatus.COMPLETED:
        return "#22c55e"  # Green
    elif status == TaskStatus.IN_PROGRESS:
        if progress_percentage >= 80:
            return "#facc15"  # Yellow (nearly complete)
        elif progress_percentage >= 50:
            return "#f97316"  # Orange (halfway)
        else:
            return "#3b82f6"  # Blue (started)
    elif status == TaskStatus.CANCELLED:
        return "#ef4444"  # Red
    else:  # PENDING
        return "#6b7280"  # Gray
