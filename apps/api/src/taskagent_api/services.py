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
    LogCreate,
    LogUpdate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    Task,
    TaskCreate,
    TaskUpdate,
    TaskDependency,
    User,
    UserCreate,
    UserUpdate,
    WeeklyRecurringTask,
    WeeklyRecurringTaskCreate,
    WeeklyRecurringTaskUpdate,
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

    def add_task_dependency(
        self,
        session: Session,
        task_id: str | UUID,
        depends_on_task_id: str | UUID,
        owner_id: str | UUID,
    ) -> TaskDependency:
        """Add a dependency to a task"""
        # Verify both tasks exist and belong to the owner
        task = self.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )

        depends_on_task = self.get_task(session, depends_on_task_id, owner_id)
        if not depends_on_task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dependency task not found",
            )

        # Check for circular dependency
        if task_id == depends_on_task_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task cannot depend on itself",
            )

        # Check if dependency already exists
        existing = session.exec(
            select(TaskDependency)
            .where(TaskDependency.task_id == task_id)
            .where(TaskDependency.depends_on_task_id == depends_on_task_id)
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dependency already exists",
            )

        # Create dependency
        dependency = TaskDependency(
            task_id=task_id, depends_on_task_id=depends_on_task_id
        )
        session.add(dependency)
        session.commit()
        session.refresh(dependency)

        # Invalidate task cache
        invalidate_cache("medium", "task_detail")

        return dependency

    def get_task_dependencies(
        self, session: Session, task_id: str | UUID, owner_id: str | UUID
    ) -> list[TaskDependency]:
        """Get all dependencies for a task"""
        # Verify task ownership
        task = self.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )

        dependencies = session.exec(
            select(TaskDependency).where(TaskDependency.task_id == task_id)
        ).all()

        # Load the depends_on_task for each dependency
        for dep in dependencies:
            dep.depends_on_task = session.get(Task, dep.depends_on_task_id)

        return dependencies

    def delete_task_dependency(
        self,
        session: Session,
        task_id: str | UUID,
        dependency_id: str | UUID,
        owner_id: str | UUID,
    ) -> bool:
        """Delete a task dependency"""
        # Verify task ownership
        task = self.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )

        dependency = session.get(TaskDependency, dependency_id)
        if not dependency or dependency.task_id != UUID(str(task_id)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dependency not found"
            )

        session.delete(dependency)
        session.commit()

        # Invalidate task cache
        invalidate_cache("medium", "task_detail")

        return True


class LogService(BaseService[Log, LogCreate, LogUpdate]):
    """Log service using base service"""

    def __init__(self, task_service: TaskService = None):
        super().__init__(Log)
        self.task_service = task_service or TaskService()

    def _create_instance(self, data: LogCreate, user_id: str | UUID, **kwargs) -> Log:
        """Create a new log instance"""
        return Log(
            task_id=data.task_id,
            actual_minutes=data.actual_minutes,
            comment=data.comment,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for log ownership through task, goal and project"""
        return Log.task_id.in_(
            select(Task.id).where(
                Task.goal_id.in_(
                    select(Goal.id).where(
                        Goal.project_id.in_(
                            select(Project.id).where(Project.owner_id == user_id)
                        )
                    )
                )
            )
        )

    def create_log(
        self, session: Session, log_data: LogCreate, owner_id: str | UUID
    ) -> Log:
        """Create a new work time log"""
        # Verify task ownership through goal and project
        task = self.task_service.get_task(session, log_data.task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )
        return self.create(session, log_data, owner_id)

    @cached(cache_type="medium", key_prefix="log_detail")
    def get_log(
        self, session: Session, log_id: str | UUID, owner_id: str | UUID
    ) -> Log | None:
        """Get log by ID for specific owner"""
        return self.get_by_id(session, log_id, owner_id)

    @cached(cache_type="short", key_prefix="logs_by_task")
    def get_logs_by_task(
        self,
        session: Session,
        task_id: str | UUID,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Log]:
        """Get logs for specific task"""
        # Verify task ownership
        task = self.task_service.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )
        return self.get_all(session, owner_id, skip, limit, task_id=task_id)

    def get_logs_batch(
        self,
        session: Session,
        task_ids: list[str | UUID],
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> dict[str, list[Log]]:
        """Get logs for multiple tasks efficiently in a single query"""
        from sqlmodel import select, and_

        result = {}

        # First, verify task ownership for all tasks
        # Get all tasks that belong to the user through their goals and projects
        task_query = (
            select(Task)
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(and_(Project.owner_id == owner_id, Task.id.in_(task_ids)))
        )
        valid_tasks = session.exec(task_query).all()
        valid_task_ids = {str(task.id) for task in valid_tasks}

        # Initialize result with empty lists for all requested tasks
        for task_id in task_ids:
            result[str(task_id)] = []

        # If no valid tasks found, return empty results
        if not valid_task_ids:
            return result

        # Fetch all logs for valid tasks in a single query
        logs_query = (
            select(Log)
            .where(Log.task_id.in_(valid_task_ids))
            .order_by(Log.created_at.desc())
            .offset(skip)
            .limit(limit * len(valid_task_ids))  # Adjust limit for multiple tasks
        )

        all_logs = session.exec(logs_query).all()

        # Group logs by task_id
        for log in all_logs:
            task_id_str = str(log.task_id)
            if task_id_str in result:
                # Respect per-task limit
                if len(result[task_id_str]) < limit:
                    result[task_id_str].append(log)

        return result

    def update_log(
        self,
        session: Session,
        log_id: str | UUID,
        owner_id: str | UUID,
        log_data: LogUpdate,
    ) -> Log:
        """Update log"""
        result = self.update(session, log_id, log_data, owner_id)
        # Invalidate caches that might contain this log's data
        invalidate_cache("short", "logs_by_task")
        invalidate_cache("medium", "log_detail")
        return result

    def delete_log(
        self, session: Session, log_id: str | UUID, owner_id: str | UUID
    ) -> bool:
        """Delete log"""
        result = self.delete(session, log_id, owner_id)
        # Invalidate caches that might contain this log's data
        invalidate_cache("short", "logs_by_task")
        invalidate_cache("medium", "log_detail")
        return result


class WeeklyRecurringTaskService(
    BaseService[
        WeeklyRecurringTask, WeeklyRecurringTaskCreate, WeeklyRecurringTaskUpdate
    ]
):
    """Weekly recurring task service using base service"""

    def __init__(self):
        super().__init__(WeeklyRecurringTask)

    def _create_instance(
        self, data: WeeklyRecurringTaskCreate, user_id: str | UUID, **kwargs
    ) -> WeeklyRecurringTask:
        """Create a new weekly recurring task instance"""
        return WeeklyRecurringTask(
            user_id=user_id,
            title=data.title,
            description=data.description,
            estimate_hours=data.estimate_hours,
            category=data.category,
            is_active=data.is_active,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for weekly recurring task ownership"""
        return WeeklyRecurringTask.user_id == user_id

    @cached(cache_type="short", key_prefix="weekly_recurring_tasks_list")
    def get_weekly_recurring_tasks(
        self,
        session: Session,
        user_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
        category: str | None = None,
        is_active: bool | None = None,
    ) -> list[WeeklyRecurringTask]:
        """Get weekly recurring tasks for specific user with optional filters"""
        statement = select(WeeklyRecurringTask).where(
            WeeklyRecurringTask.user_id == user_id
        )

        if category is not None:
            statement = statement.where(WeeklyRecurringTask.category == category)

        if is_active is not None:
            statement = statement.where(WeeklyRecurringTask.is_active == is_active)

        statement = (
            statement.order_by(WeeklyRecurringTask.created_at.desc())
            .offset(skip)
            .limit(limit)
        )

        return list(session.exec(statement).all())

    @cached(cache_type="medium", key_prefix="weekly_recurring_task_detail")
    def get_weekly_recurring_task(
        self, session: Session, task_id: str | UUID, user_id: str | UUID
    ) -> WeeklyRecurringTask | None:
        """Get weekly recurring task by ID for specific user"""
        return self.get_by_id(session, task_id, user_id)

    def create_weekly_recurring_task(
        self,
        session: Session,
        task_data: WeeklyRecurringTaskCreate,
        user_id: str | UUID,
    ) -> WeeklyRecurringTask:
        """Create a new weekly recurring task"""
        result = self.create(session, task_data, user_id)
        # Invalidate cache after creation
        invalidate_cache("short", f"weekly_recurring_tasks_list:{user_id}")
        return result

    def update_weekly_recurring_task(
        self,
        session: Session,
        task_id: str | UUID,
        user_id: str | UUID,
        task_data: WeeklyRecurringTaskUpdate,
    ) -> WeeklyRecurringTask:
        """Update weekly recurring task"""
        result = self.update(session, task_id, task_data, user_id)
        # Invalidate cache after update
        invalidate_cache("short", f"weekly_recurring_tasks_list:{user_id}")
        invalidate_cache("medium", f"weekly_recurring_task_detail:{task_id}:{user_id}")
        return result

    def delete_weekly_recurring_task(
        self, session: Session, task_id: str | UUID, user_id: str | UUID
    ) -> bool:
        """Delete weekly recurring task"""
        result = self.delete(session, task_id, user_id)
        # Invalidate cache after deletion
        invalidate_cache("short", f"weekly_recurring_tasks_list:{user_id}")
        invalidate_cache("medium", f"weekly_recurring_task_detail:{task_id}:{user_id}")
        return result


# Create service instances for use in routers
project_service = ProjectService()
goal_service = GoalService()
task_service = TaskService()
log_service = LogService()
weekly_recurring_task_service = WeeklyRecurringTaskService()
