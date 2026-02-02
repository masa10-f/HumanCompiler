"""
Refactored services using base service class
"""

from datetime import datetime, UTC
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, delete, func, select

from humancompiler_api.base_service import BaseService
from humancompiler_api.common.error_handlers import validate_uuid
from humancompiler_api.models import (
    Goal,
    GoalCreate,
    GoalUpdate,
    GoalStatus,
    GoalDependency,
    Log,
    LogCreate,
    LogUpdate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    Task,
    TaskCreate,
    TaskUpdate,
    TaskCategory,
    TaskDependency,
    User,
    UserCreate,
    UserUpdate,
    WeeklyRecurringTask,
    WeeklyRecurringTaskCreate,
    WeeklyRecurringTaskUpdate,
    WorkSession,
    WorkSessionStartRequest,
    WorkSessionCheckoutRequest,
    WorkSessionUpdate,
    WorkSessionPauseRequest,
    WorkSessionResumeRequest,
    CheckoutType,
    SessionDecision,
    ContinueReason,
    SortBy,
    SortOrder,
    QuickTask,
    QuickTaskCreate,
    QuickTaskUpdate,
    TaskStatus,
)
from core.cache import cached, invalidate_cache


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
            status=data.status,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for project ownership"""
        return Project.owner_id == user_id

    @cached(cache_type="short", key_prefix="projects_list")
    def get_projects(
        self,
        session: Session,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
        sort_by: SortBy = SortBy.STATUS,
        sort_order: SortOrder = SortOrder.ASC,
    ) -> list[Project]:
        """Get projects for specific owner with sorting"""
        return self.get_all(
            session,
            owner_id,
            skip,
            limit,
            sort_by=sort_by.value,
            sort_order=sort_order.value,
        )

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
        sort_by: SortBy = SortBy.STATUS,
        sort_order: SortOrder = SortOrder.ASC,
    ) -> list[Goal]:
        """Get goals for specific project with sorting"""
        # Verify project ownership
        project = self.project_service.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )
        return self.get_all(
            session,
            owner_id,
            skip,
            limit,
            sort_by=sort_by.value,
            sort_order=sort_order.value,
            project_id=project_id,
        )

    def update_goal(
        self,
        session: Session,
        goal_id: str | UUID,
        owner_id: str | UUID,
        goal_data: GoalUpdate,
    ) -> Goal:
        """Update goal with status transition validation"""
        # Get current goal to check status transition
        current_goal = self.get_by_id(session, goal_id, owner_id)
        if not current_goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )

        # Validate status transition if status is being updated
        if goal_data.status is not None and goal_data.status != current_goal.status:
            self._validate_status_transition(current_goal.status, goal_data.status)

        result = self.update(session, goal_id, goal_data, owner_id)
        # Invalidate caches that might contain this goal's data
        invalidate_cache("short", "goals_list")
        invalidate_cache("short", "goals_by_project")
        invalidate_cache("medium", "goal_detail")
        return result

    def _validate_status_transition(
        self, current_status: GoalStatus, new_status: GoalStatus
    ) -> None:
        """Validate goal status transitions according to business rules"""
        valid_transitions = {
            GoalStatus.PENDING: [GoalStatus.IN_PROGRESS, GoalStatus.CANCELLED],
            GoalStatus.IN_PROGRESS: [
                GoalStatus.COMPLETED,
                GoalStatus.CANCELLED,
                GoalStatus.PENDING,
            ],
            GoalStatus.COMPLETED: [
                GoalStatus.IN_PROGRESS,
                GoalStatus.PENDING,  # Allow resetting completed goals to pending
            ],
            GoalStatus.CANCELLED: [
                GoalStatus.PENDING,
                GoalStatus.IN_PROGRESS,
            ],  # Allow reactivating cancelled goals
        }

        allowed_transitions = valid_transitions.get(current_status, [])
        if new_status not in allowed_transitions:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid status transition from '{current_status.value}' to '{new_status.value}'",
            )

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

    def add_goal_dependency(
        self,
        session: Session,
        goal_id: str | UUID,
        depends_on_goal_id: str | UUID,
        owner_id: str | UUID,
    ) -> GoalDependency:
        """Add a dependency to a goal"""
        # Verify both goals exist and belong to the owner
        goal = self.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )

        depends_on_goal = self.get_goal(session, depends_on_goal_id, owner_id)
        if not depends_on_goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dependency goal not found",
            )

        # Check for circular dependency
        if goal_id == depends_on_goal_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Goal cannot depend on itself",
            )

        # Check if dependency already exists
        existing = session.exec(
            select(GoalDependency)
            .where(GoalDependency.goal_id == goal_id)
            .where(GoalDependency.depends_on_goal_id == depends_on_goal_id)
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dependency already exists",
            )

        # Create dependency
        dependency = GoalDependency(
            goal_id=goal_id, depends_on_goal_id=depends_on_goal_id
        )
        session.add(dependency)
        session.commit()
        session.refresh(dependency)

        # Invalidate goal cache
        invalidate_cache("medium", "goal_detail")

        return dependency

    def get_goal_dependencies(
        self, session: Session, goal_id: str | UUID, owner_id: str | UUID
    ) -> list[GoalDependency]:
        """Get all dependencies for a goal"""
        # Verify goal ownership
        goal = self.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )

        dependencies = session.exec(
            select(GoalDependency).where(GoalDependency.goal_id == goal_id)
        ).all()

        # Load the depends_on_goal for each dependency
        for dep in dependencies:
            dep.depends_on_goal = session.get(Goal, dep.depends_on_goal_id)

        return dependencies

    def delete_goal_dependency(
        self,
        session: Session,
        goal_id: str | UUID,
        dependency_id: str | UUID,
        owner_id: str | UUID,
    ) -> bool:
        """Delete a goal dependency"""
        # Verify goal ownership
        goal = self.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )

        dependency = session.get(GoalDependency, dependency_id)
        if not dependency or dependency.goal_id != UUID(str(goal_id)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dependency not found"
            )

        session.delete(dependency)
        session.commit()

        # Invalidate goal cache
        invalidate_cache("medium", "goal_detail")

        return True


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
            priority=data.priority,
            work_type=data.work_type,
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
        sort_by: SortBy = SortBy.STATUS,
        sort_order: SortOrder = SortOrder.ASC,
    ) -> list[Task]:
        """Get tasks for specific goal with sorting"""
        # Verify goal ownership
        goal = self.goal_service.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
            )
        return self.get_all(
            session,
            owner_id,
            skip,
            limit,
            sort_by=sort_by.value,
            sort_order=sort_order.value,
            goal_id=goal_id,
        )

    @cached(cache_type="short", key_prefix="tasks_by_project")
    def get_tasks_by_project(
        self,
        session: Session,
        project_id: str | UUID,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
        sort_by: SortBy = SortBy.STATUS,
        sort_order: SortOrder = SortOrder.ASC,
    ) -> list[Task]:
        """Get all tasks for specific project with sorting"""
        # Verify project ownership
        project = self.project_service.get_project(session, project_id, owner_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
            )

        statement = select(Task).join(Goal).where(Goal.project_id == project_id)

        # Add sorting logic
        if sort_by and hasattr(Task, sort_by.value):
            sort_column = getattr(Task, sort_by.value)

            # Handle status sorting with priority order
            if sort_by.value == "status":
                status_order = {
                    "pending": 1,
                    "in_progress": 2,
                    "completed": 3,
                    "cancelled": 4,
                }
                # Use CASE statement for status priority ordering
                from sqlalchemy import case

                order_expr = case(status_order, value=sort_column)
            else:
                order_expr = sort_column

            # Apply sort order
            if sort_order and sort_order.value.lower() == "desc":
                statement = statement.order_by(order_expr.desc())
            else:
                statement = statement.order_by(order_expr.asc())
        else:
            # Default ordering
            statement = statement.order_by(Task.created_at.desc())

        statement = statement.offset(skip).limit(limit)
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
        """Delete task with proper dependency cleanup"""
        # Verify task ownership first
        task = self.get_task(session, task_id, owner_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
            )

        try:
            # Delete all dependencies where this task is a dependency (depends_on_task)
            dependencies_as_dependency = session.exec(
                select(TaskDependency).where(
                    TaskDependency.depends_on_task_id == task_id
                )
            ).all()

            for dep in dependencies_as_dependency:
                session.delete(dep)

            # Delete all dependencies where this task has dependencies (task_id)
            dependencies_as_task = session.exec(
                select(TaskDependency).where(TaskDependency.task_id == task_id)
            ).all()

            for dep in dependencies_as_task:
                session.delete(dep)

            # Delete all logs associated with this task
            logs = session.exec(select(Log).where(Log.task_id == task_id)).all()

            for log in logs:
                session.delete(log)

            # Finally delete the task itself
            session.delete(task)
            session.commit()

            # Invalidate caches that might contain this task's data
            invalidate_cache("short", "tasks_list")
            invalidate_cache("short", "tasks_by_goal")
            invalidate_cache("short", "tasks_by_project")
            invalidate_cache("medium", "task_detail")

            return True

        except Exception as e:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete task: {str(e)}",
            )

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
        from uuid import uuid4

        dependency = TaskDependency(
            id=uuid4(), task_id=task_id, depends_on_task_id=depends_on_task_id
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
        category: TaskCategory | None = None,
        is_active: bool | None = None,
    ) -> list[WeeklyRecurringTask]:
        """Get weekly recurring tasks for specific user with optional filters"""
        user_id_validated = validate_uuid(user_id, "user_id")
        statement = select(WeeklyRecurringTask).where(
            WeeklyRecurringTask.user_id == user_id_validated,
            WeeklyRecurringTask.deleted_at.is_(None),  # Exclude soft deleted tasks
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

    def get_weekly_recurring_task(
        self, session: Session, task_id: str | UUID, user_id: str | UUID
    ) -> WeeklyRecurringTask | None:
        """Get weekly recurring task by ID for specific user"""
        task = session.exec(
            select(WeeklyRecurringTask).where(
                WeeklyRecurringTask.id == task_id,
                WeeklyRecurringTask.user_id == user_id,
                WeeklyRecurringTask.deleted_at.is_(None),  # Exclude soft deleted tasks
            )
        ).first()
        return task

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
        """Soft delete weekly recurring task"""
        task = self.get_weekly_recurring_task(session, task_id, user_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Weekly recurring task not found",
            )

        # Soft delete: set deleted_at timestamp
        task.deleted_at = datetime.now(UTC)
        task.updated_at = datetime.now(UTC)
        session.add(task)
        session.commit()

        # Invalidate cache after deletion
        invalidate_cache("short", f"weekly_recurring_tasks_list:{user_id}")
        invalidate_cache("medium", f"weekly_recurring_task_detail:{task_id}:{user_id}")
        return True


class WorkSessionService(
    BaseService[WorkSession, WorkSessionStartRequest, WorkSessionCheckoutRequest]
):
    """Work session service for Runner/Focus mode"""

    def __init__(
        self,
        task_service_instance: TaskService | None = None,
        log_service_instance: LogService | None = None,
    ):
        super().__init__(WorkSession)
        self._task_service = task_service_instance
        self._log_service = log_service_instance

    @property
    def task_service(self) -> TaskService:
        if self._task_service is None:
            self._task_service = TaskService()
        return self._task_service

    @property
    def log_service(self) -> LogService:
        if self._log_service is None:
            self._log_service = LogService()
        return self._log_service

    def _create_instance(
        self, data: WorkSessionStartRequest, user_id: str | UUID, **kwargs
    ) -> WorkSession:
        """Create a new work session instance"""
        return WorkSession(
            user_id=user_id,
            task_id=data.task_id,
            planned_checkout_at=data.planned_checkout_at,
            planned_outcome=data.planned_outcome,
            is_manual_execution=data.is_manual_execution,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for work session ownership"""
        return WorkSession.user_id == user_id

    def get_current_session(
        self, session: Session, user_id: str | UUID
    ) -> WorkSession | None:
        """Get the current active session for user (ended_at is NULL)"""
        user_id_validated = validate_uuid(user_id, "user_id")
        statement = select(WorkSession).where(
            WorkSession.user_id == user_id_validated,
            WorkSession.ended_at.is_(None),
        )
        return session.exec(statement).first()

    def start_session(
        self,
        session: Session,
        data: WorkSessionStartRequest,
        user_id: str | UUID,
    ) -> WorkSession:
        """Start a new work session

        Raises:
            HTTPException: 409 if an active session already exists
            HTTPException: 404 if the task is not found
        """
        user_id_validated = validate_uuid(user_id, "user_id")

        # Check for existing active session
        existing = self.get_current_session(session, user_id_validated)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active session already exists. Please end it first.",
            )

        # Verify task ownership
        task = self.task_service.get_task(session, data.task_id, user_id_validated)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )

        return self.create(session, data, user_id_validated)

    def checkout_session(
        self,
        session: Session,
        user_id: str | UUID,
        checkout_data: WorkSessionCheckoutRequest,
    ) -> tuple[WorkSession, Log]:
        """Checkout the current session and create a log entry

        Returns:
            Tuple of (updated WorkSession, created Log)

        Raises:
            HTTPException: 404 if no active session found
        """
        user_id_validated = validate_uuid(user_id, "user_id")

        # Get current session
        current_session = self.get_current_session(session, user_id_validated)
        if not current_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active session found",
            )

        # Validate: continue decision requires at least one KPT field
        if checkout_data.decision == SessionDecision.CONTINUE:
            has_kpt = bool(
                checkout_data.kpt_keep
                or checkout_data.kpt_problem
                or checkout_data.kpt_try
            )
            if not has_kpt:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="At least one KPT field is required when continuing",
                )

        # If session is paused, add current pause duration to total
        ended_at = datetime.now(UTC)
        total_paused_seconds = current_session.total_paused_seconds or 0

        if current_session.paused_at is not None:
            # Session is currently paused, add current pause duration
            paused_at = current_session.paused_at
            if paused_at.tzinfo is None:
                paused_at = paused_at.replace(tzinfo=UTC)
            current_pause_duration = int((ended_at - paused_at).total_seconds())
            total_paused_seconds += current_pause_duration
            # Clear paused_at since we're ending the session
            current_session.paused_at = None

        # Update total_paused_seconds in the session
        current_session.total_paused_seconds = total_paused_seconds

        # Calculate actual minutes (excluding paused time)
        started_at = current_session.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        total_elapsed_seconds = int((ended_at - started_at).total_seconds())
        actual_seconds = total_elapsed_seconds - total_paused_seconds
        actual_minutes = max(1, actual_seconds // 60)

        # Update session
        current_session.ended_at = ended_at
        current_session.checkout_type = checkout_data.checkout_type
        current_session.decision = checkout_data.decision
        current_session.continue_reason = checkout_data.continue_reason
        current_session.kpt_keep = checkout_data.kpt_keep
        current_session.kpt_problem = checkout_data.kpt_problem
        current_session.kpt_try = checkout_data.kpt_try
        current_session.remaining_estimate_hours = (
            checkout_data.remaining_estimate_hours
        )
        current_session.updated_at = ended_at

        # Create log entry with KPT summary
        kpt_summary = self._generate_kpt_summary(
            checkout_data.kpt_keep,
            checkout_data.kpt_problem,
            checkout_data.kpt_try,
        )

        log_data = LogCreate(
            task_id=current_session.task_id,
            actual_minutes=actual_minutes,
            comment=kpt_summary,
        )

        session.add(current_session)
        new_log = self.log_service.create_log(session, log_data, user_id_validated)

        # If remaining estimate is provided, update task.estimate_hours so that
        # (estimate_hours - actual_hours) ~= remaining_estimate_hours.
        if checkout_data.remaining_estimate_hours is not None:
            total_minutes = session.exec(
                select(func.coalesce(func.sum(Log.actual_minutes), 0)).where(
                    Log.task_id == current_session.task_id
                )
            ).one()
            total_minutes_int = int(total_minutes or 0)

            remaining_hours = checkout_data.remaining_estimate_hours.quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            new_estimate_hours = (
                Decimal(total_minutes_int) / Decimal(60) + remaining_hours
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            # Task.estimate_hours is constrained to NUMERIC(5,2) and must be > 0.
            max_estimate_hours = Decimal("999.99")
            if new_estimate_hours > max_estimate_hours:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Updated estimate_hours ({new_estimate_hours}h) exceeds "
                        f"maximum ({max_estimate_hours}h)"
                    ),
                )
            if new_estimate_hours <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Updated estimate_hours must be greater than 0",
                )

            task = self.task_service.get_task(
                session, current_session.task_id, user_id_validated
            )
            if not task:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Task not found",
                )

            task.estimate_hours = new_estimate_hours
            task.updated_at = ended_at
            session.add(task)
            session.flush()

            # Keep cache invalidation consistent with TaskService.update_task
            invalidate_cache("short", "tasks_list")
            invalidate_cache("short", "tasks_by_goal")
            invalidate_cache("short", "tasks_by_project")
            invalidate_cache("medium", "task_detail")

        session.commit()
        session.refresh(current_session)

        return current_session, new_log

    def get_sessions_by_task(
        self,
        session: Session,
        task_id: str | UUID,
        user_id: str | UUID,
        skip: int = 0,
        limit: int = 20,
    ) -> list[WorkSession]:
        """Get sessions for a specific task"""
        user_id_validated = validate_uuid(user_id, "user_id")
        task_id_validated = validate_uuid(task_id, "task_id")

        # Verify task ownership
        task = self.task_service.get_task(session, task_id_validated, user_id_validated)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )

        statement = (
            select(WorkSession)
            .where(
                WorkSession.user_id == user_id_validated,
                WorkSession.task_id == task_id_validated,
            )
            .order_by(WorkSession.started_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(session.exec(statement).all())

    def get_session_history(
        self,
        session: Session,
        user_id: str | UUID,
        skip: int = 0,
        limit: int = 20,
    ) -> list[WorkSession]:
        """Get all sessions for a user, ordered by started_at descending.

        Includes task relationship for display in history view.
        """
        user_id_validated = validate_uuid(user_id, "user_id")

        statement = (
            select(WorkSession)
            .options(
                selectinload(WorkSession.task)
            )  # Eager load task for history display
            .where(WorkSession.user_id == user_id_validated)
            .order_by(WorkSession.started_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(session.exec(statement).all())

    def _generate_kpt_summary(
        self,
        keep: str | None,
        problem: str | None,
        try_: str | None,
    ) -> str | None:
        """Generate KPT summary for log comment (max 500 chars)"""
        parts = []
        if keep:
            parts.append(f"K: {keep[:100]}")
        if problem:
            parts.append(f"P: {problem[:100]}")
        if try_:
            parts.append(f"T: {try_[:100]}")

        if not parts:
            return None

        summary = " | ".join(parts)
        return summary[:500] if len(summary) > 500 else summary

    def pause_session(
        self,
        session: Session,
        user_id: str | UUID,
    ) -> WorkSession:
        """Pause the current active session

        Sets paused_at to current time. Session remains active but time
        is not counted until resumed.

        Raises:
            HTTPException: 404 if no active session found
            HTTPException: 400 if session is already paused
        """
        user_id_validated = validate_uuid(user_id, "user_id")

        # Get current session
        current_session = self.get_current_session(session, user_id_validated)
        if not current_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active session found",
            )

        # Check if already paused
        if current_session.paused_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Session is already paused",
            )

        # Set paused_at
        current_session.paused_at = datetime.now(UTC)
        current_session.updated_at = datetime.now(UTC)

        session.add(current_session)
        session.commit()
        session.refresh(current_session)

        return current_session

    def resume_session(
        self,
        session: Session,
        user_id: str | UUID,
        resume_data: WorkSessionResumeRequest,
    ) -> WorkSession:
        """Resume a paused session

        Calculates pause duration and adds to total_paused_seconds.
        Optionally extends planned_checkout_at by the pause duration.

        Args:
            session: Database session
            user_id: User ID
            resume_data: Resume options including extend_checkout flag

        Returns:
            Updated WorkSession

        Raises:
            HTTPException: 404 if no active session found
            HTTPException: 400 if session is not paused
        """
        user_id_validated = validate_uuid(user_id, "user_id")

        # Get current session
        current_session = self.get_current_session(session, user_id_validated)
        if not current_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active session found",
            )

        # Check if actually paused
        if current_session.paused_at is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Session is not paused",
            )

        # Calculate pause duration
        now = datetime.now(UTC)
        paused_at = current_session.paused_at
        if paused_at.tzinfo is None:
            paused_at = paused_at.replace(tzinfo=UTC)
        pause_duration_seconds = int((now - paused_at).total_seconds())

        # Update total_paused_seconds
        current_session.total_paused_seconds = (
            current_session.total_paused_seconds or 0
        ) + pause_duration_seconds

        # Optionally extend planned_checkout_at
        if resume_data.extend_checkout:
            planned_checkout = current_session.planned_checkout_at
            if planned_checkout.tzinfo is None:
                planned_checkout = planned_checkout.replace(tzinfo=UTC)
            from datetime import timedelta

            current_session.planned_checkout_at = planned_checkout + timedelta(
                seconds=pause_duration_seconds
            )

        # Clear paused_at
        current_session.paused_at = None
        current_session.updated_at = now

        session.add(current_session)
        session.commit()
        session.refresh(current_session)

        return current_session

    def update_session_kpt(
        self,
        session: Session,
        session_id: str | UUID,
        user_id: str | UUID,
        update_data: WorkSessionUpdate,
    ) -> WorkSession:
        """Update KPT fields of a completed work session.

        Only allows updating KPT (Keep/Problem/Try) fields.
        Other session data cannot be modified after checkout.

        Args:
            session: Database session
            session_id: ID of the work session to update
            user_id: ID of the user (for ownership verification)
            update_data: KPT update data

        Returns:
            Updated WorkSession

        Raises:
            HTTPException: 404 if session not found or not owned by user
            HTTPException: 400 if session is still active (ended_at is None)
        """
        user_id_validated = validate_uuid(user_id, "user_id")
        session_id_validated = validate_uuid(session_id, "session_id")

        work_session = session.exec(
            select(WorkSession).where(
                WorkSession.id == session_id_validated,
                WorkSession.user_id == user_id_validated,
            )
        ).first()

        if not work_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Work session not found",
            )

        if work_session.ended_at is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit KPT of an active session",
            )

        # Update KPT fields: empty string clears the field, None means no change
        if update_data.kpt_keep is not None:
            work_session.kpt_keep = update_data.kpt_keep or None
        if update_data.kpt_problem is not None:
            work_session.kpt_problem = update_data.kpt_problem or None
        if update_data.kpt_try is not None:
            work_session.kpt_try = update_data.kpt_try or None

        work_session.updated_at = datetime.now(UTC)
        session.add(work_session)
        session.commit()
        session.refresh(work_session)

        return work_session


class QuickTaskService(BaseService[QuickTask, QuickTaskCreate, QuickTaskUpdate]):
    """QuickTask service for unclassified tasks not belonging to any project"""

    def __init__(
        self,
        goal_service_instance: GoalService | None = None,
        task_service_instance: TaskService | None = None,
    ):
        super().__init__(QuickTask)
        self._goal_service = goal_service_instance
        self._task_service = task_service_instance

    @property
    def goal_service(self) -> GoalService:
        if self._goal_service is None:
            self._goal_service = GoalService()
        return self._goal_service

    @property
    def task_service(self) -> TaskService:
        if self._task_service is None:
            self._task_service = TaskService()
        return self._task_service

    def _create_instance(
        self, data: QuickTaskCreate, user_id: str | UUID, **kwargs
    ) -> QuickTask:
        """Create a new quick task instance"""
        return QuickTask(
            owner_id=user_id,
            title=data.title,
            description=data.description,
            estimate_hours=data.estimate_hours,
            due_date=data.due_date,
            status=data.status,
            work_type=data.work_type,
            priority=data.priority,
        )

    def _get_user_filter(self, user_id: str | UUID):
        """Get filter for quick task ownership"""
        return QuickTask.owner_id == user_id

    @cached(cache_type="short", key_prefix="quick_tasks_list")
    def get_quick_tasks(
        self,
        session: Session,
        owner_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
        sort_by: SortBy = SortBy.CREATED_AT,
        sort_order: SortOrder = SortOrder.DESC,
        status: TaskStatus | None = None,
    ) -> list[QuickTask]:
        """Get quick tasks for specific owner with optional filters and sorting"""
        filters = {}
        if status is not None:
            filters["status"] = status

        return self.get_all(
            session,
            owner_id,
            skip,
            limit,
            sort_by=sort_by.value,
            sort_order=sort_order.value,
            **filters,
        )

    @cached(cache_type="medium", key_prefix="quick_task_detail")
    def get_quick_task(
        self, session: Session, task_id: str | UUID, owner_id: str | UUID
    ) -> QuickTask | None:
        """Get quick task by ID for specific owner"""
        return self.get_by_id(session, task_id, owner_id)

    def create_quick_task(
        self, session: Session, task_data: QuickTaskCreate, owner_id: str | UUID
    ) -> QuickTask:
        """Create a new quick task"""
        result = self.create(session, task_data, owner_id)
        # Invalidate cache after creation
        invalidate_cache("short", f"quick_tasks_list:{owner_id}")
        return result

    def update_quick_task(
        self,
        session: Session,
        task_id: str | UUID,
        owner_id: str | UUID,
        task_data: QuickTaskUpdate,
    ) -> QuickTask:
        """Update quick task"""
        result = self.update(session, task_id, task_data, owner_id)
        # Invalidate cache after update
        invalidate_cache("short", f"quick_tasks_list:{owner_id}")
        invalidate_cache("medium", f"quick_task_detail:{task_id}:{owner_id}")
        return result

    def delete_quick_task(
        self, session: Session, task_id: str | UUID, owner_id: str | UUID
    ) -> bool:
        """Delete quick task"""
        result = self.delete(session, task_id, owner_id)
        # Invalidate cache after deletion
        invalidate_cache("short", f"quick_tasks_list:{owner_id}")
        invalidate_cache("medium", f"quick_task_detail:{task_id}:{owner_id}")
        return result

    def convert_to_task(
        self,
        session: Session,
        quick_task_id: str | UUID,
        goal_id: str | UUID,
        owner_id: str | UUID,
    ) -> Task:
        """Convert a quick task to a regular task by assigning it to a goal

        Args:
            session: Database session
            quick_task_id: ID of the quick task to convert
            goal_id: Target goal ID to move the task to
            owner_id: Owner ID for validation

        Returns:
            The newly created Task

        Raises:
            HTTPException: If quick task or goal not found
        """
        # Get the quick task
        quick_task = self.get_quick_task(session, quick_task_id, owner_id)
        if not quick_task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Quick task not found",
            )

        # Verify goal ownership
        goal = self.goal_service.get_goal(session, goal_id, owner_id)
        if not goal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found",
            )

        # Create a new regular task with the quick task's data
        task_data = TaskCreate(
            title=quick_task.title,
            description=quick_task.description,
            estimate_hours=quick_task.estimate_hours,
            due_date=quick_task.due_date,
            work_type=quick_task.work_type,
            priority=quick_task.priority,
            goal_id=goal_id,
        )
        new_task = self.task_service.create_task(session, task_data, owner_id)

        # Delete the quick task
        self.delete_quick_task(session, quick_task_id, owner_id)

        return new_task

    def get_active_quick_tasks(
        self,
        session: Session,
        owner_id: str | UUID,
    ) -> list[QuickTask]:
        """Get all active (non-completed, non-cancelled) quick tasks for scheduling"""
        return self.get_quick_tasks(
            session,
            owner_id,
            limit=1000,  # Get all active tasks
            sort_by=SortBy.PRIORITY,
            sort_order=SortOrder.ASC,
        )


# Create service instances for use in routers
project_service = ProjectService()
goal_service = GoalService()
task_service = TaskService()
log_service = LogService()
weekly_recurring_task_service = WeeklyRecurringTaskService()
work_session_service = WorkSessionService()
quick_task_service = QuickTaskService()
