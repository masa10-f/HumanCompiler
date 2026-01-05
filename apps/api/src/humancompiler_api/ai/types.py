"""Type definitions for AI module.

This module provides TypedDict definitions for complex dictionary structures
used throughout the AI module, replacing loose dict[str, Any] annotations.
"""

from typing import TypedDict
from uuid import UUID


class ConstraintAnalysis(TypedDict):
    """Analysis of weekly constraints and workload."""

    total_task_hours: float
    available_hours: float
    capacity_utilization: float
    urgent_task_count: int
    project_count: int
    overload_risk: bool


class SolverMetrics(TypedDict):
    """Performance metrics from the task solver."""

    capacity_utilization: float
    project_balance_score: float
    task_count: int
    avg_task_hours: float
    projects_involved: int
    project_distribution: dict[str | UUID, float]


class WeeklyPlanPreferences(TypedDict, total=False):
    """User preferences for weekly planning.

    All fields are optional (total=False).
    """

    focus_areas: list[str]
    excluded_projects: list[str]
    max_daily_hours: float
    prefer_morning: bool
    prefer_deep_work_blocks: bool
