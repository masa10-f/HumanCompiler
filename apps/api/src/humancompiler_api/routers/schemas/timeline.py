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
    # Estimated start of the earliest logged work (log time minus its minutes)
    first_logged_at: str | None = None
    # Time the latest work log was recorded
    last_logged_at: str | None = None


class GoalTimelineData(BaseModel):
    """Goal data with tasks for timeline display."""

    id: str
    title: str
    description: str | None
    status: str
    estimate_hours: float
    start_date: str | None
    end_date: str | None
    due_date: str | None
    dependencies: list[str]
    created_at: str
    updated_at: str
    tasks: list[TaskTimelineData]
    # Span of logged work across the goal's tasks (see TaskTimelineData)
    actual_start_date: str | None = None
    actual_end_date: str | None = None


class ProjectCapacity(BaseModel):
    """Weekly capacity a project gets from the capacity triage settings."""

    # Weekly working hours and buffer (meetings etc.) from the triage settings
    weekly_capacity_hours: float
    meeting_buffer_hours: float
    # weekly_capacity_hours - meeting_buffer_hours
    effective_capacity_hours: float
    # The project's effort ratio (0-100)
    effort_percent: int
    # effective_capacity_hours * effort_percent / 100
    weekly_work_hours: float
    # True when a triage settings row exists. Opening the Settings page creates
    # one with defaults, so this does not mean the user saved their settings.
    configured: bool


class ProjectInfo(BaseModel):
    """Project information for timeline."""

    id: str
    title: str
    description: str | None
    status: str
    # Weekly hours planned for this project (see ProjectCapacity)
    weekly_work_hours: float
    capacity: ProjectCapacity
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
