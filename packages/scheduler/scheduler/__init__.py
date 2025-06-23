"""
Task Scheduler Package

OR-Tools CP-SAT solver for task scheduling optimization.
"""

from .api import optimize_schedule_api
from .core import optimize_schedule
from .models import Task, TimeSlot, ScheduleResult, TaskAssignment

__version__ = "0.1.0"
__all__ = [
    "optimize_schedule",
    "optimize_schedule_api", 
    "Task",
    "TimeSlot", 
    "ScheduleResult",
    "TaskAssignment",
]