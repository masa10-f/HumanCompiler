from datetime import datetime, UTC
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

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


class ProjectStatus(str, Enum):
    """Project status enum"""

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


class SortBy(str, Enum):
    """Sort field options for list endpoints"""

    STATUS = "status"
    TITLE = "title"
    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    PRIORITY = "priority"


class SortOrder(str, Enum):
    """Sort order options"""

    ASC = "asc"
    DESC = "desc"


class CheckoutType(str, Enum):
    """Checkout type for work sessions"""

    MANUAL = "manual"
    SCHEDULED = "scheduled"
    OVERDUE = "overdue"
    INTERRUPTED = "interrupted"


class SessionDecision(str, Enum):
    """Decision made at session checkout"""

    CONTINUE = "continue"
    SWITCH = "switch"
    BREAK = "break"
    COMPLETE = "complete"


class ContinueReason(str, Enum):
    """Reason for continuing a session"""

    GOOD_STOPPING_POINT = "good_stopping_point"
    WAITING_FOR_BLOCKER = "waiting_for_blocker"
    NEED_RESEARCH = "need_research"
    IN_FLOW_STATE = "in_flow_state"
    UNEXPECTED_COMPLEXITY = "unexpected_complexity"
    TIME_CONSTRAINT = "time_constraint"
    OTHER = "other"


class NotificationLevel(str, Enum):
    """Notification urgency level for checkout reminders"""

    LIGHT = "light"  # 5 min before: gentle reminder
    STRONG = "strong"  # At checkout time: urgent
    OVERDUE = "overdue"  # Past due: critical


class DeviceType(str, Enum):
    """Device type for push subscriptions"""

    DESKTOP = "desktop"
    MOBILE = "mobile"
    TABLET = "tablet"


class RescheduleSuggestionStatus(str, Enum):
    """Status of a reschedule suggestion"""

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


class RescheduleTriggerType(str, Enum):
    """Trigger type for reschedule suggestion"""

    CHECKOUT = "checkout"
    OVERDUE_RECOVERY = "overdue_recovery"


# Model-specific allowed sort fields for validation
ALLOWED_SORT_FIELDS = {
    "Project": {"status", "title", "created_at", "updated_at"},
    "Goal": {"status", "title", "created_at", "updated_at"},
    "Task": {"status", "title", "created_at", "updated_at", "priority"},
    "WeeklyRecurringTask": {"title", "created_at", "updated_at"},
    "Log": {"created_at", "updated_at"},
}

# Status priority configurations for consistent sorting
STATUS_PRIORITY = {
    "default": {"pending": 1, "in_progress": 2, "completed": 3, "cancelled": 4},
    "project": {"pending": 1, "in_progress": 2, "completed": 3, "cancelled": 4},
    "goal": {"pending": 1, "in_progress": 2, "completed": 3, "cancelled": 4},
    "task": {"pending": 1, "in_progress": 2, "completed": 3, "cancelled": 4},
}


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
    work_sessions: list["WorkSession"] = Relationship(back_populates="user")
    push_subscriptions: list["PushSubscription"] = Relationship(back_populates="user")


class ProjectBase(SQLModel):
    """Base project model"""

    title: str = SQLField(min_length=1, max_length=200)
    description: str | None = SQLField(default=None, max_length=1000)
    status: ProjectStatus = SQLField(
        default=ProjectStatus.PENDING,
        sa_column=Column(
            SQLEnum(ProjectStatus, values_callable=lambda x: [e.value for e in x])
        ),
    )


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
    memo: str | None = SQLField(
        default=None,
        max_length=2000,
        description="Task memo for notes and additional information",
    )
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
    priority: int = SQLField(
        default=3,
        ge=1,
        le=5,
        description="Task priority level (1=highest, 5=lowest)",
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
    work_sessions: list["WorkSession"] = Relationship(back_populates="task")


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


class WorkSessionBase(SQLModel):
    """Base work session model"""

    planned_checkout_at: datetime
    planned_outcome: str | None = SQLField(default=None, max_length=500)


class WorkSession(WorkSessionBase, table=True):  # type: ignore[call-arg]
    """Work session database model for Runner/Focus mode"""

    __tablename__ = "work_sessions"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)
    task_id: UUID = SQLField(foreign_key="tasks.id", ondelete="CASCADE", index=True)

    # Timing
    started_at: datetime = SQLField(default_factory=lambda: datetime.now(UTC))
    ended_at: datetime | None = SQLField(default=None)

    # Pause/Resume fields
    paused_at: datetime | None = SQLField(
        default=None,
        description="Timestamp when the session was paused. NULL means active or ended.",
    )
    total_paused_seconds: int = SQLField(
        default=0,
        description="Total accumulated pause time in seconds across all pause/resume cycles.",
    )

    # Session outcome
    checkout_type: CheckoutType | None = SQLField(
        default=None,
        sa_column=Column(
            SQLEnum(CheckoutType, values_callable=lambda x: [e.value for e in x])
        ),
    )
    decision: SessionDecision | None = SQLField(
        default=None,
        sa_column=Column(
            SQLEnum(SessionDecision, values_callable=lambda x: [e.value for e in x])
        ),
    )
    continue_reason: ContinueReason | None = SQLField(
        default=None,
        sa_column=Column(
            SQLEnum(ContinueReason, values_callable=lambda x: [e.value for e in x])
        ),
    )

    # KPT reflection
    kpt_keep: str | None = SQLField(default=None, max_length=500)
    kpt_problem: str | None = SQLField(default=None, max_length=500)
    kpt_try: str | None = SQLField(default=None, max_length=500)

    # Additional metadata
    remaining_estimate_hours: Decimal | None = SQLField(
        default=None, ge=0, max_digits=5, decimal_places=2
    )

    # Snooze tracking (Issue #228)
    snooze_count: int = SQLField(default=0)
    last_snooze_at: datetime | None = SQLField(default=None)

    # Notification state tracking (Issue #228)
    notification_5min_sent: bool = SQLField(default=False)
    notification_checkout_sent: bool = SQLField(default=False)
    notification_overdue_sent: bool = SQLField(default=False)

    # Unresponsive session tracking (Issue #228)
    marked_unresponsive_at: datetime | None = SQLField(default=None)

    # Timestamps
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: "User" = Relationship(back_populates="work_sessions")
    task: "Task" = Relationship(back_populates="work_sessions")


class PushSubscriptionBase(SQLModel):
    """Base push subscription model for Web Push notifications"""

    endpoint: str = SQLField(max_length=2000)
    p256dh_key: str = SQLField(max_length=500)
    auth_key: str = SQLField(max_length=500)
    user_agent: str | None = SQLField(default=None, max_length=500)
    device_type: DeviceType | None = SQLField(
        default=None,
        sa_column=Column(
            SQLEnum(DeviceType, values_callable=lambda x: [e.value for e in x])
        ),
    )


class PushSubscription(PushSubscriptionBase, table=True):  # type: ignore[call-arg]
    """Push subscription database model for storing Web Push API subscriptions"""

    __tablename__ = "push_subscriptions"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)

    # Status tracking
    is_active: bool = SQLField(default=True)
    last_successful_push: datetime | None = SQLField(default=None)
    failure_count: int = SQLField(default=0)

    # Timestamps
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    user: "User" = Relationship(back_populates="push_subscriptions")


class UserSettingsBase(SQLModel):
    """Base user settings model"""

    openai_api_key_encrypted: str | None = SQLField(default=None, max_length=500)
    openai_model: str = SQLField(default="gpt-5", max_length=50)
    ai_features_enabled: bool = SQLField(default=False)


class UserSettings(UserSettingsBase, table=True):  # type: ignore[call-arg]
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


# Reschedule Models (Issue #227)
class RescheduleSuggestionBase(SQLModel):
    """Base reschedule suggestion model"""

    trigger_type: RescheduleTriggerType = SQLField(
        sa_column=Column(
            SQLEnum(
                RescheduleTriggerType, values_callable=lambda x: [e.value for e in x]
            )
        )
    )
    trigger_decision: str | None = SQLField(default=None, max_length=50)
    original_schedule_json: dict[str, Any] = SQLField(
        sa_column=Column(JSON), default_factory=dict
    )
    proposed_schedule_json: dict[str, Any] = SQLField(
        sa_column=Column(JSON), default_factory=dict
    )
    diff_json: dict[str, Any] = SQLField(sa_column=Column(JSON), default_factory=dict)
    status: RescheduleSuggestionStatus = SQLField(
        default=RescheduleSuggestionStatus.PENDING,
        sa_column=Column(
            SQLEnum(
                RescheduleSuggestionStatus,
                values_callable=lambda x: [e.value for e in x],
            )
        ),
    )


class RescheduleSuggestion(RescheduleSuggestionBase, table=True):  # type: ignore[call-arg]
    """Reschedule suggestion database model for checkout-based rescheduling"""

    __tablename__ = "reschedule_suggestions"

    id: UUID | None = SQLField(default=None, primary_key=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)
    work_session_id: UUID = SQLField(foreign_key="work_sessions.id", index=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    decided_at: datetime | None = SQLField(default=None)
    expires_at: datetime | None = SQLField(default=None)


class RescheduleDecisionBase(SQLModel):
    """Base reschedule decision model"""

    accepted: bool
    reason: str | None = SQLField(default=None, max_length=1000)
    context_json: dict[str, Any] = SQLField(
        sa_column=Column(JSON), default_factory=dict
    )


class RescheduleDecision(RescheduleDecisionBase, table=True):  # type: ignore[call-arg]
    """Reschedule decision database model for learning logs"""

    __tablename__ = "reschedule_decisions"

    id: UUID | None = SQLField(default=None, primary_key=True)
    suggestion_id: UUID = SQLField(foreign_key="reschedule_suggestions.id", index=True)
    user_id: UUID = SQLField(foreign_key="users.id", index=True)
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))


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
    status: ProjectStatus | None = None


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
    memo: str | None = Field(None, max_length=2000)
    estimate_hours: Decimal | None = Field(None, gt=0)
    due_date: datetime | None = None
    status: TaskStatus | None = None
    work_type: WorkType | None = None
    priority: int | None = Field(None, ge=1, le=5)


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


class TaskSummary(BaseModel):
    """Minimal task info for embedding in other responses (e.g., work session history)"""

    id: UUID
    title: str
    status: TaskStatus

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

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            # Assume naive datetime is UTC and add timezone info
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    model_config = ConfigDict(from_attributes=True)


# Work Session API Models
class WorkSessionStartRequest(BaseModel):
    """Request model for starting a work session"""

    task_id: UUID
    planned_checkout_at: datetime
    planned_outcome: str | None = Field(None, max_length=500)


class WorkSessionCheckoutRequest(BaseModel):
    """Request model for checking out a work session"""

    checkout_type: CheckoutType = CheckoutType.MANUAL
    decision: SessionDecision
    continue_reason: ContinueReason | None = None
    kpt_keep: str | None = Field(None, max_length=500)
    kpt_problem: str | None = Field(None, max_length=500)
    kpt_try: str | None = Field(None, max_length=500)
    remaining_estimate_hours: Decimal | None = Field(None, ge=0)
    next_task_id: UUID | None = None


class WorkSessionUpdate(BaseModel):
    """Request model for updating a work session's KPT fields.

    Only allows updating KPT (Keep/Problem/Try) reflection fields.
    Other session data cannot be modified after checkout.
    """

    kpt_keep: str | None = Field(None, max_length=500)
    kpt_problem: str | None = Field(None, max_length=500)
    kpt_try: str | None = Field(None, max_length=500)


class WorkSessionPauseRequest(BaseModel):
    """Request model for pausing a work session (currently empty, but can be extended)"""

    pass


class WorkSessionResumeRequest(BaseModel):
    """Request model for resuming a paused work session"""

    extend_checkout: bool = Field(
        default=True,
        description="Whether to extend planned_checkout_at by the paused duration",
    )


class WorkSessionResponse(WorkSessionBase):
    """Work session response model"""

    id: UUID
    user_id: UUID
    task_id: UUID
    started_at: datetime
    ended_at: datetime | None
    paused_at: datetime | None = None
    total_paused_seconds: int = 0
    checkout_type: CheckoutType | None
    decision: SessionDecision | None
    continue_reason: ContinueReason | None
    kpt_keep: str | None
    kpt_problem: str | None
    kpt_try: str | None
    remaining_estimate_hours: Decimal | None
    actual_minutes: int | None = None
    # Snooze tracking (Issue #228)
    snooze_count: int = 0
    last_snooze_at: datetime | None = None
    # Unresponsive tracking (Issue #228)
    marked_unresponsive_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # Optional task info for history display (Issue #236)
    task: TaskSummary | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("remaining_estimate_hours")
    def serialize_remaining_estimate_hours(self, value: Decimal | None) -> float | None:
        """Convert Decimal to float for JSON serialization"""
        return float(value) if value is not None else None

    @field_serializer(
        "started_at",
        "ended_at",
        "created_at",
        "updated_at",
        "planned_checkout_at",
        "paused_at",
        "last_snooze_at",
        "marked_unresponsive_at",
    )
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        """Ensure datetime is serialized with UTC timezone info"""
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


class WorkSessionWithLogResponse(WorkSessionResponse):
    """Work session response with generated log"""

    generated_log: LogResponse | None = None


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

    @field_serializer("created_at", "updated_at")
    def serialize_datetimes(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            # Assume naive datetime is UTC and add timezone info
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    model_config = ConfigDict(from_attributes=True)

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

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            # Assume naive datetime is UTC and add timezone info
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

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

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            # Assume naive datetime is UTC and add timezone info
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

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


# Weekly Report Models
class WeeklyReportRequest(BaseModel):
    """Request model for weekly work report generation"""

    week_start_date: str = Field(
        ..., description="Start date of the week (YYYY-MM-DD format, should be Monday)"
    )
    project_ids: list[str] | None = Field(
        default=None, description="Optional list of project IDs to filter the report"
    )

    model_config = ConfigDict(
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "week_start_date": "2023-12-18",
                "project_ids": ["uuid1", "uuid2"],
            }
        },
    )


class TaskProgressSummary(BaseModel):
    """Task progress summary for weekly report"""

    task_id: str
    task_title: str
    project_title: str
    goal_title: str
    estimated_hours: float
    actual_minutes: int
    completion_percentage: float
    status: TaskStatus
    work_logs: list[str]  # Comments from work logs

    model_config = ConfigDict(from_attributes=True)


class ProjectProgressSummary(BaseModel):
    """Project progress summary for weekly report"""

    project_id: str
    project_title: str
    total_estimated_hours: float
    total_actual_minutes: int
    total_tasks: int
    completed_tasks: int
    completion_percentage: float
    tasks: list[TaskProgressSummary]

    model_config = ConfigDict(from_attributes=True)


class WeeklyWorkSummary(BaseModel):
    """Weekly work time summary"""

    total_actual_minutes: int
    total_estimated_hours: float
    total_tasks_worked: int
    total_completed_tasks: int
    overall_completion_percentage: float
    daily_breakdown: dict[str, int]  # Date -> minutes worked
    project_breakdown: dict[str, int]  # Project title -> minutes worked

    model_config = ConfigDict(from_attributes=True)


class WeeklyReportResponse(BaseModel):
    """Response model for weekly work report"""

    week_start_date: str
    week_end_date: str
    work_summary: WeeklyWorkSummary
    project_summaries: list[ProjectProgressSummary]
    markdown_report: str
    generated_at: datetime

    @field_serializer("generated_at")
    def serialize_generated_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            # Assume naive datetime is UTC and add timezone info
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    model_config = ConfigDict(from_attributes=True)


# Push Subscription API Models (Issue #228)
class PushSubscriptionCreate(BaseModel):
    """Request model for registering a push subscription"""

    endpoint: str = Field(..., max_length=2000)
    keys: dict[str, str] = Field(
        ..., description="Keys object with p256dh and auth properties"
    )
    user_agent: str | None = Field(None, max_length=500)
    device_type: DeviceType | None = None

    @field_validator("keys")
    @classmethod
    def validate_keys(cls, v: dict[str, str]) -> dict[str, str]:
        """Validate that keys contain required p256dh and auth"""
        if "p256dh" not in v or "auth" not in v:
            raise ValueError("Keys must contain p256dh and auth properties")
        return v


class PushSubscriptionResponse(PushSubscriptionBase):
    """Response model for push subscription"""

    id: UUID
    user_id: UUID
    is_active: bool
    last_successful_push: datetime | None
    failure_count: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("last_successful_push", "created_at", "updated_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        """Ensure datetime is serialized with UTC timezone info"""
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


# Snooze API Models (Issue #228)
class SnoozeRequest(BaseModel):
    """Request model for snoozing a session checkout"""

    snooze_minutes: int = Field(default=5, ge=1, le=15)


class SnoozeResponse(BaseModel):
    """Response model for snooze action"""

    session: WorkSessionResponse
    new_planned_checkout_at: datetime
    snooze_count: int
    max_snooze_count: int = 2

    @field_serializer("new_planned_checkout_at")
    def serialize_datetime(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


# WebSocket Notification Models (Issue #228)
class NotificationMessage(BaseModel):
    """WebSocket notification message model"""

    id: str = Field(..., description="Unique notification ID")
    type: str = Field(default="notification", description="Message type")
    level: NotificationLevel
    title: str
    body: str
    session_id: str
    action_url: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_serializer("timestamp")
    def serialize_timestamp(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


# Reschedule API Models (Issue #227)
class ScheduleDiffItem(BaseModel):
    """Individual diff item in a schedule change"""

    task_id: str
    task_title: str
    change_type: str  # "pushed", "added", "removed", "reordered"
    original_slot_index: int | None = None
    new_slot_index: int | None = None
    reason: str


class ScheduleDiff(BaseModel):
    """Schedule diff between original and proposed schedules"""

    pushed_tasks: list[ScheduleDiffItem] = Field(default_factory=list)
    added_tasks: list[ScheduleDiffItem] = Field(default_factory=list)
    removed_tasks: list[ScheduleDiffItem] = Field(default_factory=list)
    reordered_tasks: list[ScheduleDiffItem] = Field(default_factory=list)
    total_changes: int = 0
    has_significant_changes: bool = False


class RescheduleSuggestionResponse(BaseModel):
    """Response model for reschedule suggestion"""

    id: UUID
    user_id: UUID
    work_session_id: UUID
    trigger_type: RescheduleTriggerType
    trigger_decision: str | None
    original_schedule_json: dict[str, Any]
    proposed_schedule_json: dict[str, Any]
    diff_json: dict[str, Any]
    diff: ScheduleDiff | None = None
    status: RescheduleSuggestionStatus
    created_at: datetime
    decided_at: datetime | None
    expires_at: datetime | None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "decided_at", "expires_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        """Ensure datetime is serialized with UTC timezone info"""
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


class RescheduleDecisionRequest(BaseModel):
    """Request model for accepting/rejecting a reschedule suggestion"""

    reason: str | None = Field(None, max_length=1000)


class RescheduleDecisionResponse(BaseModel):
    """Response model for reschedule decision"""

    id: UUID
    suggestion_id: UUID
    user_id: UUID
    accepted: bool
    reason: str | None
    context_json: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


class WorkSessionWithRescheduleResponse(BaseModel):
    """Work session response with optional reschedule suggestion"""

    session: "WorkSessionWithLogResponse"
    reschedule_suggestion: RescheduleSuggestionResponse | None = None


# Context Notes Models (Issue #258)
class ContentType(str, Enum):
    """Content type for context notes"""

    MARKDOWN = "markdown"
    HTML = "html"
    TIPTAP_JSON = "tiptap_json"


class ContextNoteBase(SQLModel):
    """Base context note model"""

    content: str = SQLField(default="")
    content_type: str = SQLField(default="markdown", max_length=20)


class ContextNote(ContextNoteBase, table=True):  # type: ignore[call-arg]
    """Context note database model for rich text notes on projects, goals, and tasks"""

    __tablename__ = "context_notes"

    id: UUID | None = SQLField(default_factory=uuid4, primary_key=True)

    # Owner (for RLS - no complex JOINs needed)
    user_id: UUID = SQLField(foreign_key="users.id", ondelete="CASCADE")

    # Target entity (exactly one must be set)
    project_id: UUID | None = SQLField(
        default=None, foreign_key="projects.id", ondelete="CASCADE"
    )
    goal_id: UUID | None = SQLField(
        default=None, foreign_key="goals.id", ondelete="CASCADE"
    )
    task_id: UUID | None = SQLField(
        default=None, foreign_key="tasks.id", ondelete="CASCADE"
    )

    # Timestamps
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Note: attachments relationship removed - note_attachments table not yet implemented


class NoteAttachmentBase(SQLModel):
    """Base note attachment model"""

    filename: str = SQLField(max_length=255)
    content_type: str = SQLField(max_length=100)
    file_size: int
    storage_path: str = SQLField(max_length=500)


class NoteAttachment(NoteAttachmentBase, table=True):  # type: ignore[call-arg]
    """Note attachment database model for images and files"""

    __tablename__ = "note_attachments"

    id: UUID | None = SQLField(default=None, primary_key=True)
    note_id: UUID = SQLField(foreign_key="context_notes.id", ondelete="CASCADE")

    # Timestamps
    created_at: datetime | None = SQLField(default_factory=lambda: datetime.now(UTC))

    # Relationships
    note: ContextNote = Relationship(back_populates="attachments")


# Context Notes API Models
class ContextNoteCreate(BaseModel):
    """Context note creation request"""

    content: str = Field(default="")
    content_type: str = Field(default="markdown", max_length=20)


class ContextNoteUpdate(BaseModel):
    """Context note update request"""

    content: str | None = None
    content_type: str | None = Field(None, max_length=20)


class NoteAttachmentResponse(BaseModel):
    """Note attachment response model"""

    id: UUID
    note_id: UUID
    filename: str
    content_type: str
    file_size: int
    storage_path: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    model_config = ConfigDict(from_attributes=True)


class ContextNoteResponse(BaseModel):
    """Context note response model"""

    id: UUID
    project_id: UUID | None
    goal_id: UUID | None
    task_id: UUID | None
    content: str
    content_type: str
    created_at: datetime
    updated_at: datetime
    # Note: attachments field removed - not yet implemented

    @field_serializer("created_at", "updated_at")
    def serialize_datetimes(self, value: datetime) -> str:
        """Ensure datetime is serialized with UTC timezone info"""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()

    model_config = ConfigDict(from_attributes=True)
