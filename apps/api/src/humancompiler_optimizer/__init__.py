"""Optimization backends decoupled from the API layer.

This package is intentionally dependency-light. It defines solver inputs/outputs and
implements OR-Tools-based optimizers behind stable, pure-Python interfaces.
"""

from .daily import (
    Assignment,
    DailySolverConfig,
    FixedAssignment,
    ScheduleResult,
    SchedulerTask,
    SlotKind,
    TaskKind,
    TimeSlot,
    WorkKind,
    optimize_daily_schedule,
)
from .weekly import (
    ProjectAllocationSpec,
    WeeklySelectionResult,
    WeeklySolverConfig,
    WeeklyTaskSpec,
    optimize_weekly_selection,
)

__all__ = [
    "Assignment",
    "DailySolverConfig",
    "FixedAssignment",
    "optimize_daily_schedule",
    "ScheduleResult",
    "SchedulerTask",
    "SlotKind",
    "TaskKind",
    "TimeSlot",
    "WorkKind",
    "ProjectAllocationSpec",
    "optimize_weekly_selection",
    "WeeklySelectionResult",
    "WeeklySolverConfig",
    "WeeklyTaskSpec",
]
