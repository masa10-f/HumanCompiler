"""
Refactored AI planning service using modular components
"""

from datetime import datetime

from taskagent_api.ai.context_collector import ContextCollector
from taskagent_api.ai.models import WeeklyPlanRequest, WeeklyPlanResponse
from taskagent_api.ai.openai_client import OpenAIClient


class WeeklyPlanService:
    """Service for weekly plan generation and management"""

    def __init__(self, openai_service=None):
        """Initialize service with modular components

        Args:
            openai_service: Optional OpenAIService instance for user-specific API key
        """
        self.context_collector = ContextCollector()
        # Use provided OpenAI service or create default one
        self.openai_client = openai_service if openai_service else OpenAIClient()

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
            selected_recurring_task_ids=request.selected_recurring_task_ids,
        )

        # Add project allocations to context if provided
        if request.project_allocations:
            # Convert dict to ProjectAllocation objects for consistency
            from taskagent_api.ai.weekly_task_solver import ProjectAllocation
            import logging

            logger = logging.getLogger(__name__)

            project_allocations = []
            logger.info(
                f"Converting project allocations: {request.project_allocations}"
            )
            logger.info(
                f"Available capacity: {request.capacity_hours}h, meeting buffer: 5.0h"
            )

            for project_id, percentage in request.project_allocations.items():
                # Find project info from context
                project = next(
                    (p for p in context.projects if str(p.id) == project_id), None
                )
                if project:
                    # Calculate target hours from percentage
                    available_hours = request.capacity_hours - 5.0  # meeting buffer
                    target_hours = (percentage / 100.0) * available_hours
                    max_hours = target_hours * 1.5

                    logger.info(
                        f"Project '{project.title}' ({project_id}): "
                        f"{percentage}% = {target_hours:.1f}h target, "
                        f"{max_hours:.1f}h max"
                    )

                    project_allocations.append(
                        ProjectAllocation(
                            project_id=project_id,
                            project_title=project.title,
                            target_hours=target_hours,
                            max_hours=max_hours,
                            priority_weight=percentage / 100.0,
                        )
                    )

            # Store allocations in context preferences for OpenAI client
            context.preferences["project_allocations"] = project_allocations

        # Generate plan using OpenAI
        return await self.openai_client.generate_weekly_plan(context)


# Create service instance for use in routers
weekly_plan_service = WeeklyPlanService()
