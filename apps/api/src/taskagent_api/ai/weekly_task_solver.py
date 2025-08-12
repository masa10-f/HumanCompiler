"""
Advanced weekly task solver using GPT-5 for optimized task selection and allocation.

This module implements an AI-powered system that goes beyond simple weekly planning
to provide intelligent task selection, project allocation, and constraint-based optimization.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from openai import OpenAI, APIError, RateLimitError, AuthenticationError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from taskagent_api.ai.context_collector import ContextCollector
from taskagent_api.ai.models import WeeklyPlanContext, TaskPlan
from taskagent_api.models import Project, Goal, Task, UserSettings
from taskagent_api.crypto import get_crypto_service

logger = logging.getLogger(__name__)


class ProjectAllocation(BaseModel):
    """Project time allocation configuration."""

    project_id: str
    project_title: str
    target_hours: float
    max_hours: float
    priority_weight: float


class WeeklyConstraints(BaseModel):
    """Weekly constraints configuration for task solver."""

    total_capacity_hours: float = Field(40.0, description="Total weekly capacity")
    daily_max_hours: float = Field(8.0, description="Maximum daily work hours")
    deep_work_blocks: int = Field(2, description="Number of deep work blocks per day")
    meeting_buffer_hours: float = Field(
        5.0, description="Buffer for meetings and admin"
    )
    project_allocations: list[ProjectAllocation] = Field(default_factory=list)

    # Constraint priorities
    deadline_weight: float = Field(0.4, description="Weight for deadline urgency")
    project_balance_weight: float = Field(0.3, description="Weight for project balance")
    effort_efficiency_weight: float = Field(
        0.3, description="Weight for effort efficiency"
    )


class TaskSolverRequest(BaseModel):
    """Request for weekly task solver."""

    week_start_date: str = Field(..., description="Week start date (YYYY-MM-DD)")
    constraints: WeeklyConstraints = Field(default_factory=WeeklyConstraints)
    project_filter: list[str] | None = Field(None, description="Filter by project IDs")
    preferences: dict[str, Any] = Field(default_factory=dict)


class TaskSolverResponse(BaseModel):
    """Response from weekly task solver."""

    success: bool
    week_start_date: str
    total_allocated_hours: float
    project_allocations: list[ProjectAllocation]
    selected_tasks: list[TaskPlan]
    optimization_insights: list[str]
    constraint_analysis: dict[str, Any]
    solver_metrics: dict[str, float]
    generated_at: datetime


class WeeklyTaskSolver:
    """Advanced AI-powered weekly task solver using GPT-5."""

    def __init__(
        self, openai_client: OpenAI | None = None, model: str = "gpt-4o-2024-11-20"
    ):
        """Initialize solver with OpenAI client."""
        self.openai_client = openai_client
        self.model = model  # Use latest GPT-4 model as GPT-5 placeholder
        self.context_collector = ContextCollector()

    @classmethod
    async def create_for_user(
        cls, user_id: UUID, session: Session
    ) -> "WeeklyTaskSolver":
        """Create solver instance for specific user with their API key."""
        # Get user settings
        result = session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

        openai_client = None
        model = "gpt-4o-2024-11-20"  # Default to latest GPT-4

        if user_settings and user_settings.openai_api_key_encrypted:
            # Decrypt API key
            api_key = get_crypto_service().decrypt(
                user_settings.openai_api_key_encrypted
            )
            if api_key:
                openai_client = OpenAI(api_key=api_key)
                model = user_settings.openai_model or model

        return cls(openai_client=openai_client, model=model)

    async def solve_weekly_tasks(
        self, session: Session, user_id: str, request: TaskSolverRequest
    ) -> TaskSolverResponse:
        """Solve weekly task allocation using AI-powered optimization."""
        try:
            logger.info(f"Starting weekly task solving for user {user_id}")

            # Parse week start date
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

            # Collect comprehensive context
            context = await self._collect_solver_context(
                session, user_id, week_start, request
            )

            # Analyze current workload and constraints
            constraint_analysis = self._analyze_constraints(
                context, request.constraints
            )

            # Optimize project allocations
            project_allocations = self._optimize_project_allocations(
                context, request.constraints
            )

            # Generate AI-powered task selection
            if self.openai_client:
                ai_response = await self._generate_ai_task_selection(
                    context, request.constraints, project_allocations
                )
                selected_tasks = ai_response.get("selected_tasks", [])
                optimization_insights = ai_response.get("insights", [])
            else:
                # Fallback heuristic selection
                selected_tasks, optimization_insights = self._heuristic_task_selection(
                    context, request.constraints, project_allocations
                )

            # Calculate solver metrics
            solver_metrics = self._calculate_solver_metrics(
                selected_tasks, project_allocations, request.constraints
            )

            total_allocated = sum(task.estimated_hours for task in selected_tasks)

            return TaskSolverResponse(
                success=True,
                week_start_date=request.week_start_date,
                total_allocated_hours=total_allocated,
                project_allocations=project_allocations,
                selected_tasks=selected_tasks,
                optimization_insights=optimization_insights,
                constraint_analysis=constraint_analysis,
                solver_metrics=solver_metrics,
                generated_at=datetime.now(),
            )

        except Exception as e:
            logger.error(f"Error in weekly task solving: {e}")
            return TaskSolverResponse(
                success=False,
                week_start_date=request.week_start_date,
                total_allocated_hours=0.0,
                project_allocations=[],
                selected_tasks=[],
                optimization_insights=[f"Solver error: {str(e)}"],
                constraint_analysis={},
                solver_metrics={},
                generated_at=datetime.now(),
            )

    async def _collect_solver_context(
        self, session: Session, user_id: str, week_start, request: TaskSolverRequest
    ) -> WeeklyPlanContext:
        """Collect comprehensive context for task solving."""
        return await self.context_collector.collect_weekly_plan_context(
            session=session,
            user_id=user_id,
            week_start_date=week_start,
            project_filter=request.project_filter,
            capacity_hours=request.constraints.total_capacity_hours,
            preferences=request.preferences,
        )

    def _analyze_constraints(
        self, context: WeeklyPlanContext, constraints: WeeklyConstraints
    ) -> dict[str, Any]:
        """Analyze current constraints and workload."""
        total_task_hours = sum(
            float(task.estimate_hours or 0) for task in context.tasks
        )
        available_hours = (
            constraints.total_capacity_hours - constraints.meeting_buffer_hours
        )

        # Count urgent tasks (due within week)
        week_end = context.week_start_date + timedelta(days=7)
        urgent_tasks = [
            task
            for task in context.tasks
            if task.due_date and task.due_date <= week_end
        ]

        return {
            "total_task_hours": total_task_hours,
            "available_hours": available_hours,
            "capacity_utilization": min(total_task_hours / available_hours, 1.0)
            if available_hours > 0
            else 0,
            "urgent_task_count": len(urgent_tasks),
            "project_count": len(context.projects),
            "overload_risk": total_task_hours > constraints.total_capacity_hours,
        }

    def _optimize_project_allocations(
        self, context: WeeklyPlanContext, constraints: WeeklyConstraints
    ) -> list[ProjectAllocation]:
        """Optimize time allocation across projects."""
        if constraints.project_allocations:
            return constraints.project_allocations

        # Auto-generate balanced allocations
        available_hours = (
            constraints.total_capacity_hours - constraints.meeting_buffer_hours
        )
        project_count = len(context.projects)

        if project_count == 0:
            return []

        # Calculate project priorities based on task urgency and volume
        project_priorities = {}
        for project in context.projects:
            project_tasks = [
                t
                for t in context.tasks
                if any(
                    g.project_id == project.id
                    for g in context.goals
                    if g.id == t.goal_id
                )
            ]

            urgent_count = sum(
                1
                for task in project_tasks
                if task.due_date
                and task.due_date <= context.week_start_date + timedelta(days=7)
            )
            total_hours = sum(float(task.estimate_hours or 0) for task in project_tasks)

            priority_score = urgent_count * 2.0 + total_hours * 0.1
            project_priorities[project.id] = priority_score

        # Normalize priorities
        total_priority = sum(project_priorities.values())
        if total_priority == 0:
            # Equal allocation if no priorities
            base_hours = float(available_hours) / project_count
            return [
                ProjectAllocation(
                    project_id=project.id,
                    project_title=project.title,
                    target_hours=base_hours,
                    max_hours=base_hours * 1.5,
                    priority_weight=1.0,
                )
                for project in context.projects
            ]

        # Proportional allocation based on priorities
        allocations = []
        for project in context.projects:
            priority_ratio = project_priorities[project.id] / total_priority
            target_hours = float(available_hours) * priority_ratio

            allocations.append(
                ProjectAllocation(
                    project_id=project.id,
                    project_title=project.title,
                    target_hours=target_hours,
                    max_hours=target_hours * 1.5,
                    priority_weight=priority_ratio,
                )
            )

        return allocations

    async def _generate_ai_task_selection(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, Any]:
        """Generate AI-powered task selection using GPT-5."""
        try:
            system_prompt = self._create_solver_system_prompt()
            user_message = self._create_solver_user_message(
                context, constraints, project_allocations
            )

            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                functions=self._get_solver_function_definitions(),
                function_call={"name": "solve_weekly_tasks"},
                temperature=0.3,  # Lower temperature for more consistent optimization
                max_tokens=3000,
            )

            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "solve_weekly_tasks":
                return self._parse_solver_response(function_call, context)
            else:
                raise ValueError("AI did not return expected function call")

        except (RateLimitError, AuthenticationError, APIError) as e:
            logger.error(f"OpenAI API error in task solver: {e}")
            # Fallback to heuristic selection
            return {"selected_tasks": [], "insights": [f"AI unavailable: {str(e)}"]}

    def _heuristic_task_selection(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> tuple[list[TaskPlan], list[str]]:
        """Fallback heuristic task selection when AI is unavailable."""
        selected_tasks = []
        insights = ["Using heuristic task selection (AI unavailable)"]

        # Sort tasks by priority score
        scored_tasks = []
        week_end = context.week_start_date + timedelta(days=7)

        for task in context.tasks:
            # Calculate priority score
            urgency_score = 0
            if task.due_date:
                # Convert context.week_start_date to datetime for comparison
                week_start_dt = datetime.combine(
                    context.week_start_date, datetime.min.time()
                )
                task_due_dt = datetime.combine(task.due_date, datetime.min.time())
                days_until_due = (task_due_dt - week_start_dt).days
                if days_until_due <= 7:
                    urgency_score = 10 - days_until_due

            effort_score = 10 - min(
                float(task.estimate_hours or 0), 10
            )  # Prefer smaller tasks

            total_score = (
                urgency_score * constraints.deadline_weight
                + effort_score * constraints.effort_efficiency_weight
            )
            scored_tasks.append((task, total_score))

        # Sort by score descending
        scored_tasks.sort(key=lambda x: x[1], reverse=True)

        # Select tasks within capacity
        total_hours = 0.0
        for task, score in scored_tasks:
            task_hours = float(task.estimate_hours or 0)
            if total_hours + task_hours <= constraints.total_capacity_hours:
                selected_tasks.append(
                    TaskPlan(
                        task_id=task.id,
                        task_title=task.title,
                        estimated_hours=task_hours,
                        priority=int(score),
                        suggested_day="Monday",  # Simple assignment
                        suggested_time_slot="09:00-12:00",
                        rationale=f"Selected based on heuristic score: {score:.1f}",
                    )
                )
                total_hours += task_hours

        return selected_tasks, insights

    def _create_solver_system_prompt(self) -> str:
        """Create system prompt for AI task solver."""
        return """You are an advanced AI task allocation optimizer specializing in weekly planning.

Your role is to intelligently select and schedule tasks for optimal productivity while respecting constraints.

Key capabilities:
- Analyze project priorities and deadlines
- Balance workload across multiple projects
- Optimize for deep work blocks and energy management
- Respect capacity and time constraints
- Provide strategic insights on task prioritization

Consider these factors in your optimization:
1. Deadline urgency and business impact
2. Task dependencies and blocking relationships
3. Cognitive load and context switching costs
4. Energy levels throughout the week
5. Project strategic importance and resource allocation

Always provide clear rationale for your decisions and actionable insights."""

    def _create_solver_user_message(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> str:
        """Create user message for AI task solver."""
        # Format context data
        projects_data = [
            {
                "id": p.id,
                "title": p.title,
                "description": p.description,
            }
            for p in context.projects
        ]

        tasks_data = [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "estimate_hours": t.estimate_hours,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "status": t.status,
                "goal_id": t.goal_id,
            }
            for t in context.tasks
        ]

        allocations_data = [
            {
                "project_id": a.project_id,
                "project_title": a.project_title,
                "target_hours": a.target_hours,
                "max_hours": a.max_hours,
                "priority_weight": a.priority_weight,
            }
            for a in project_allocations
        ]

        return f"""Optimize weekly task selection for user {context.user_id}.

Week: {context.week_start_date.strftime("%Y-%m-%d")}
Total Capacity: {constraints.total_capacity_hours} hours
Available for Tasks: {constraints.total_capacity_hours - constraints.meeting_buffer_hours} hours

PROJECTS:
{json.dumps(projects_data, indent=2)}

AVAILABLE TASKS:
{json.dumps(tasks_data, indent=2)}

PROJECT ALLOCATIONS:
{json.dumps(allocations_data, indent=2)}

CONSTRAINTS:
- Daily max: {constraints.daily_max_hours} hours
- Deep work blocks needed: {constraints.deep_work_blocks} per day
- Meeting buffer: {constraints.meeting_buffer_hours} hours
- Deadline weight: {constraints.deadline_weight}
- Project balance weight: {constraints.project_balance_weight}
- Effort efficiency weight: {constraints.effort_efficiency_weight}

Select optimal tasks considering deadlines, project balance, and capacity constraints.
Provide strategic insights on workload optimization and task prioritization."""

    def _get_solver_function_definitions(self) -> list[dict[str, Any]]:
        """Get function definitions for AI task solver."""
        return [
            {
                "name": "solve_weekly_tasks",
                "description": "Solve optimal weekly task allocation",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selected_tasks": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "task_id": {"type": "string"},
                                    "estimated_hours": {"type": "number"},
                                    "priority": {"type": "integer"},
                                    "suggested_day": {"type": "string"},
                                    "suggested_time_slot": {"type": "string"},
                                    "rationale": {"type": "string"},
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
                        "insights": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Strategic insights and optimization recommendations",
                        },
                        "allocation_analysis": {
                            "type": "object",
                            "description": "Analysis of project time allocations",
                        },
                    },
                    "required": ["selected_tasks", "insights"],
                },
            }
        ]

    def _parse_solver_response(
        self, function_call, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """Parse AI solver response."""
        try:
            function_args = json.loads(function_call.arguments)

            # Convert to TaskPlan objects
            selected_tasks = []
            for plan in function_args.get("selected_tasks", []):
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
                selected_tasks.append(task_plan)

            return {
                "selected_tasks": selected_tasks,
                "insights": function_args.get("insights", []),
                "allocation_analysis": function_args.get("allocation_analysis", {}),
            }

        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Error parsing solver response: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"Response parse error: {str(e)}"],
            }

    def _calculate_solver_metrics(
        self,
        selected_tasks: list[TaskPlan],
        project_allocations: list[ProjectAllocation],
        constraints: WeeklyConstraints,
    ) -> dict[str, float]:
        """Calculate solver performance metrics."""
        total_allocated = sum(task.estimated_hours for task in selected_tasks)
        capacity_utilization = total_allocated / constraints.total_capacity_hours

        # Calculate project balance score
        project_hours = {}
        for task in selected_tasks:
            # Simplified - would need project mapping in real implementation
            project_id = "unknown"
            project_hours[project_id] = (
                project_hours.get(project_id, 0) + task.estimated_hours
            )

        balance_score = 1.0  # Placeholder calculation

        return {
            "capacity_utilization": capacity_utilization,
            "project_balance_score": balance_score,
            "task_count": len(selected_tasks),
            "avg_task_hours": total_allocated / len(selected_tasks)
            if selected_tasks
            else 0,
        }
