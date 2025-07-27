from datetime import datetime
from typing import Optional, Union
from uuid import uuid4, UUID

from fastapi import HTTPException, status
from sqlmodel import Session, select

from models import (
    Goal,
    GoalCreate,
    GoalUpdate,
    Log,
    Project,
    ProjectCreate,
    ProjectUpdate,
    Task,
    TaskCreate,
    TaskStatus,
    TaskUpdate,
    User,
    UserCreate,
    UserUpdate,
)


class UserService:
    """User service for CRUD operations"""

    @staticmethod
    def create_user(session: Session, user_data: UserCreate, user_id: Union[str, UUID]) -> User:
        """Create a new user or return existing one"""
        # Check if user already exists
        existing_user = session.get(User, user_id)
        if existing_user:
            return existing_user

        user = User(
            id=user_id,
            email=user_data.email,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    @staticmethod
    def get_user(session: Session, user_id: Union[str, UUID]) -> Optional[User]:
        """Get user by ID"""
        return session.get(User, user_id)

    @staticmethod
    def update_user(session: Session, user_id: Union[str, UUID], user_data: UserUpdate) -> User:
        """Update user"""
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        update_data = user_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)

        user.updated_at = datetime.utcnow()
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


class ProjectService:
    """Project service for CRUD operations"""

    @staticmethod
    def create_project(session: Session, project_data: ProjectCreate, owner_id: Union[str, UUID]) -> Project:
        """Create a new project"""
        project = Project(
            id=uuid4(),
            owner_id=owner_id,
            title=project_data.title,
            description=project_data.description,
        )
        session.add(project)
        session.commit()
        session.refresh(project)
        return project

    @staticmethod
    def get_project(session: Session, project_id: Union[str, UUID], owner_id: Union[str, UUID]) -> Optional[Project]:
        """Get project by ID for specific owner"""
        statement = select(Project).where(
            Project.id == project_id,
            Project.owner_id == owner_id
        )
        return session.exec(statement).first()

    @staticmethod
    def get_projects(session: Session, owner_id: Union[str, UUID], skip: int = 0, limit: int = 100) -> list[Project]:
        """Get projects for specific owner"""
        statement = select(Project).where(
            Project.owner_id == owner_id
        ).offset(skip).limit(limit)
        return list(session.exec(statement).all())

    @staticmethod
    def update_project(session: Session, project_id: Union[str, UUID], owner_id: Union[str, UUID], project_data: ProjectUpdate) -> Project:
        """Update project"""
        project = ProjectService.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        update_data = project_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(project, field, value)

        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
        session.refresh(project)
        return project

    @staticmethod
    def delete_project(session: Session, project_id: Union[str, UUID], owner_id: Union[str, UUID]) -> bool:
        """Delete project"""
        project = ProjectService.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        try:
            # Delete all tasks in all goals of this project
            from sqlmodel import select
            goals = session.exec(select(Goal).where(Goal.project_id == project_id)).all()
            for goal in goals:
                tasks = session.exec(select(Task).where(Task.goal_id == goal.id)).all()
                for task in tasks:
                    # Delete all logs for this task
                    logs = session.exec(select(Log).where(Log.task_id == task.id)).all()
                    for log in logs:
                        session.delete(log)
                    session.delete(task)
                session.delete(goal)
            
            # Delete the project
            session.delete(project)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete project: {str(e)}"
            )


class GoalService:
    """Goal service for CRUD operations"""

    @staticmethod
    def create_goal(session: Session, goal_data: GoalCreate, owner_id: Union[str, UUID]) -> Goal:
        """Create a new goal"""
        # Verify project ownership
        project = ProjectService.get_project(session, goal_data.project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        goal = Goal(
            id=uuid4(),
            project_id=goal_data.project_id,
            title=goal_data.title,
            description=goal_data.description,
            estimate_hours=goal_data.estimate_hours,
        )
        session.add(goal)
        session.commit()
        session.refresh(goal)
        return goal

    @staticmethod
    def get_goal(session: Session, goal_id: Union[str, UUID], owner_id: Union[str, UUID]) -> Optional[Goal]:
        """Get goal by ID for specific owner"""
        statement = select(Goal).join(Project).where(
            Goal.id == goal_id,
            Project.owner_id == owner_id
        )
        return session.exec(statement).first()

    @staticmethod
    def get_goals_by_project(session: Session, project_id: Union[str, UUID], owner_id: Union[str, UUID], skip: int = 0, limit: int = 100) -> list[Goal]:
        """Get goals for specific project"""
        # Verify project ownership
        project = ProjectService.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        statement = select(Goal).where(
            Goal.project_id == project_id
        ).offset(skip).limit(limit)
        return list(session.exec(statement).all())

    @staticmethod
    def update_goal(session: Session, goal_id: Union[str, UUID], owner_id: Union[str, UUID], goal_data: GoalUpdate) -> Goal:
        """Update goal"""
        goal = GoalService.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found"
            )

        update_data = goal_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(goal, field, value)

        goal.updated_at = datetime.utcnow()
        session.add(goal)
        session.commit()
        session.refresh(goal)
        return goal

    @staticmethod
    def delete_goal(session: Session, goal_id: Union[str, UUID], owner_id: Union[str, UUID]) -> bool:
        """Delete goal"""
        goal = GoalService.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found"
            )

        session.delete(goal)
        session.commit()
        return True


class TaskService:
    """Task service for CRUD operations"""

    @staticmethod
    def create_task(session: Session, task_data: TaskCreate, owner_id: Union[str, UUID]) -> Task:
        """Create a new task"""
        # Verify goal ownership through project
        goal = GoalService.get_goal(session, task_data.goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found"
            )

        task = Task(
            id=uuid4(),
            goal_id=task_data.goal_id,
            title=task_data.title,
            description=task_data.description,
            estimate_hours=task_data.estimate_hours,
            due_date=task_data.due_date,
            status=TaskStatus.PENDING,
        )
        session.add(task)
        session.commit()
        session.refresh(task)
        return task

    @staticmethod
    def get_task(session: Session, task_id: Union[str, UUID], owner_id: Union[str, UUID]) -> Optional[Task]:
        """Get task by ID for specific owner"""
        statement = select(Task).join(Goal).join(Project).where(
            Task.id == task_id,
            Project.owner_id == owner_id
        )
        return session.exec(statement).first()

    @staticmethod
    def get_tasks_by_goal(session: Session, goal_id: Union[str, UUID], owner_id: Union[str, UUID], skip: int = 0, limit: int = 100) -> list[Task]:
        """Get tasks for specific goal"""
        # Verify goal ownership
        goal = GoalService.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found"
            )

        statement = select(Task).where(
            Task.goal_id == goal_id
        ).offset(skip).limit(limit)
        return list(session.exec(statement).all())

    @staticmethod
    def get_tasks_by_project(session: Session, project_id: Union[str, UUID], owner_id: Union[str, UUID], skip: int = 0, limit: int = 100) -> list[Task]:
        """Get all tasks for specific project"""
        # Verify project ownership
        project = ProjectService.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        statement = select(Task).join(Goal).where(
            Goal.project_id == project_id
        ).offset(skip).limit(limit)
        return list(session.exec(statement).all())

    @staticmethod
    def get_all_user_tasks(session: Session, owner_id: Union[str, UUID], skip: int = 0, limit: int = 100) -> list[Task]:
        """Get all tasks for a user across all projects"""
        statement = select(Task).join(Goal).join(Project).where(
            Project.owner_id == owner_id
        ).offset(skip).limit(limit)
        return list(session.exec(statement).all())

    @staticmethod
    def update_task(session: Session, task_id: Union[str, UUID], owner_id: Union[str, UUID], task_data: TaskUpdate) -> Task:
        """Update task"""
        task = TaskService.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found"
            )

        update_data = task_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(task, field, value)

        task.updated_at = datetime.utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        return task

    @staticmethod
    def delete_task(session: Session, task_id: Union[str, UUID], owner_id: Union[str, UUID]) -> bool:
        """Delete task"""
        task = TaskService.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found"
            )

        session.delete(task)
        session.commit()
        return True