from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select, func

from taskagent_api.auth import AuthUser, get_current_user
from taskagent_api.database import db
from taskagent_api.models import Goal, Log, Project, Task

router = APIRouter(prefix="/progress", tags=["progress"])


class TaskProgress(BaseModel):
    """Task progress information"""
    
    task_id: str
    title: str
    estimate_hours: Decimal
    actual_minutes: int
    progress_percentage: float
    status: str


class GoalProgress(BaseModel):
    """Goal progress information"""
    
    goal_id: str
    title: str
    estimate_hours: Decimal
    actual_minutes: int
    progress_percentage: float
    tasks: list[TaskProgress]


class ProjectProgress(BaseModel):
    """Project progress information"""
    
    project_id: str
    title: str
    estimate_hours: Decimal
    actual_minutes: int
    progress_percentage: float
    goals: list[GoalProgress]


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.get(
    "/project/{project_id}",
    response_model=ProjectProgress,
)
async def get_project_progress(
    project_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> ProjectProgress:
    """Get progress information for a project"""
    
    # Get project with goals and tasks
    project = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .where(Project.owner_id == current_user.user_id)
    ).first()
    
    if not project:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    # Get goals for this project
    goals = session.exec(
        select(Goal).where(Goal.project_id == project_id)
    ).all()
    
    project_total_estimate = Decimal(0)
    project_total_actual = 0
    goal_progresses = []
    
    for goal in goals:
        # Get tasks for this goal
        tasks = session.exec(
            select(Task).where(Task.goal_id == goal.id)
        ).all()
        
        goal_total_estimate = goal.estimate_hours
        goal_total_actual = 0
        task_progresses = []
        
        for task in tasks:
            # Get total actual minutes for this task
            task_actual_query = session.exec(
                select(func.sum(Log.actual_minutes))
                .where(Log.task_id == task.id)
            ).first()
            
            task_actual_minutes = task_actual_query or 0
            task_estimate_minutes = int(task.estimate_hours * 60)
            task_progress = (
                (task_actual_minutes / task_estimate_minutes * 100)
                if task_estimate_minutes > 0 else 0.0
            )
            
            task_progress_info = TaskProgress(
                task_id=str(task.id),
                title=task.title,
                estimate_hours=task.estimate_hours,
                actual_minutes=task_actual_minutes,
                progress_percentage=min(task_progress, 100.0),
                status=task.status.value
            )
            task_progresses.append(task_progress_info)
            goal_total_actual += task_actual_minutes
        
        goal_estimate_minutes = int(goal_total_estimate * 60)
        goal_progress = (
            (goal_total_actual / goal_estimate_minutes * 100)
            if goal_estimate_minutes > 0 else 0.0
        )
        
        goal_progress_info = GoalProgress(
            goal_id=str(goal.id),
            title=goal.title,
            estimate_hours=goal_total_estimate,
            actual_minutes=goal_total_actual,
            progress_percentage=min(goal_progress, 100.0),
            tasks=task_progresses
        )
        goal_progresses.append(goal_progress_info)
        
        project_total_estimate += goal_total_estimate
        project_total_actual += goal_total_actual
    
    project_estimate_minutes = int(project_total_estimate * 60)
    project_progress = (
        (project_total_actual / project_estimate_minutes * 100)
        if project_estimate_minutes > 0 else 0.0
    )
    
    return ProjectProgress(
        project_id=str(project.id),
        title=project.title,
        estimate_hours=project_total_estimate,
        actual_minutes=project_total_actual,
        progress_percentage=min(project_progress, 100.0),
        goals=goal_progresses
    )


@router.get(
    "/goal/{goal_id}",
    response_model=GoalProgress,
)
async def get_goal_progress(
    goal_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> GoalProgress:
    """Get progress information for a goal"""
    
    # Get goal with ownership check
    goal = session.exec(
        select(Goal)
        .join(Project)
        .where(Goal.id == goal_id)
        .where(Project.owner_id == current_user.user_id)
    ).first()
    
    if not goal:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found"
        )
    
    # Get tasks for this goal
    tasks = session.exec(
        select(Task).where(Task.goal_id == goal_id)
    ).all()
    
    goal_total_actual = 0
    task_progresses = []
    
    for task in tasks:
        # Get total actual minutes for this task
        task_actual_query = session.exec(
            select(func.sum(Log.actual_minutes))
            .where(Log.task_id == task.id)
        ).first()
        
        task_actual_minutes = task_actual_query or 0
        task_estimate_minutes = int(task.estimate_hours * 60)
        task_progress = (
            (task_actual_minutes / task_estimate_minutes * 100)
            if task_estimate_minutes > 0 else 0.0
        )
        
        task_progress_info = TaskProgress(
            task_id=str(task.id),
            title=task.title,
            estimate_hours=task.estimate_hours,
            actual_minutes=task_actual_minutes,
            progress_percentage=min(task_progress, 100.0),
            status=task.status.value
        )
        task_progresses.append(task_progress_info)
        goal_total_actual += task_actual_minutes
    
    goal_estimate_minutes = int(goal.estimate_hours * 60)
    goal_progress = (
        (goal_total_actual / goal_estimate_minutes * 100)
        if goal_estimate_minutes > 0 else 0.0
    )
    
    return GoalProgress(
        goal_id=str(goal.id),
        title=goal.title,
        estimate_hours=goal.estimate_hours,
        actual_minutes=goal_total_actual,
        progress_percentage=min(goal_progress, 100.0),
        tasks=task_progresses
    )


@router.get(
    "/task/{task_id}",
    response_model=TaskProgress,
)
async def get_task_progress(
    task_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TaskProgress:
    """Get progress information for a task"""
    
    # Get task with ownership check
    task = session.exec(
        select(Task)
        .join(Goal)
        .join(Project)
        .where(Task.id == task_id)
        .where(Project.owner_id == current_user.user_id)
    ).first()
    
    if not task:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found"
        )
    
    # Get total actual minutes for this task
    task_actual_query = session.exec(
        select(func.sum(Log.actual_minutes))
        .where(Log.task_id == task_id)
    ).first()
    
    task_actual_minutes = task_actual_query or 0
    task_estimate_minutes = int(task.estimate_hours * 60)
    task_progress = (
        (task_actual_minutes / task_estimate_minutes * 100)
        if task_estimate_minutes > 0 else 0.0
    )
    
    return TaskProgress(
        task_id=str(task.id),
        title=task.title,
        estimate_hours=task.estimate_hours,
        actual_minutes=task_actual_minutes,
        progress_percentage=min(task_progress, 100.0),
        status=task.status.value
    )