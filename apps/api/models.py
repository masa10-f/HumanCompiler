from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import JSON, Enum as SQLEnum
from sqlmodel import Column, Field as SQLField, Relationship, SQLModel


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
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    projects: list["Project"] = Relationship(back_populates="owner")
    schedules: list["Schedule"] = Relationship(back_populates="user")


class ProjectBase(SQLModel):
    """Base project model"""
    title: str = SQLField(min_length=1, max_length=200)
    description: Optional[str] = SQLField(default=None, max_length=1000)


class Project(ProjectBase, table=True):
    """Project database model"""
    __tablename__ = "projects"
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    owner_id: UUID = SQLField(foreign_key="users.id")
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    owner: Optional[User] = Relationship(back_populates="projects")
    goals: list["Goal"] = Relationship(back_populates="project")


class GoalBase(SQLModel):
    """Base goal model"""
    title: str = SQLField(min_length=1, max_length=200)
    description: Optional[str] = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)


class Goal(GoalBase, table=True):
    """Goal database model"""
    __tablename__ = "goals"
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    project_id: UUID = SQLField(foreign_key="projects.id", ondelete="CASCADE")
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    project: Optional[Project] = Relationship(back_populates="goals")
    tasks: list["Task"] = Relationship(back_populates="goal")


class TaskBase(SQLModel):
    """Base task model"""
    title: str = SQLField(min_length=1, max_length=200)
    description: Optional[str] = SQLField(default=None, max_length=1000)
    estimate_hours: Decimal = SQLField(gt=0, max_digits=5, decimal_places=2)
    due_date: Optional[datetime] = SQLField(default=None)
    status: TaskStatus = SQLField(default=TaskStatus.PENDING, sa_column=Column(SQLEnum(TaskStatus, values_callable=lambda x: [e.value for e in x])))


class Task(TaskBase, table=True):
    """Task database model"""
    __tablename__ = "tasks"
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    goal_id: UUID = SQLField(foreign_key="goals.id", ondelete="CASCADE")
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    goal: Optional[Goal] = Relationship(back_populates="tasks")
    logs: list["Log"] = Relationship(back_populates="task")


class ScheduleBase(SQLModel):
    """Base schedule model"""
    date: datetime = SQLField()
    plan_json: dict[str, Any] = SQLField(sa_column=Column(JSON), default_factory=dict)


class Schedule(ScheduleBase, table=True):
    """Schedule database model"""
    __tablename__ = "schedules"
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id")
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    user: Optional[User] = Relationship(back_populates="schedules")


class LogBase(SQLModel):
    """Base log model"""
    actual_minutes: int = SQLField(gt=0)
    comment: Optional[str] = SQLField(default=None, max_length=500)


class Log(LogBase, table=True):
    """Log database model"""
    __tablename__ = "logs"
    
    id: Optional[UUID] = SQLField(default=None, primary_key=True)
    task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE")
    created_at: Optional[datetime] = SQLField(default_factory=datetime.utcnow)
    
    # Relationships
    task: Optional[Task] = Relationship(back_populates="logs")


# API Request/Response Models (Pydantic)
class UserCreate(UserBase):
    """User creation request"""
    pass


class UserUpdate(BaseModel):
    """User update request"""
    email: Optional[str] = Field(None, min_length=1)


class UserResponse(UserBase):
    """User response model"""
    id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ProjectCreate(ProjectBase):
    """Project creation request"""
    pass


class ProjectUpdate(BaseModel):
    """Project update request"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)


class ProjectResponse(ProjectBase):
    """Project response model"""
    id: UUID
    owner_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class GoalCreate(GoalBase):
    """Goal creation request"""
    project_id: UUID


class GoalUpdate(BaseModel):
    """Goal update request"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    estimate_hours: Optional[Decimal] = Field(None, gt=0)


class GoalResponse(GoalBase):
    """Goal response model"""
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TaskCreate(TaskBase):
    """Task creation request"""
    goal_id: UUID


class TaskUpdate(BaseModel):
    """Task update request"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    estimate_hours: Optional[Decimal] = Field(None, gt=0)
    due_date: Optional[datetime] = None
    status: Optional[TaskStatus] = None


class TaskResponse(TaskBase):
    """Task response model"""
    id: UUID
    goal_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ScheduleCreate(ScheduleBase):
    """Schedule creation request"""
    pass


class ScheduleUpdate(BaseModel):
    """Schedule update request"""
    date: Optional[datetime] = None
    plan_json: Optional[dict[str, Any]] = None


class ScheduleResponse(ScheduleBase):
    """Schedule response model"""
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class LogCreate(LogBase):
    """Log creation request"""
    task_id: UUID


class LogUpdate(BaseModel):
    """Log update request"""
    actual_minutes: Optional[int] = Field(None, gt=0)
    comment: Optional[str] = Field(None, max_length=500)


class LogResponse(LogBase):
    """Log response model"""
    id: UUID
    task_id: UUID
    created_at: datetime
    
    class Config:
        from_attributes = True


# Error Response Models
class ErrorResponse(BaseModel):
    """Error response model"""
    detail: str
    error_code: Optional[str] = None


class ValidationErrorResponse(BaseModel):
    """Validation error response model"""
    detail: str
    errors: list[dict]