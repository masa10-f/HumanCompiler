"""
AI services module
"""

from typing import Any

from humancompiler_api.ai.models import WeeklyPlanRequest, WeeklyPlanResponse
from humancompiler_api.ai.planning_service import weekly_plan_service
from humancompiler_api.ai.weekly_task_solver import (
    WeeklyTaskSolver,
    TaskSolverRequest,
    TaskSolverResponse,
    WeeklyConstraints,
    ProjectAllocation,
)

# Import from ai_service.py for the new implementation
WeeklyPlanService: Any
try:
    from humancompiler_api.ai_service import WeeklyPlanService
except ImportError:
    # Fallback if ai_service.py doesn't exist
    WeeklyPlanService = None

__all__ = [
    "weekly_plan_service",
    "WeeklyPlanRequest",
    "WeeklyPlanResponse",
    "WeeklyPlanService",
    "WeeklyTaskSolver",
    "TaskSolverRequest",
    "TaskSolverResponse",
    "WeeklyConstraints",
    "ProjectAllocation",
]
