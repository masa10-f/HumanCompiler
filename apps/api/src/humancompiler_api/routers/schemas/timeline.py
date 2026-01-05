"""Pydantic schemas for timeline endpoints."""

from pydantic import BaseModel


class TaskTimelineData(BaseModel):
    """Task data for timeline display."""

    id: str
    title: str
    description: str | None
    status: str
    estimate_hours: float
    due_date: str | None
    created_at: str
    updated_at: str
    progress_percentage: float
    status_color: str
    actual_hours: float
    logs_count: int


class GoalTimelineData(BaseModel):
    """Goal data with tasks for timeline display."""

    id: str
    title: str
    description: str | None
    status: str
    estimate_hours: float
    start_date: str | None
    end_date: str | None
    dependencies: list[str]
    created_at: str
    updated_at: str
    tasks: list[TaskTimelineData]


class ProjectInfo(BaseModel):
    """Project information for timeline."""

    id: str
    title: str
    description: str | None
    status: str
    weekly_work_hours: float
    created_at: str
    updated_at: str


class TimelineInfo(BaseModel):
    """Timeline range information."""

    start_date: str
    end_date: str
    time_unit: str


class ProjectTimelineResponse(BaseModel):
    """Response for project timeline endpoint."""

    project: ProjectInfo
    timeline: TimelineInfo
    goals: list[GoalTimelineData]


class ProjectStatistics(BaseModel):
    """Project statistics for overview."""

    total_goals: int
    completed_goals: int
    in_progress_goals: int
    total_tasks: int
    completed_tasks: int
    in_progress_tasks: int
    goals_completion_rate: float
    tasks_completion_rate: float


class ProjectOverviewData(BaseModel):
    """Project overview data for timeline dashboard."""

    id: str
    title: str
    description: str | None
    status: str
    created_at: str
    updated_at: str
    statistics: ProjectStatistics


class TimelineOverviewInfo(BaseModel):
    """Timeline overview range information."""

    start_date: str
    end_date: str


class TimelineOverviewResponse(BaseModel):
    """Response for timeline overview endpoint."""

    timeline: TimelineOverviewInfo
    projects: list[ProjectOverviewData]
