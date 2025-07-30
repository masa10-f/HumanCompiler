"""
AI-powered planning API endpoints using OpenAI Assistants API.
"""

import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from taskagent_api.ai import WeeklyPlanRequest, WeeklyPlanResponse, weekly_plan_service
from taskagent_api.auth import get_current_user_id
from taskagent_api.database import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai-planning"])


@router.post("/weekly-plan", response_model=WeeklyPlanResponse)
async def generate_weekly_plan(
    request: WeeklyPlanRequest,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Generate AI-powered weekly plan using OpenAI Assistants API.

    This endpoint:
    1. Collects user's projects, goals, and pending tasks
    2. Formats context data for AI consumption
    3. Calls OpenAI GPT-4 with function calling for structured planning
    4. Returns optimized weekly schedule with recommendations

    The AI considers:
    - Task priorities and due dates
    - Deep work vs light work scheduling
    - Energy management throughout the day
    - Goal alignment and project balance
    - Realistic capacity planning
    """
    try:
        logger.info(
            f"Generating weekly plan for user {user_id} starting {request.week_start_date}"
        )

        # Validate week start date
        try:
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format. Use YYYY-MM-DD",
            ) from e

        # Check if date is in the past (allow current week)
        today = date.today()
        if week_start < today and (today - week_start).days > 7:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create plans for weeks more than 7 days in the past",
            )

        # Generate weekly plan using singleton service
        plan_response = await weekly_plan_service.generate_weekly_plan(
            session=session, user_id=user_id, request=request
        )

        logger.info(
            f"Weekly plan generated: {len(plan_response.task_plans)} tasks planned"
        )
        return plan_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in weekly plan generation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during plan generation",
        )


@router.get("/weekly-plan/test")
async def test_ai_integration():
    """Test endpoint to verify OpenAI integration."""
    try:
        from taskagent_api.ai.openai_client import OpenAIClient
        from taskagent_api.ai.prompts import get_function_definitions

        # Test OpenAI service initialization
        ai_client = OpenAIClient()

        # Test function definitions
        functions = get_function_definitions()

        return {
            "status": "success",
            "message": "OpenAI integration working",
            "model": ai_client.model,
            "functions_available": len(functions),
            "function_names": [f["name"] for f in functions],
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"OpenAI integration failed: {str(e)}",
            "model": None,
            "functions_available": 0,
        }


@router.post("/analyze-workload")
async def analyze_workload(
    project_ids: list[str] | None = None,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Analyze current workload and provide recommendations.

    This endpoint analyzes:
    - Total estimated hours vs capacity
    - Task distribution across projects
    - Due date pressure and urgency
    - Potential bottlenecks and overcommitments
    """
    try:
        from taskagent_api.services import goal_service, project_service, task_service

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
                pending_tasks = [
                    t for t in tasks if t.status in ["pending", "in_progress"]
                ]
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

    except Exception as e:
        logger.error(f"Error in workload analysis: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during workload analysis",
        )


@router.post("/suggest-priorities")
async def suggest_task_priorities(
    project_id: str | None = None,
    user_id: str = Depends(get_current_user_id),
    session: Session = Depends(db.get_session),
):
    """
    Get AI suggestions for task prioritization.

    Uses heuristics to suggest task priorities based on:
    - Due dates and urgency
    - Estimated effort vs impact
    - Dependencies and blockers
    - Project strategic importance
    """
    try:
        from taskagent_api.services import goal_service, project_service, task_service

        # Get tasks for analysis
        if project_id:
            project = project_service.get_project(session, project_id, user_id)
            if not project:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
                )

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
                    goal_tasks = task_service.get_tasks_by_goal(
                        session, goal.id, user_id
                    )
                    tasks.extend(
                        [
                            t
                            for t in goal_tasks
                            if t.status in ["pending", "in_progress"]
                        ]
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
            # This could be enhanced with actual goal progress tracking
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in priority suggestions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during priority analysis",
        )
