"""
AI service data models and types
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, ConfigDict, field_serializer

from taskagent_api.models import Goal, Project, Task, WeeklyRecurringTask


@dataclass
class WeeklyPlanContext:
    """Context data for weekly planning."""

    user_id: str
    week_start_date: date
    projects: list[Project]
    goals: list[Goal]
    tasks: list[Task]
    weekly_recurring_tasks: list[WeeklyRecurringTask]
    selected_recurring_task_ids: list[str]
    capacity_hours: float
    preferences: dict[str, Any]


class WeeklyPlanRequest(BaseModel):
    """Request model for weekly plan generation."""

    week_start_date: str = Field(..., description="Week start date (YYYY-MM-DD)")
    capacity_hours: float = Field(40.0, description="Available hours for the week")
    project_filter: list[str] | None = Field(None, description="Filter by project IDs")
    selected_recurring_task_ids: list[str] = Field(
        default_factory=list, description="Selected weekly recurring task IDs"
    )
    project_allocations: dict[str, float] | None = Field(
        None, description="Project allocation percentages (project_id -> percentage)"
    )
    preferences: dict[str, Any] = Field(
        default_factory=dict, description="User preferences"
    )


class TaskPlan(BaseModel):
    """Individual task plan within a week."""

    task_id: str
    task_title: str
    estimated_hours: float
    priority: int
    rationale: str


class WeeklyPlanResponse(BaseModel):
    """Response model for weekly plan generation."""

    success: bool
    week_start_date: str
    total_planned_hours: float
    task_plans: list[TaskPlan]
    recommendations: list[str]
    insights: list[str]
    generated_at: datetime

    model_config = ConfigDict()

    @field_serializer("generated_at")
    def serialize_generated_at(self, value: datetime) -> str:
        return value.isoformat()
