"""
OpenAI Assistants API integration for task planning and scheduling.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, Field, ConfigDict, field_serializer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import Session, select
from uuid import UUID

from taskagent_api.config import settings
from taskagent_api.crypto import get_crypto_service
from taskagent_api.models import Goal, Project, Task, UserSettings, ApiUsageLog
from taskagent_api.services import goal_service, project_service, task_service
from core.cache import cached, invalidate_cache

logger = logging.getLogger(__name__)


@dataclass
class WeeklyPlanContext:
    """Context data for weekly planning."""

    user_id: str
    week_start_date: date
    projects: list[Project]
    goals: list[Goal]
    tasks: list[Task]
    capacity_hours: float
    preferences: dict[str, Any]


class WeeklyPlanRequest(BaseModel):
    """Request model for weekly plan generation."""

    week_start_date: str = Field(..., description="Week start date (YYYY-MM-DD)")
    capacity_hours: float = Field(40.0, description="Available hours for the week")
    project_filter: list[str] | None = Field(None, description="Filter by project IDs")
    preferences: dict[str, Any] = Field(
        default_factory=dict, description="User preferences"
    )


class TaskPlan(BaseModel):
    """Individual task plan within a week."""

    task_id: str
    task_title: str
    estimated_hours: float
    priority: int
    suggested_day: str
    suggested_time_slot: str
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


class OpenAIService:
    """Service for OpenAI Assistants API integration."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        """Initialize OpenAI client with optional user-specific API key."""
        if api_key:
            self.client = OpenAI(api_key=api_key)
            self.model = model or "gpt-4-1106-preview"
        elif (
            not settings.openai_api_key
            or settings.openai_api_key == "your_openai_api_key"
        ):
            logger.warning(
                "OpenAI API key not configured - AI features will not be available"
            )
            self.client = None
            self.model = "gpt-4-1106-preview"  # GPT-4 Turbo with function calling
        else:
            self.client = OpenAI(api_key=settings.openai_api_key)
            self.model = "gpt-4-1106-preview"  # GPT-4 Turbo with function calling

    @classmethod
    async def create_for_user(
        cls, user_id: UUID, session: AsyncSession
    ) -> "OpenAIService":
        """Create OpenAI service for a specific user with their API key.

        Args:
            user_id (UUID): The ID of the user.
            session (AsyncSession): An asynchronous SQLAlchemy session.

        Returns:
            OpenAIService: An instance of the OpenAIService configured for the user.

        Note:
            Ensure that an AsyncSession is passed to this method. Using a regular
            Session will result in runtime errors.
        """
        # Get user settings
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

        if user_settings and user_settings.openai_api_key_encrypted:
            # Decrypt API key
            api_key = get_crypto_service().decrypt(
                user_settings.openai_api_key_encrypted
            )
            if api_key:
                return cls(api_key=api_key, model=user_settings.openai_model)

        # Fall back to system API key or no client
        return cls()

    @classmethod
    def create_for_user_sync(cls, user_id: UUID, session: Session) -> "OpenAIService":
        """Create OpenAI service for a specific user with their API key (synchronous version).

        Args:
            user_id (UUID): The ID of the user.
            session (Session): A synchronous SQLAlchemy session.

        Returns:
            OpenAIService: An instance of the OpenAIService configured for the user.
        """
        # Get user settings
        user_settings = session.exec(
            select(UserSettings).where(UserSettings.user_id == user_id)
        ).one_or_none()

        if user_settings and user_settings.openai_api_key_encrypted:
            # Decrypt API key
            api_key = get_crypto_service().decrypt(
                user_settings.openai_api_key_encrypted
            )
            if api_key:
                return cls(api_key=api_key, model=user_settings.openai_model)

        # Fall back to system API key or no client
        return cls()

    def get_function_definitions(self) -> list[dict[str, Any]]:
        """Get OpenAI function definitions for task planning."""
        return [
            {
                "name": "create_week_plan",
                "description": "Create an optimal weekly plan for tasks based on user context and preferences",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_plans": {
                            "type": "array",
                            "description": "List of planned tasks for the week",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "task_id": {
                                        "type": "string",
                                        "description": "Unique task identifier",
                                    },
                                    "estimated_hours": {
                                        "type": "number",
                                        "description": "Estimated hours for the task",
                                    },
                                    "priority": {
                                        "type": "integer",
                                        "description": "Task priority (1=highest, 5=lowest)",
                                    },
                                    "suggested_day": {
                                        "type": "string",
                                        "description": "Suggested day of week (Monday, Tuesday, etc.)",
                                    },
                                    "suggested_time_slot": {
                                        "type": "string",
                                        "description": "Suggested time slot (morning, afternoon, evening)",
                                    },
                                    "rationale": {
                                        "type": "string",
                                        "description": "Reasoning for this scheduling decision",
                                    },
                                },
                                "required": [
                                    "task_id",
                                    "estimated_hours",
                                    "priority",
                                    "suggested_day",
                                    "suggested_time_slot",
                                    "rationale",
                                ],
                            },
                        },
                        "recommendations": {
                            "type": "array",
                            "description": "General recommendations for the week",
                            "items": {"type": "string"},
                        },
                        "insights": {
                            "type": "array",
                            "description": "Insights about workload and optimization opportunities",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["task_plans", "recommendations", "insights"],
                },
            },
            {
                "name": "update_plan",
                "description": "Update an existing plan based on progress and changes",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "updated_tasks": {
                            "type": "array",
                            "description": "Tasks with updated planning",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "task_id": {
                                        "type": "string",
                                        "description": "Task identifier",
                                    },
                                    "new_estimated_hours": {
                                        "type": "number",
                                        "description": "Updated time estimate",
                                    },
                                    "new_priority": {
                                        "type": "integer",
                                        "description": "Updated priority level",
                                    },
                                    "adjustment_reason": {
                                        "type": "string",
                                        "description": "Reason for the adjustment",
                                    },
                                },
                                "required": ["task_id", "adjustment_reason"],
                            },
                        },
                        "plan_adjustments": {
                            "type": "array",
                            "description": "Overall plan adjustments and recommendations",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["updated_tasks", "plan_adjustments"],
                },
            },
        ]

    def create_system_prompt(self) -> str:
        """Create system prompt for task planning assistant."""
        return """You are an expert task planning and productivity assistant specialized in research and development project management. Your role is to help users create optimal weekly schedules that maximize productivity and goal achievement.

## Your Expertise:
- Deep work scheduling and time management
- Research project planning and milestone tracking
- Priority-based task organization
- Workload balancing and capacity planning
- Cognitive load optimization

## Planning Principles:
1. **Deep Work First**: Schedule complex, high-cognitive tasks (research, analysis, coding) during peak focus hours (typically mornings)
2. **Energy Management**: Match task difficulty to energy levels throughout the day
3. **Priority Optimization**: Focus on high-impact tasks that advance key project milestones
4. **Realistic Scheduling**: Account for interruptions, meetings, and cognitive fatigue
5. **Goal Alignment**: Ensure tasks directly contribute to project and goal objectives

## Time Slot Guidelines:
- **Morning (9-12)**: Deep work, research, complex analysis
- **Afternoon (13-17)**: Implementation, coding, documentation
- **Evening (18-20)**: Light tasks, planning, administrative work

## Scheduling Strategy:
- Batch similar tasks together for efficiency
- Leave buffer time for unexpected urgent tasks
- Consider task dependencies and logical sequencing
- Account for due dates and deadline pressure
- Balance between different projects to maintain momentum

## Output Requirements:
Always provide specific, actionable recommendations with clear rationale. Include insights about workload distribution and optimization opportunities. Focus on helping the user achieve their research and development goals efficiently.

When creating weekly plans, use the create_week_plan function. When updating existing plans, use the update_plan function."""

    def format_context_for_llm(self, context: WeeklyPlanContext) -> str:
        """Format context data for LLM consumption."""
        context_str = f"""# Weekly Planning Context

## User Information
- User ID: {context.user_id}
- Week Starting: {context.week_start_date.strftime("%Y-%m-%d (%A)")}
- Available Capacity: {context.capacity_hours} hours

## Projects ({len(context.projects)} active)
"""

        for project in context.projects:
            context_str += f"""
### {project.title}
- Project ID: {project.id}
- Description: {project.description or "No description"}
- Created: {project.created_at.strftime("%Y-%m-%d")}
"""

        context_str += f"\n## Goals ({len(context.goals)} active)\n"

        for goal in context.goals:
            project_title = next(
                (p.title for p in context.projects if p.id == goal.project_id),
                "Unknown Project",
            )
            context_str += f"""
### {goal.title} (Project: {project_title})
- Goal ID: {goal.id}
- Estimated Hours: {goal.estimate_hours}
- Description: {goal.description or "No description"}
"""

        context_str += f"\n## Pending Tasks ({len(context.tasks)} items)\n"

        for task in context.tasks:
            goal_title = next(
                (g.title for g in context.goals if g.id == task.goal_id), "Unknown Goal"
            )
            due_info = (
                f" | Due: {task.due_date.strftime('%Y-%m-%d')}" if task.due_date else ""
            )
            context_str += f"""
### {task.title} (Goal: {goal_title})
- Task ID: {task.id}
- Status: {task.status}
- Estimated Hours: {task.estimate_hours}
- Description: {task.description or "No description"}{due_info}
"""

        if context.preferences:
            context_str += (
                f"\n## User Preferences\n{json.dumps(context.preferences, indent=2)}"
            )

        return context_str

    @cached(cache_type="long", key_prefix="openai_weekly_plan")
    async def generate_weekly_plan(
        self, context: WeeklyPlanContext, session: AsyncSession | None = None
    ) -> WeeklyPlanResponse:
        """Generate weekly plan using OpenAI Assistants API."""
        self.session = session  # Store session for logging
        try:
            logger.info(f"Generating weekly plan for user {context.user_id}")

            # Check if OpenAI client is available
            if not self.client:
                return WeeklyPlanResponse(
                    success=False,
                    week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
                    total_planned_hours=0.0,
                    task_plans=[],
                    recommendations=[
                        "OpenAI API key not configured - AI features unavailable"
                    ],
                    insights=[
                        "Please configure your OpenAI API key in settings to enable AI planning"
                    ],
                    generated_at=datetime.now(),
                )

            # Format context for LLM
            context_text = self.format_context_for_llm(context)

            # Create user message
            user_message = f"""Please create an optimal weekly plan for the following context:

{context_text}

Focus on:
1. Prioritizing high-impact tasks that advance key goals
2. Scheduling deep work during optimal time slots
3. Balancing workload across the week
4. Considering due dates and dependencies
5. Providing specific scheduling recommendations

Use the create_week_plan function to structure your response."""

            # Call OpenAI API
            # Prepare API parameters
            api_params = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": self.create_system_prompt()},
                    {"role": "user", "content": user_message},
                ],
                "functions": self.get_function_definitions(),
                "function_call": {"name": "create_week_plan"},
                "max_completion_tokens": 2000,
            }

            # GPT-5 models only support default temperature (1.0)
            if not self.model.startswith("gpt-5"):
                api_params["temperature"] = 0.7

            response = self.client.chat.completions.create(**api_params)

            # Log API usage
            if hasattr(response, "usage") and response.usage:
                await self._log_api_usage(
                    user_id=context.user_id,
                    endpoint="weekly-plan",
                    tokens_used=response.usage.total_tokens,
                    response_status="success",
                )

            # Debug: Log OpenAI response structure
            logger.info(f"🔍 OpenAI Response: {len(response.choices)} choices")
            for i, choice in enumerate(response.choices):
                logger.info(f"🔍 Choice {i}: finish_reason = {choice.finish_reason}")
                logger.info(f"🔍 Choice {i}: message.role = {choice.message.role}")
                logger.info(
                    f"🔍 Choice {i}: has function_call = {hasattr(choice.message, 'function_call')}"
                )
                if hasattr(choice.message, "function_call"):
                    fc = choice.message.function_call
                    logger.info(f"🔍 Choice {i}: function_call = {fc}")
                    logger.info(
                        f"🔍 Choice {i}: function_call.name = {fc.name if fc else 'None'}"
                    )
                if hasattr(choice.message, "content"):
                    content_preview = (
                        str(choice.message.content)[:200]
                        if choice.message.content
                        else "None"
                    )
                    logger.info(f"🔍 Choice {i}: content preview = {content_preview}")
                if hasattr(choice.message, "tool_calls"):
                    logger.info(
                        f"🔍 Choice {i}: tool_calls = {choice.message.tool_calls}"
                    )

            # Parse function call response
            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "create_week_plan":
                function_args = json.loads(function_call.arguments)

                # Convert to our response format
                task_plans = []
                for plan in function_args.get("task_plans", []):
                    # Find task title
                    task_title = next(
                        (t.title for t in context.tasks if t.id == plan["task_id"]),
                        "Unknown Task",
                    )

                    task_plan = TaskPlan(
                        task_id=plan["task_id"],
                        task_title=task_title,
                        estimated_hours=plan["estimated_hours"],
                        priority=plan["priority"],
                        suggested_day=plan["suggested_day"],
                        suggested_time_slot=plan["suggested_time_slot"],
                        rationale=plan["rationale"],
                    )
                    task_plans.append(task_plan)

                total_hours = sum(plan.estimated_hours for plan in task_plans)

                return WeeklyPlanResponse(
                    success=True,
                    week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
                    total_planned_hours=total_hours,
                    task_plans=task_plans,
                    recommendations=function_args.get("recommendations", []),
                    insights=function_args.get("insights", []),
                    generated_at=datetime.now(),
                )
            else:
                logger.error("OpenAI did not return expected function call")
                return WeeklyPlanResponse(
                    success=False,
                    week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
                    total_planned_hours=0.0,
                    task_plans=[],
                    recommendations=["Failed to generate plan - please try again"],
                    insights=["OpenAI API error occurred"],
                    generated_at=datetime.now(),
                )

        except Exception as e:
            logger.error(f"Error generating weekly plan: {e}")
            # Log API error
            if hasattr(self, "session") and self.session:
                await self._log_api_usage(
                    user_id=context.user_id,
                    endpoint="weekly-plan",
                    tokens_used=0,
                    response_status="error",
                )
            return WeeklyPlanResponse(
                success=False,
                week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
                total_planned_hours=0.0,
                task_plans=[],
                recommendations=[f"Error generating plan: {str(e)}"],
                insights=["Please check OpenAI API configuration and try again"],
                generated_at=datetime.now(),
            )

    async def _log_api_usage(
        self, user_id: str, endpoint: str, tokens_used: int, response_status: str
    ) -> None:
        """Log API usage to database."""
        try:
            # Use a separate session for logging to avoid interfering with main transaction
            from taskagent_api.database import get_db

            # Estimate cost (GPT-4 Turbo pricing as of 2024)
            # Input: $0.01 / 1K tokens, Output: $0.03 / 1K tokens
            # Using average for simplicity
            cost_per_1k_tokens = 0.02
            cost_usd = (tokens_used / 1000) * cost_per_1k_tokens

            usage_log = ApiUsageLog(
                user_id=UUID(user_id),
                endpoint=endpoint,
                tokens_used=tokens_used,
                cost_usd=cost_usd,
                response_status=response_status,
            )

            # Use separate session for logging with proper context management
            db_gen = get_db()
            logging_session = next(db_gen)
            try:
                logging_session.add(usage_log)
                logging_session.commit()
            except Exception as commit_error:
                logging_session.rollback()
                logger.error(f"Failed to commit API usage log: {commit_error}")
            finally:
                try:
                    next(db_gen)  # Close the generator
                except StopIteration:
                    pass

        except Exception as e:
            logger.error(f"Failed to log API usage: {e}")


class WeeklyPlanService:
    """Service for weekly plan generation and management."""

    def __init__(self, openai_service: OpenAIService | None = None):
        """Initialize service."""
        self.openai_service = openai_service or OpenAIService()

    async def collect_context(
        self,
        session,
        user_id: str,
        week_start_date: date,
        project_filter: list[str] | None = None,
        capacity_hours: float = 40.0,
        preferences: dict[str, Any] | None = None,
    ) -> WeeklyPlanContext:
        """Collect context data for weekly planning."""

        # Get user's projects
        projects = project_service.get_projects(session, user_id)

        # Filter projects if specified
        if project_filter:
            projects = [p for p in projects if p.id in project_filter]

        # Get goals for the projects
        goals = []
        for project in projects:
            project_goals = goal_service.get_goals_by_project(
                session, project.id, user_id
            )
            goals.extend(project_goals)

        # Get pending tasks for the goals
        tasks = []
        for goal in goals:
            goal_tasks = task_service.get_tasks_by_goal(session, goal.id, user_id)
            # Only include pending and in-progress tasks
            pending_tasks = [
                t for t in goal_tasks if t.status in ["pending", "in_progress"]
            ]
            tasks.extend(pending_tasks)

        return WeeklyPlanContext(
            user_id=user_id,
            week_start_date=week_start_date,
            projects=projects,
            goals=goals,
            tasks=tasks,
            capacity_hours=capacity_hours,
            preferences=preferences or {},
        )

    async def generate_weekly_plan(
        self, session, user_id: str, request: WeeklyPlanRequest
    ) -> WeeklyPlanResponse:
        """Generate weekly plan for user."""

        # Parse week start date
        week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

        # Collect context
        context = await self.collect_context(
            session=session,
            user_id=user_id,
            week_start_date=week_start,
            project_filter=request.project_filter,
            capacity_hours=request.capacity_hours,
            preferences=request.preferences,
        )

        # Create user-specific OpenAI service if not provided
        if not hasattr(self, "openai_service") or not self.openai_service:
            self.openai_service = await OpenAIService.create_for_user(
                UUID(user_id), session
            )

        # Generate plan using OpenAI
        return await self.openai_service.generate_weekly_plan(context, session)
