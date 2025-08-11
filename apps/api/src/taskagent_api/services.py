"""
Refactored services using base service class
"""

from datetime import datetime, timezone, UTC
from uuid import UUID

from fastapi import HTTPException, status
from sqlmodel import Session, delete, select

from taskagent_api.base_service import BaseService
from taskagent_api.models import (
    Goal,
    GoalCreate,
    GoalUpdate,
    Log,
    Project,
    ProjectCreate,
    ProjectUpdate,
    Task,
    TaskCreate,
    TaskUpdate,
    User,
    UserCreate,
    UserUpdate,
)
from core.cache import cached, invalidate_cache, CacheManager


class UserService:
    """User service for authentication-related operations"""

    @staticmethod
    def create_user(
        session: Session, user_data: UserCreate, user_id: str | UUID
    ) -> User:
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
    def get_user(session: Session, user_id: str | UUID) -> User | None:
        """Get user by ID"""
        return session.get(User, user_id)

    @staticmethod
    def update_user(
        session: Session, user_id: str | UUID, user_data: UserUpdate
    ) -> User:
        """Update user"""
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )

        update_data = user_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)

        user.updated_at = datetime.now(UTC)
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


class ProjectService(BaseService[Project, ProjectCreate, ProjectUpdate]):
    """Project service using base service"""

    def __init__(self):
        super().__init__(Project)

    def _create_instance(
        self, data: ProjectCreate, user_id: str | UUID, **kwargs
    ) -> Project:
        """Create a new project instance"""
        return Project(
            owner_id=user_id,
            title=data.title,
            description=data.description,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for project ownership"""
        return Project.owner_id == user_id

    @cached(cache_type="short", key_prefix="projects_list")
    def get_projects(
        self, session: Session, owner_id: str | UUID, skip: int = 0, limit: int = 100
    ) -> list[Project]:
        """Get projects for specific owner"""
        return self.get_all(session, owner_id, skip, limit)

    @cached(cache_type="medium", key_prefix="project_detail")
    def get_project(
        self, session: Session, project_id: str | UUID, owner_id: str | UUID
    ) -> Project | None:
        """Get project by ID for specific owner"""
        return self.get_by_id(session, project_id, owner_id)

    def create_project(
        self, session: Session, project_data: ProjectCreate, owner_id: str | UUID
    ) -> Project:
        """Create a new project"""
        result = self.create(session, project_data, owner_id)
        # Invalidate cache after creation
        invalidate_cache("short", f"projects_list:{owner_id}")
        return result

    def update_project(
        self,
        session: Session,
        project_id: str | UUID,
        owner_id: str | UUID,
        project_data: ProjectUpdate,
    ) -> Project:
        """Update project"""
        result = self.update(session, project_id, project_data, owner_id)
        # Invalidate cache after update
        invalidate_cache("short", f"projects_list:{owner_id}")
        invalidate_cache("medium", f"project_detail:{project_id}:{owner_id}")
        return result

    def delete_project(
        self, session: Session, project_id: str | UUID, owner_id: str | UUID
    ) -> bool:
        """Delete project with optimized cascade deletion (fixes N+1 query problem)"""
        # Verify project exists and belongs to user
        project = self.get_by_id(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )

        try:
            # Check if database supports CASCADE DELETE by checking database URL
            # For PostgreSQL (production), we can use CASCADE DELETE
            # For SQLite (development), we use batch deletion
            use_cascade = self._supports_cascade_delete(session)

            if use_cascade:
                # DATABASE-LEVEL CASCADE DELETION (most efficient)
                # Simply deleting the project will cascade to all related records
                session.delete(project)
                session.commit()
                return True
            else:
                # BATCH DELETION OPTIMIZATION (eliminates N+1 queries)
                return self._delete_project_with_batch_queries(
                    session, project, project_id
                )

        except Exception as e:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete project: {str(e)}",
            )

    def _supports_cascade_delete(self, session: Session) -> bool:
        """Check if the database supports CASCADE DELETE constraints"""
        try:
            # Get database engine name
            engine_name = session.bind.dialect.name.lower()
            # PostgreSQL and MySQL support CASCADE DELETE
            return engine_name in ("postgresql", "mysql")
        except:
            # Default to batch deletion if we can't determine database type
            return False

    def _delete_project_with_batch_queries(
        self, session: Session, project: Project, project_id: str | UUID
    ) -> bool:
        """Delete project using optimized batch queries (eliminates N+1 problem)"""
        # Step 1: Get all goal IDs for this project in a single query
        goal_ids_query = select(Goal.id).where(Goal.project_id == project_id)
        goal_ids = [row for row in session.exec(goal_ids_query).all()]

        if goal_ids:
            # Step 2: Get all task IDs for these goals in a single query
            task_ids_query = select(Task.id).where(Task.goal_id.in_(goal_ids))
            task_ids = [row for row in session.exec(task_ids_query).all()]

            if task_ids:
                # Step 3: Batch delete all logs for these tasks in a single query
                logs_delete = delete(Log).where(Log.task_id.in_(task_ids))
                session.exec(logs_delete)

                # Step 4: Batch delete all tasks in a single query
                tasks_delete = delete(Task).where(Task.id.in_(task_ids))
                session.exec(tasks_delete)

            # Step 5: Batch delete all goals in a single query
            goals_delete = delete(Goal).where(Goal.id.in_(goal_ids))
            session.exec(goals_delete)

        # Step 6: Delete the project
        session.delete(project)
        session.commit()

        # Invalidate cache after deletion
        invalidate_cache("short", f"projects_list:{project.owner_id}")
        invalidate_cache("medium", f"project_detail:{project_id}")

        return True


class GoalService(BaseService[Goal, GoalCreate, GoalUpdate]):
    """Goal service using base service"""

    def __init__(self):
        super().__init__(Goal)
        self.project_service = ProjectService()

    def _create_instance(self, data: GoalCreate, user_id: str | UUID, **kwargs) -> Goal:
        """Create a new goal instance"""
        return Goal(
            project_id=data.project_id,
            title=data.title,
            description=data.description,
            estimate_hours=data.estimate_hours,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for goal ownership through project"""
        return Goal.project_id.in_(
            select(Project.id).where(Project.owner_id == user_id)
        )

    def create_goal(
        self, session: Session, goal_data: GoalCreate, owner_id: str | UUID
    ) -> Goal:
        """Create a new goal"""
        # Verify project ownership
        project = self.project_service.get_project(
            session, goal_data.project_id, owner_id
        )
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )
        return self.create(session, goal_data, owner_id)

    @cached(cache_type="medium", key_prefix="goal_detail")
    def get_goal(
        self, session: Session, goal_id: str | UUID, owner_id: str | UUID
    ) -> Goal | None:
        """Get goal by ID for specific owner"""
        return self.get_by_id(session, goal_id, owner_id)

    @cached(cache_type="short", key_prefix="goals_by_project")
    def get_goals_by_project(
        self,
        session: Session,
        project_id: str | UUID,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Goal]:
        """Get goals for specific project"""
        # Verify project ownership
        project = self.project_service.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )
        return self.get_all(session, owner_id, skip, limit, project_id=project_id)

    def update_goal(
        self,
        session: Session,
        goal_id: str | UUID,
        owner_id: str | UUID,
        goal_data: GoalUpdate,
    ) -> Goal:
        """Update goal"""
        result = self.update(session, goal_id, goal_data, owner_id)
        # Invalidate caches that might contain this goal's data
        invalidate_cache("short", "goals_list")
        invalidate_cache("short", "goals_by_project")
        invalidate_cache("medium", "goal_detail")
        return result

    def delete_goal(
        self, session: Session, goal_id: str | UUID, owner_id: str | UUID
    ) -> bool:
        """Delete goal"""
        result = self.delete(session, goal_id, owner_id)
        # Invalidate caches that might contain this goal's data
        invalidate_cache("short", "goals_list")
        invalidate_cache("short", "goals_by_project")
        invalidate_cache("medium", "goal_detail")
        return result


class TaskService(BaseService[Task, TaskCreate, TaskUpdate]):
    """Task service using base service"""

    def __init__(
        self, goal_service: GoalService = None, project_service: ProjectService = None
    ):
        super().__init__(Task)
        self.goal_service = goal_service or GoalService()
        self.project_service = project_service or ProjectService()

    def _create_instance(self, data: TaskCreate, user_id: str | UUID, **kwargs) -> Task:
        """Create a new task instance"""
        return Task(
            goal_id=data.goal_id,
            title=data.title,
            description=data.description,
            estimate_hours=data.estimate_hours,
            due_date=data.due_date,
            status=data.status,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for task ownership through goal and project"""
        return Task.goal_id.in_(
            select(Goal.id).where(
                Goal.project_id.in_(
                    select(Project.id).where(Project.owner_id == user_id)
                )
            )
        )

    def create_task(
        self, session: Session, task_data: TaskCreate, owner_id: str | UUID
    ) -> Task:
        """Create a new task"""
        # Verify goal ownership through project
        goal = self.goal_service.get_goal(session, task_data.goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )
        return self.create(session, task_data, owner_id)

    @cached(cache_type="medium", key_prefix="task_detail")
    def get_task(
        self, session: Session, task_id: str | UUID, owner_id: str | UUID
    ) -> Task | None:
        """Get task by ID for specific owner"""
        return self.get_by_id(session, task_id, owner_id)

    @cached(cache_type="short", key_prefix="tasks_by_goal")
    def get_tasks_by_goal(
        self,
        session: Session,
        goal_id: str | UUID,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Task]:
        """Get tasks for specific goal"""
        # Verify goal ownership
        goal = self.goal_service.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )
        return self.get_all(session, owner_id, skip, limit, goal_id=goal_id)

    @cached(cache_type="short", key_prefix="tasks_by_project")
    def get_tasks_by_project(
        self,
        session: Session,
        project_id: str | UUID,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Task]:
        """Get all tasks for specific project"""
        # Verify project ownership
        project = self.project_service.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )

        statement = (
            select(Task)
            .join(Goal)
            .where(Goal.project_id == project_id)
            .offset(skip)
            .limit(limit)
        )
        return list(session.exec(statement).all())

    def get_all_user_tasks(
        self, session: Session, owner_id: str | UUID, skip: int = 0, limit: int = 100
    ) -> list[Task]:
        """Get all tasks for a user across all projects"""
        return self.get_all(session, owner_id, skip, limit)

    def update_task(
        self,
        session: Session,
        task_id: str | UUID,
        owner_id: str | UUID,
        task_data: TaskUpdate,
    ) -> Task:
        """Update task"""
        result = self.update(session, task_id, task_data, owner_id)
        # Invalidate caches that might contain this task's data
        invalidate_cache("short", "tasks_list")
        invalidate_cache("short", "tasks_by_goal")
        invalidate_cache("short", "tasks_by_project")
        invalidate_cache("medium", "task_detail")
        return result

    def delete_task(
        self, session: Session, task_id: str | UUID, owner_id: str | UUID
    ) -> bool:
        """Delete task"""
        result = self.delete(session, task_id, owner_id)
        # Invalidate caches that might contain this task's data
        invalidate_cache("short", "tasks_list")
        invalidate_cache("short", "tasks_by_goal")
        invalidate_cache("short", "tasks_by_project")
        invalidate_cache("medium", "task_detail")
        return result


# Create service instances for use in routers
project_service = ProjectService()
goal_service = GoalService()
task_service = TaskService()
