"""
AI services module
"""

from taskagent_api.ai.models import WeeklyPlanRequest, WeeklyPlanResponse
from taskagent_api.ai.planning_service import weekly_plan_service

# Import from ai_service.py for the new implementation
try:
    from taskagent_api.ai_service import WeeklyPlanService
except ImportError:
    # Fallback if ai_service.py doesn't exist
    WeeklyPlanService = None

__all__ = [
    "weekly_plan_service",
    "WeeklyPlanRequest",
    "WeeklyPlanResponse",
    "WeeklyPlanService",
]
