from datetime import datetime, timezone, UTC
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import JSON
from sqlalchemy import Enum as SQLEnum
from sqlmodel import Column, Relationship, SQLModel
from sqlmodel import Field as SQLField


class TaskStatus(str, Enum):
    """Task status enum"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# Database Models (SQLModel)
class UserBase(SQLModel):
    """Base user model"""

    email: str = SQLField(unique=True, index=True)


class User(UserBase, table=True):
    """User database model"""

    __tablename__ = "users"

    id: UUID | None = SQLField(default=None, primary_key=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    projects: list["Project"] = Relationship(back_populates="owner")
    schedules: list["Schedule"] = Relationship(back_populates="user")
    settings: "UserSettings | None" = Relationship(back_populates="user")
    api_usage_logs: list["ApiUsageLog"] = Relationship(back_populates="user")


class ProjectBase(SQLModel):
    """Base project model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)


class Project(ProjectBase, table=True):
    """Project database model"""

    __tablename__ = "projects"

    id: UUID | None = SQLField(default=None, primary_key=True)
    owner_id: UUID = SQLField(foreign_key="users.id")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    owner: User | None = Relationship(back_populates="projects")
    goals: list["Goal"] = Relationship(back_populates="project")


class GoalBase(SQLModel):
    """Base goal model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)


class Goal(GoalBase, table=True):
    """Goal database model"""

    __tablename__ = "goals"

    id: UUID | None = SQLField(default=None, primary_key=True)
    project_id: UUID = SQLField(foreign_key="projects.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    project: Project | None = Relationship(back_populates="goals")
    tasks: list["Task"] = Relationship(back_populates="goal")


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


class Task(TaskBase, table=True):
    """Task database model"""

    __tablename__ = "tasks"

    id: UUID | None = SQLField(default=None, primary_key=True)
    goal_id: UUID = SQLField(foreign_key="goals.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    goal: Goal | None = Relationship(back_populates="tasks")
    logs: list["Log"] = Relationship(back_populates="task")


class ScheduleBase(SQLModel):
    """Base schedule model"""

    date: datetime = SQLField()
    plan_json: dict[str, Any] = SQLField(sa_column=Column(JSON), default_factory=dict)


class Schedule(ScheduleBase, table=True):
    """Schedule database model"""

    __tablename__ = "schedules"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User | None = Relationship(back_populates="schedules")


class LogBase(SQLModel):
    """Base log model"""

    actual_minutes: int = SQLField(gt=0)
    comment: str | None = SQLField(default=None, max_length=500)


class Log(LogBase, table=True):
    """Log database model"""

    __tablename__ = "logs"

    id: UUID | None = SQLField(default=None, primary_key=True)
    task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE")
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    task: Task | None = Relationship(back_populates="logs")


class UserSettingsBase(SQLModel):
    """Base user settings model"""

    openai_api_key_encrypted: str | None = SQLField(default=None, max_length=500)
    openai_model: str = SQLField(default="gpt-4", max_length=50)
    ai_features_enabled: bool = SQLField(default=False)


class UserSettings(UserSettingsBase, table=True):
    """User settings database model"""

    __tablename__ = "user_settings"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", unique=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: User | None = Relationship(back_populates="settings")


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
    user: User | None = Relationship(back_populates="api_usage_logs")


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


class GoalResponse(GoalBase):
    """Goal response model"""

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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


class TaskResponse(TaskBase):
    """Task response model"""

    id: UUID
    goal_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    openai_model: str = Field(default="gpt-4", max_length=50)


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


# Error Response Models
class ErrorResponse(BaseModel):
    """Error response model"""

    detail: str
    error_code: str | None = None


class ValidationErrorResponse(BaseModel):
    """Validation error response model"""

    detail: str
    errors: list[dict]
