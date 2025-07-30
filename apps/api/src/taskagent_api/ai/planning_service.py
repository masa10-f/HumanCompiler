"""
Refactored AI planning service using modular components
"""

from datetime import datetime

from taskagent_api.ai.context_collector import ContextCollector
from taskagent_api.ai.models import WeeklyPlanRequest, WeeklyPlanResponse
from taskagent_api.ai.openai_client import OpenAIClient


class WeeklyPlanService:
    """Service for weekly plan generation and management"""

    def __init__(self):
        """Initialize service with modular components"""
        self.context_collector = ContextCollector()
        self.openai_client = OpenAIClient()

    async def generate_weekly_plan(
        self, session, user_id: str, request: WeeklyPlanRequest
    ) -> WeeklyPlanResponse:
        """Generate weekly plan for user"""

        # Parse week start date
        week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

        # Collect context
        context = await self.context_collector.collect_weekly_plan_context(
            session=session,
            user_id=user_id,
            week_start_date=week_start,
            project_filter=request.project_filter,
            capacity_hours=request.capacity_hours,
            preferences=request.preferences,
        )

        # Generate plan using OpenAI
        return await self.openai_client.generate_weekly_plan(context)


# Create service instance for use in routers
weekly_plan_service = WeeklyPlanService()
