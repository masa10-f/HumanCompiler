"""Timeline visualization API endpoints for project progress tracking"""

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, and_, or_

from ..auth import get_current_user
from ..database import get_session
from ..models import User, Project, Goal, Task, Log, TaskStatus, GoalStatus

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/projects/{project_id}")
async def get_project_timeline(
    project_id: UUID,
    start_date: datetime = Query(None, description="Timeline start date"),
    end_date: datetime = Query(None, description="Timeline end date"),
    time_unit: str = Query("day", description="Time unit: day, week, month"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """
    Get timeline data for a specific project

    Returns project timeline with goals and tasks arranged by time periods
    """
    # Verify project ownership
    project = session.get(Project, project_id)
    if not project or project.owner_id != current_user.user_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Set default date range if not provided
    if not start_date:
        start_date = project.created_at.replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    if not end_date:
        end_date = datetime.now().replace(
            hour=23, minute=59, second=59, microsecond=999999
        )

    # Get all goals for the project
    goals_statement = select(Goal).where(Goal.project_id == project_id)
    goals = session.exec(goals_statement).all()

    timeline_data = {
        "project": {
            "id": str(project.id),
            "title": project.title,
            "description": project.description,
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
        # Get all tasks for this goal
        tasks_statement = select(Task).where(Task.goal_id == goal.id)
        tasks = session.exec(tasks_statement).all()

        goal_data = {
            "id": str(goal.id),
            "title": goal.title,
            "description": goal.description,
            "status": goal.status,
            "estimate_hours": float(goal.estimate_hours),
            "created_at": goal.created_at.isoformat(),
            "updated_at": goal.updated_at.isoformat(),
            "tasks": [],
        }

        for task in tasks:
            # Get logs for progress calculation
            logs_statement = select(Log).where(Log.task_id == task.id)
            logs = session.exec(logs_statement).all()

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
async def get_timeline_overview(
    start_date: datetime = Query(None, description="Timeline start date"),
    end_date: datetime = Query(None, description="Timeline end date"),
    current_user: User = Depends(get_current_user),
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

        # Get all projects for the user
        projects_statement = select(Project).where(
            Project.owner_id == current_user.user_id
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
            # Get project statistics
            goals_statement = select(Goal).where(Goal.project_id == project.id)
            goals = session.exec(goals_statement).all()

            total_goals = len(goals)
            completed_goals = len(
                [g for g in goals if g.status == GoalStatus.COMPLETED]
            )
            in_progress_goals = len(
                [g for g in goals if g.status == GoalStatus.IN_PROGRESS]
            )

            # Get all tasks for this project
            all_tasks = []
            for goal in goals:
                tasks_statement = select(Task).where(Task.goal_id == goal.id)
                tasks = session.exec(tasks_statement).all()
                all_tasks.extend(tasks)

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
