from datetime import datetime, timezone, UTC
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict, field_serializer, field_validator
from sqlalchemy import JSON, text, UUID as SQLAlchemyUUID
from sqlalchemy import Enum as SQLEnum
from sqlmodel import Column, Relationship, SQLModel
from sqlmodel import Field as SQLField


class TaskStatus(str, Enum):
    """Task status enum"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class GoalStatus(str, Enum):
    """Goal status enum"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class TaskCategory(str, Enum):
    """Weekly recurring task category enum"""

    MEETING = "meeting"
    STUDY = "study"
    EXERCISE = "exercise"
    HOBBY = "hobby"
    ADMIN = "admin"
    MAINTENANCE = "maintenance"
    REVIEW = "review"
    OTHER = "other"


class WorkType(str, Enum):
    """Work type classification for tasks"""

    LIGHT_WORK = "light_work"
    STUDY = "study"
    FOCUSED_WORK = "focused_work"


# Database Models (SQLModel)
class UserBase(SQLModel):
    """Base user model"""

    email: str = SQLField(unique=True, index=True)


class User(UserBase, table=True):  # type: ignore[call-arg]
    """User database model"""

    __tablename__ = "users"

    id: UUID | None = SQLField(default=None, primary_key=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    projects: list["Project"] = Relationship(back_populates="owner")
    schedules: list["Schedule"] = Relationship(back_populates="user")
    weekly_schedules: list["WeeklySchedule"] = Relationship(back_populates="user")
    weekly_recurring_tasks: list["WeeklyRecurringTask"] = Relationship(
        back_populates="user"
    )
    settings: "UserSettings" = Relationship(back_populates="user")
    api_usage_logs: list["ApiUsageLog"] = Relationship(back_populates="user")


class ProjectBase(SQLModel):
    """Base project model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)


class Project(ProjectBase, table=True):  # type: ignore[call-arg]
    """Project database model"""

    __tablename__ = "projects"

    id: UUID | None = SQLField(default=None, primary_key=True)
    owner_id: UUID = SQLField(foreign_key="users.id")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    owner: User = Relationship(back_populates="projects")
    goals: list["Goal"] = Relationship(back_populates="project")


class GoalBase(SQLModel):
    """Base goal model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)
    start_date: datetime | None = SQLField(
        default=None, description="Goal start date for timeline visualization"
    )
    end_date: datetime | None = SQLField(
        default=None, description="Goal end date for timeline visualization"
    )
    status: GoalStatus = SQLField(
        default=GoalStatus.PENDING,
        sa_column=Column(
            SQLEnum(GoalStatus, values_callable=lambda x: [e.value for e in x])
        ),
    )


class Goal(GoalBase, table=True):  # type: ignore[call-arg]
    """Goal database model"""

    __tablename__ = "goals"

    id: UUID | None = SQLField(default=None, primary_key=True)
    project_id: UUID = SQLField(foreign_key="projects.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    project: Project = Relationship(back_populates="goals")
    tasks: list["Task"] = Relationship(back_populates="goal")
    dependencies: list["GoalDependency"] = Relationship(
        back_populates="goal",
        sa_relationship_kwargs={"foreign_keys": "GoalDependency.goal_id"},
    )
    dependent_goals: list["GoalDependency"] = Relationship(
        back_populates="depends_on_goal",
        sa_relationship_kwargs={"foreign_keys": "GoalDependency.depends_on_goal_id"},
    )


class TaskBase(SQLModel):
    """Base task model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)
    due_date: datetime | None = SQLField(default=None)
    status: TaskStatus = SQLField(
        default=TaskStatus.PENDING,
        sa_column=Column(
            SQLEnum(TaskStatus, values_callable=lambda x: [e.value for e in x])
        ),
    )
    work_type: WorkType = SQLField(
        default=WorkType.LIGHT_WORK,
        sa_column=Column(
            SQLEnum(WorkType, values_callable=lambda x: [e.value for e in x])
        ),
        description="Work type classification for scheduling optimization",
    )


class Task(TaskBase, table=True):  # type: ignore[call-arg]
    """Task database model"""

    __tablename__ = "tasks"

    id: UUID | None = SQLField(default=None, primary_key=True)
    goal_id: UUID = SQLField(foreign_key="goals.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    goal: Goal = Relationship(back_populates="tasks")
    logs: list["Log"] = Relationship(back_populates="task")
    dependencies: list["TaskDependency"] = Relationship(
        back_populates="task",
        sa_relationship_kwargs={"foreign_keys": "TaskDependency.task_id"},
    )
    dependent_tasks: list["TaskDependency"] = Relationship(
        back_populates="depends_on_task",
        sa_relationship_kwargs={"foreign_keys": "TaskDependency.depends_on_task_id"},
    )


class GoalDependencyBase(SQLModel):
    """Base goal dependency model"""

    pass


class GoalDependency(GoalDependencyBase, table=True):  # type: ignore[call-arg]
    """Goal dependency database model"""

    __tablename__ = "goal_dependencies"
    __table_args__ = {"extend_existing": True}

    id: UUID | None = SQLField(
        default=None,
        sa_column=Column(
            "id",
            SQLAlchemyUUID,
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
    )
    goal_id: UUID = SQLField(foreign_key="goals.id", ondelete="CASCADE")
    depends_on_goal_id: UUID = SQLField(foreign_key="goals.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    goal: "Goal" = Relationship(
        back_populates="dependencies",
        sa_relationship_kwargs={"foreign_keys": "[GoalDependency.goal_id]"},
    )
    depends_on_goal: "Goal" = Relationship(
        back_populates="dependent_goals",
        sa_relationship_kwargs={"foreign_keys": "[GoalDependency.depends_on_goal_id]"},
    )


class TaskDependencyBase(SQLModel):
    """Base task dependency model"""

    pass


class TaskDependency(TaskDependencyBase, table=True):  # type: ignore[call-arg]
    """Task dependency database model"""

    __tablename__ = "task_dependencies"
    __table_args__ = {"extend_existing": True}

    id: UUID | None = SQLField(
        default=None,
        sa_column=Column(
            "id",
            SQLAlchemyUUID,
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
    )
    task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE")
    depends_on_task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    task: Task = Relationship(
        back_populates="dependencies",
        sa_relationship_kwargs={"foreign_keys": "[TaskDependency.task_id]"},
    )
    depends_on_task: Task = Relationship(
        back_populates="dependent_tasks",
        sa_relationship_kwargs={"foreign_keys": "[TaskDependency.depends_on_task_id]"},
    )


class ScheduleBase(SQLModel):
    """Base schedule model"""

    date: datetime = SQLField()
    plan_json: dict[str, Any] = SQLField(sa_column=Column(JSON), default_factory=dict)


class Schedule(ScheduleBase, table=True):  # type: ignore[call-arg]
    """Schedule database model for daily schedules"""

    __tablename__ = "schedules"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User = Relationship(back_populates="schedules")


class WeeklyRecurringTaskBase(SQLModel):
    """Base weekly recurring task model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)
    category: TaskCategory = SQLField(
        default=TaskCategory.OTHER,
        description="Task category from predefined enum values",
    )
    is_active: bool = SQLField(
        default=True, description="Whether this recurring task is active"
    )
    deleted_at: datetime | None = SQLField(
        default=None, description="Timestamp when the task was soft deleted"
    )


class WeeklyRecurringTask(WeeklyRecurringTaskBase, table=True):  # type: ignore[call-arg]
    """Weekly recurring task database model for storing weekly recurring tasks"""

    __tablename__ = "weekly_recurring_tasks"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)
    category: TaskCategory = SQLField(
        default=TaskCategory.OTHER,
        sa_column=Column(
            SQLEnum(TaskCategory, values_callable=lambda x: [e.value for e in x])
        ),
        description="Task category from predefined enum values",
    )
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User = Relationship(back_populates="weekly_recurring_tasks")


class WeeklyScheduleBase(SQLModel):
    """Base weekly schedule model"""

    week_start_date: datetime = SQLField(description="Start date of the week (Monday)")
    schedule_json: dict[str, Any] = SQLField(
        sa_column=Column(JSON),
        default_factory=dict,
        description="Weekly schedule data including selected tasks and project allocations",
    )


class WeeklySchedule(WeeklyScheduleBase, table=True):  # type: ignore[call-arg]
    """Weekly schedule database model for storing weekly task selection"""

    __tablename__ = "weekly_schedules"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User = Relationship(back_populates="weekly_schedules")


class LogBase(SQLModel):
    """Base log model"""

    actual_minutes: int = SQLField(gt=0)
    comment: str | None = SQLField(default=None, max_length=500)


class Log(LogBase, table=True):  # type: ignore[call-arg]
    """Log database model"""

    __tablename__ = "logs"

    id: UUID | None = SQLField(default=None, primary_key=True)
    task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    task: Task = Relationship(back_populates="logs")


class UserSettingsBase(SQLModel):
    """Base user settings model"""

    openai_api_key_encrypted: str | None = SQLField(default=None, max_length=500)
    openai_model: str = SQLField(default="gpt-5", max_length=50)
    ai_features_enabled: bool = SQLField(default=False)


class UserSettings(UserSettingsBase, table=True):
    """User settings database model"""

    __tablename__ = "user_settings"

    id: UUID | None = SQLField(
        default=None,
        sa_column=Column(
            "id",
            SQLAlchemyUUID,
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
    )
    user_id: UUID = SQLField(foreign_key="users.id", unique=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User = Relationship(back_populates="settings")


class ApiUsageLogBase(SQLModel):
    """Base API usage log model"""

    endpoint: str = SQLField(max_length=100)
    tokens_used: int = SQLField(default=0)
    cost_usd: Decimal = SQLField(default=0, max_digits=10, decimal_places=4)
    response_status: str = SQLField(max_length=20)


class ApiUsageLog(ApiUsageLogBase, table=True):
    """API usage log database model"""

    __tablename__ = "api_usage_logs"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id")
    request_timestamp: datetime | None = SQLField(
        default_factory=lambda: datetime.now(UTC)
    )

    # Relationships
    user: User = Relationship(back_populates="api_usage_logs")


# API Request/Response Models (Pydantic)
class UserCreate(UserBase):
    """User creation request"""

    pass


class UserUpdate(BaseModel):
    """User update request"""

    email: str | None = Field(None, min_length=1)


class UserResponse(UserBase):
    """User response model"""

    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectCreate(ProjectBase):
    """Project creation request"""

    pass


class ProjectUpdate(BaseModel):
    """Project update request"""

    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)


class ProjectResponse(ProjectBase):
    """Project response model"""

    id: UUID
    owner_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GoalCreate(GoalBase):
    """Goal creation request"""

    project_id: UUID


class GoalUpdate(BaseModel):
    """Goal update request"""

    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    estimate_hours: Decimal | None = Field(None, gt=0)
    status: GoalStatus | None = None

    @field_validator("status")
    @classmethod
    def validate_status_transition(cls, v: GoalStatus | None) -> GoalStatus | None:
        """Validate goal status transitions according to business rules"""
        if v is None:
            return v

        # Define valid status transitions
        valid_transitions = {
            GoalStatus.PENDING: [GoalStatus.IN_PROGRESS, GoalStatus.CANCELLED],
            GoalStatus.IN_PROGRESS: [GoalStatus.COMPLETED, GoalStatus.CANCELLED],
            GoalStatus.COMPLETED: [
                GoalStatus.IN_PROGRESS
            ],  # Allow reopening completed goals
            GoalStatus.CANCELLED: [
                GoalStatus.PENDING,
                GoalStatus.IN_PROGRESS,
            ],  # Allow reactivating cancelled goals
        }

        # For creation, any status is valid
        # For updates, validation happens in the service layer with current status context
        return v


class GoalResponse(GoalBase):
    """Goal response model"""

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime
    dependencies: list["GoalDependencyResponse"] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("estimate_hours")
    def serialize_estimate_hours(self, value: Decimal) -> float:
        """Convert Decimal to float for JSON serialization"""
        return float(value)


class TaskCreate(TaskBase):
    """Task creation request"""

    goal_id: UUID


class TaskUpdate(BaseModel):
    """Task update request"""

    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    estimate_hours: Decimal | None = Field(None, gt=0)
    due_date: datetime | None = None
    status: TaskStatus | None = None
    work_type: WorkType | None = None


class TaskResponse(TaskBase):
    """Task response model"""

    id: UUID
    goal_id: UUID
    created_at: datetime
    updated_at: datetime
    dependencies: list["TaskDependencyResponse"] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("estimate_hours")
    def serialize_estimate_hours(self, value: Decimal) -> float:
        """Convert Decimal to float for JSON serialization"""
        return float(value)


class ScheduleCreate(ScheduleBase):
    """Schedule creation request"""

    pass


class ScheduleUpdate(BaseModel):
    """Schedule update request"""

    date: datetime | None = None
    plan_json: dict[str, Any] | None = None


class ScheduleResponse(ScheduleBase):
    """Schedule response model"""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WeeklyScheduleCreate(WeeklyScheduleBase):
    """Weekly schedule creation request"""

    pass


class WeeklyScheduleUpdate(BaseModel):
    """Weekly schedule update request"""

    week_start_date: datetime | None = None
    schedule_json: dict[str, Any] | None = None


class WeeklyScheduleResponse(WeeklyScheduleBase):
    """Weekly schedule response model"""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WeeklyRecurringTaskCreate(WeeklyRecurringTaskBase):
    """Weekly recurring task creation request"""

    pass


class WeeklyRecurringTaskUpdate(BaseModel):
    """Weekly recurring task update request"""

    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    estimate_hours: Decimal | None = Field(None, gt=0)
    category: TaskCategory | None = None
    is_active: bool | None = None


class WeeklyRecurringTaskResponse(WeeklyRecurringTaskBase):
    """Weekly recurring task response model"""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("estimate_hours")
    def serialize_estimate_hours(self, value: Decimal) -> float:
        """Convert Decimal to float for JSON serialization"""
        return float(value)


class LogCreate(LogBase):
    """Log creation request"""

    task_id: UUID


class LogUpdate(BaseModel):
    """Log update request"""

    actual_minutes: int | None = Field(None, gt=0)
    comment: str | None = Field(None, max_length=500)


class LogResponse(LogBase):
    """Log response model"""

    id: UUID
    task_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSettingsCreate(BaseModel):
    """User settings creation request"""

    openai_api_key: str = Field(min_length=1)
    openai_model: str = Field(default="gpt-5", max_length=50)


class UserSettingsUpdate(BaseModel):
    """User settings update request"""

    openai_api_key: str | None = Field(None, min_length=1)
    openai_model: str | None = Field(None, max_length=50)


class UserSettingsResponse(BaseModel):
    """User settings response model"""

    id: UUID
    user_id: UUID
    openai_model: str
    ai_features_enabled: bool
    created_at: datetime
    updated_at: datetime
    has_api_key: bool = Field(description="Whether API key is configured")

    model_config = ConfigDict(from_attributes=True)


class ApiUsageLogResponse(ApiUsageLogBase):
    """API usage log response model"""

    id: UUID
    user_id: UUID
    request_timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskDependencyCreate(BaseModel):
    """Task dependency creation request"""

    depends_on_task_id: UUID


class TaskDependencyTaskInfo(BaseModel):
    """Task information for dependencies to avoid circular references"""

    id: UUID
    title: str
    status: TaskStatus

    model_config = ConfigDict(from_attributes=True)


class TaskDependencyResponse(BaseModel):
    """Task dependency response model"""

    id: UUID
    task_id: UUID
    depends_on_task_id: UUID
    created_at: datetime
    depends_on_task: TaskDependencyTaskInfo | None = None

    model_config = ConfigDict(from_attributes=True)


class GoalDependencyCreate(BaseModel):
    """Goal dependency creation request"""

    goal_id: UUID
    depends_on_goal_id: UUID


class GoalDependencyGoalInfo(BaseModel):
    """Goal information for dependencies to avoid circular references"""

    id: UUID
    title: str
    project_id: UUID

    model_config = ConfigDict(from_attributes=True)


class GoalDependencyResponse(BaseModel):
    """Goal dependency response model"""

    id: UUID
    goal_id: UUID
    depends_on_goal_id: UUID
    created_at: datetime
    depends_on_goal: GoalDependencyGoalInfo | None = None

    model_config = ConfigDict(from_attributes=True)


# Error Response Models
class ErrorDetail(BaseModel):
    """Error detail model following API standardization"""

    code: str = Field(..., description="Error code for programmatic handling")
    message: str = Field(..., description="Human-readable error message")
    details: dict[str, Any] | None = Field(
        default=None, description="Additional error context"
    )


class ErrorResponse(BaseModel):
    """Standardized error response model"""

    error: ErrorDetail

    @classmethod
    def create(
        cls, code: str, message: str, details: dict[str, Any] | None = None
    ) -> "ErrorResponse":
        """Create a standardized error response"""
        return cls(error=ErrorDetail(code=code, message=message, details=details))


class ValidationErrorResponse(BaseModel):
    """Validation error response model"""

    error: ErrorDetail

    @classmethod
    def create(
        cls, message: str, validation_errors: list[dict[str, Any]]
    ) -> "ValidationErrorResponse":
        """Create a validation error response"""
        return cls(
            error=ErrorDetail(
                code="VALIDATION_ERROR",
                message=message,
                details={"validation_errors": validation_errors},
            )
        )
