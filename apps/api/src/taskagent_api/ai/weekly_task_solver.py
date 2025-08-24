"""
Advanced weekly task solver using GPT-5 for optimized task selection and allocation.

This module implements an AI-powered system that goes beyond simple weekly planning
to provide intelligent task selection, project allocation, and constraint-based optimization.
"""

import json
import logging
import re
from datetime import datetime, timedelta, date
from typing import Any
from uuid import UUID

from openai import OpenAI, APIError, RateLimitError, AuthenticationError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from taskagent_api.ai.context_collector import ContextCollector
from taskagent_api.ai.models import WeeklyPlanContext, TaskPlan
from taskagent_api.ai.task_utils import filter_valid_tasks
from taskagent_api.models import Project, Goal, Task, UserSettings, Log, TaskDependency
from taskagent_api.crypto import get_crypto_service
from sqlmodel import func, select
from uuid import UUID

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
    selected_recurring_task_ids: list[str] = Field(
        default_factory=list, description="Selected weekly recurring task IDs"
    )
    preferences: dict[str, Any] = Field(default_factory=dict)
    user_prompt: str | None = Field(
        None, description="User instructions for weekly scheduling priorities"
    )
    use_ai_priority: bool = Field(
        default=False, description="Use OpenAI for priority evaluation"
    )


class TaskSolverResponse(BaseModel):
    """Response from weekly task solver."""

    success: bool
    week_start_date: str
    total_allocated_hours: float
    project_allocations: list[ProjectAllocation]
    selected_tasks: list[TaskPlan]
    optimization_insights: list[str]
    constraint_analysis: dict[str, Any]
    solver_metrics: dict[str, Any]
    generated_at: datetime


class TaskPriorityExtractor:
    """Extract task priorities using OpenAI API based on user requirements."""

    def __init__(self, openai_client: OpenAI | None = None, model: str = "gpt-4"):
        """Initialize priority extractor with OpenAI client."""
        self.openai_client = openai_client
        self.model = model

    async def extract_priorities(
        self,
        context: WeeklyPlanContext,
        user_prompt: str | None,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, float]:
        """
        Extract task priorities from user requirements and project context.

        Args:
            context: Weekly planning context with tasks and projects
            user_prompt: User instructions for priority adjustment
            project_allocations: Project resource allocation ratios

        Returns:
            Dictionary mapping task_id to priority score (0.0-10.0)
        """
        if not self.openai_client:
            return self._fallback_priority_calculation(context, project_allocations)

        try:
            priority_context = self._create_priority_context(
                context, user_prompt, project_allocations
            )

            logger.info(f"Calling OpenAI API with model: {self.model}")
            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "あなたは週間タスク優先度の専門家です。与えられた情報を基に各タスクの優先度スコア（0-10）を算出してください。",
                    },
                    {"role": "user", "content": priority_context},
                ],
                tools=[self._get_priority_extraction_tool()],
                tool_choice="auto",
                temperature=0.3,
            )

            return self._parse_priority_response(response, context)

        except Exception as e:
            logger.error(f"Priority extraction failed: {e}")
            return self._fallback_priority_calculation(context, project_allocations)

    def _create_priority_context(
        self,
        context: WeeklyPlanContext,
        user_prompt: str | None,
        project_allocations: list[ProjectAllocation],
    ) -> str:
        """Create context for priority extraction."""
        tasks_data = []
        for task in context.tasks:
            # Use remaining_hours for task context
            remaining_hours = getattr(
                task, "remaining_hours", float(task.estimate_hours or 0)
            )
            task_data = {
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "estimate_hours": remaining_hours,  # Using remaining hours for AI context
                "due_date": task.due_date.isoformat() if task.due_date else None,
                "priority": getattr(task, "priority", 3),
                "goal_id": task.goal_id,
            }
            tasks_data.append(task_data)

        projects_data = []
        for project in context.projects:
            allocation = next(
                (a for a in project_allocations if a.project_id == project.id), None
            )
            project_data = {
                "id": project.id,
                "title": project.title,
                "description": project.description,
                "allocation_ratio": allocation.priority_weight if allocation else 0.0,
            }
            projects_data.append(project_data)

        goals_data = []
        for goal in context.goals:
            goal_data = {
                "id": goal.id,
                "project_id": goal.project_id,
                "title": goal.title,
                "description": goal.description,
            }
            goals_data.append(goal_data)

        prompt_section = ""
        if user_prompt:
            prompt_section = f"""

## ユーザーからの特別な指示
{user_prompt}

上記の指示を優先度計算に反映してください。"""

        return f"""週間タスクの優先度を算出してください。

## プロジェクト情報とリソース配分
{json.dumps(projects_data, indent=2, ensure_ascii=False)}

## ゴール情報
{json.dumps(goals_data, indent=2, ensure_ascii=False)}

## タスクリスト
{json.dumps(tasks_data, indent=2, ensure_ascii=False)}

## 週開始日
{context.week_start_date.strftime("%Y-%m-%d")}

## 優先度算出の基準
1. **ユーザー設定の優先度** - ユーザーが設定した優先度レベル（1=最高、5=最低）を基礎スコアとして使用
2. **締切の緊急度** - 週内および近い将来の締切
3. **プロジェクトの戦略的重要度** - リソース配分比率を考慮
4. **タスクの影響度** - プロジェクト目標への貢献度
5. **依存関係** - 他のタスクをブロックする可能性
6. **工数効率** - 投入時間に対する価値{prompt_section}

**重要**: ユーザーが設定したpriorityフィールド（1-5）を基礎として、他の要因で微調整してください。
priority=1のタスクは高スコア、priority=5のタスクは低スコアとなるように算出してください。

各タスクに対して0.0-10.0の優先度スコアを算出し、extract_task_priorities関数で構造化して返してください。"""

    def _get_priority_extraction_tool(self) -> dict[str, Any]:
        """Get tool definition for priority extraction."""
        return {
            "type": "function",
            "function": {
                "name": "extract_task_priorities",
                "description": "Extract priority scores for tasks",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_priorities": {
                            "type": "object",
                            "description": "Task ID to priority score mapping",
                            "additionalProperties": {"type": "number"},
                        },
                        "priority_rationale": {
                            "type": "object",
                            "description": "Explanation for each task's priority",
                            "additionalProperties": {"type": "string"},
                        },
                        "optimization_insights": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Strategic insights about priority decisions",
                        },
                    },
                    "required": ["task_priorities"],
                },
            },
        }

    def _parse_priority_response(
        self, response, context: WeeklyPlanContext
    ) -> dict[str, float]:
        """Parse priority extraction response."""
        try:
            message = response.choices[0].message
            if message.tool_calls:
                tool_call = message.tool_calls[0]
                if tool_call.function.name == "extract_task_priorities":
                    function_args = json.loads(tool_call.function.arguments)
                    return function_args.get("task_priorities", {})

            return self._fallback_priority_calculation(context, [])

        except Exception as e:
            logger.error(f"Failed to parse priority response: {e}")
            return self._fallback_priority_calculation(context, [])

    def _fallback_priority_calculation(
        self, context: WeeklyPlanContext, project_allocations: list[ProjectAllocation]
    ) -> dict[str, float]:
        """Fallback priority calculation when AI is unavailable."""
        priorities = {}

        for task in context.tasks:
            # Start with user-defined priority (convert 1-5 scale to 0-10 scale)
            user_priority = getattr(task, "priority", 3)
            # Convert user priority: 1 (highest) -> 8.0, 3 (medium) -> 5.0, 5 (lowest) -> 2.0
            base_priority = 10.0 - (user_priority - 1) * 2.0

            # Urgency based on due date
            if task.due_date:
                try:
                    task_due_dt = datetime.combine(task.due_date, datetime.min.time())
                    week_start_dt = datetime.combine(
                        context.week_start_date, datetime.min.time()
                    )
                    days_until_due = (task_due_dt - week_start_dt).days

                    if days_until_due <= 3:
                        base_priority += 3.0  # Very urgent
                    elif days_until_due <= 7:
                        base_priority += 2.0  # Urgent
                    elif days_until_due <= 14:
                        base_priority += 1.0  # Moderately urgent
                except (TypeError, ValueError):
                    pass

            # Project allocation weight
            goal = next((g for g in context.goals if g.id == task.goal_id), None)
            if goal:
                allocation = next(
                    (a for a in project_allocations if a.project_id == goal.project_id),
                    None,
                )
                if allocation:
                    base_priority += allocation.priority_weight * 2.0

            # Task size consideration (prefer smaller tasks based on remaining hours)
            remaining_hours = getattr(
                task, "remaining_hours", float(task.estimate_hours or 0)
            )
            if remaining_hours > 0:
                if remaining_hours <= 2.0:
                    base_priority += 1.0  # Small task bonus
                elif remaining_hours >= 8.0:
                    base_priority -= 0.5  # Large task penalty

            # Cap priority at 10.0
            priorities[str(task.id)] = min(10.0, max(0.0, base_priority))

        return priorities


class WeeklyTaskSolver:
    """Advanced AI-powered weekly task solver using GPT-5."""

    def __init__(self, openai_client: OpenAI | None = None, model: str = "gpt-5"):
        """Initialize solver with OpenAI client."""
        self.openai_client = openai_client
        self.model = model  # Use GPT-5 for advanced task optimization
        self.context_collector = ContextCollector()
        self.priority_extractor = TaskPriorityExtractor(openai_client, "gpt-4")

    @classmethod
    async def create_for_user(
        cls, user_id: UUID, session: Session
    ) -> "WeeklyTaskSolver":
        """Create solver instance for specific user with their API key."""
        try:
            # Get user settings
            result = session.execute(
                select(UserSettings).where(UserSettings.user_id == user_id)
            )
            user_settings = result.scalar_one_or_none()

            openai_client = None
            model = "gpt-5"  # Default to GPT-5

            if user_settings and user_settings.openai_api_key_encrypted:
                try:
                    # Decrypt API key with error handling
                    api_key = get_crypto_service().decrypt(
                        user_settings.openai_api_key_encrypted
                    )
                    if api_key:
                        openai_client = OpenAI(api_key=api_key)
                        model = user_settings.openai_model or model
                        logger.info(
                            f"Using user-specific OpenAI API key for user {user_id} with model {model}"
                        )
                except Exception as e:
                    logger.warning(f"Failed to decrypt API key for user {user_id}: {e}")
                    # Continue without user-specific API key

            if not openai_client:
                logger.info(f"Using system default OpenAI client for user {user_id}")

            return cls(openai_client=openai_client, model=model)

        except Exception as e:
            logger.error(f"Failed to create WeeklyTaskSolver for user {user_id}: {e}")
            # Return solver without OpenAI client as fallback
            return cls(openai_client=None, model="gpt-5")

    async def solve_weekly_tasks(
        self, session: Session, user_id: str, request: TaskSolverRequest
    ) -> TaskSolverResponse:
        """Solve weekly task allocation using AI-powered optimization."""
        try:
            logger.info(f"Starting weekly task solving for user {user_id}")

            # Parse week start date
            week_start = datetime.strptime(request.week_start_date, "%Y-%m-%d").date()

            # Collect comprehensive context
            # First, get project allocations to filter tasks properly
            initial_context = await self.context_collector.collect_weekly_plan_context(
                session=session,
                user_id=user_id,
                week_start_date=week_start,
                project_filter=request.project_filter,
                selected_recurring_task_ids=request.selected_recurring_task_ids,
                capacity_hours=request.constraints.total_capacity_hours,
                preferences=request.preferences,
            )

            # Optimize project allocations
            project_allocations = self._optimize_project_allocations(
                initial_context, request.constraints
            )

            # Collect context with 0% allocation filtering
            context = await self._collect_solver_context(
                session, user_id, week_start, request, project_allocations
            )

            # Analyze current workload and constraints
            constraint_analysis = self._analyze_constraints(
                context, request.constraints
            )

            # Stage 1: Extract task priorities
            if request.use_ai_priority:
                logger.info("Stage 1: Extracting task priorities with OpenAI API")
                task_priorities = await self.priority_extractor.extract_priorities(
                    context, request.user_prompt, project_allocations
                )
            else:
                logger.info("Stage 1: Using database priorities (OpenAI disabled)")
                task_priorities = (
                    self.priority_extractor._fallback_priority_calculation(
                        context, project_allocations
                    )
                )

            # Stage 2: Apply OR-Tools optimization with extracted priorities
            logger.info("Stage 2: Applying OR-Tools optimization with priorities")
            selected_tasks, optimization_insights = await self._optimize_with_ortools(
                context,
                request.constraints,
                project_allocations,
                task_priorities,
                request.user_prompt,
            )

            # Calculate solver metrics
            solver_metrics = self._calculate_solver_metrics(
                selected_tasks, project_allocations, request.constraints, context
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

    def _get_task_actual_hours(
        self, session: Session, task_ids: list[str]
    ) -> dict[str, float]:
        """
        Get actual hours logged for each task from the logs table.

        Args:
            session: Database session
            task_ids: List of task IDs to get actual hours for

        Returns:
            Dict mapping task_id to total actual hours
        """
        if not task_ids:
            return {}

        try:
            # Convert string IDs to UUIDs
            task_uuids = []
            for task_id in task_ids:
                try:
                    task_uuids.append(UUID(task_id))
                except ValueError as uuid_error:
                    logger.warning(
                        f"Invalid UUID format for task ID {task_id}: {uuid_error}"
                    )
                    continue

            if not task_uuids:
                return {}

            # Query logs table to get actual hours per task
            results = session.exec(
                select(Log.task_id, func.sum(Log.actual_minutes).label("total_minutes"))
                .where(Log.task_id.in_(task_uuids))
                .group_by(Log.task_id)
            ).all()

            # Convert minutes to hours and map by task ID string
            actual_hours_map = {}
            for task_id, total_minutes in results:
                hours = float(total_minutes or 0) / 60.0
                actual_hours_map[str(task_id)] = hours

            return actual_hours_map

        except Exception as e:
            logger.error(f"Error getting actual hours for tasks: {e}")
            return {}

    async def _collect_solver_context(
        self,
        session: Session,
        user_id: str,
        week_start,
        request: TaskSolverRequest,
        project_allocations: list[ProjectAllocation] | None = None,
    ) -> WeeklyPlanContext:
        """Collect comprehensive context for task solving."""
        context = await self.context_collector.collect_weekly_plan_context(
            session=session,
            user_id=user_id,
            week_start_date=week_start,
            project_filter=request.project_filter,
            selected_recurring_task_ids=request.selected_recurring_task_ids,
            capacity_hours=request.constraints.total_capacity_hours,
            preferences=request.preferences,
        )

        # Get actual hours for all tasks to calculate remaining hours
        task_ids = [str(task.id) for task in context.tasks]
        actual_hours_map = self._get_task_actual_hours(session, task_ids)

        # Calculate remaining hours for each task and filter out completed tasks
        filtered_tasks = []
        for task in context.tasks:
            task_id = str(task.id)
            actual_hours = actual_hours_map.get(task_id, 0.0)
            estimate_hours = float(task.estimate_hours or 0)
            remaining_hours = max(0.0, estimate_hours - actual_hours)

            # Use setattr to safely add remaining hours as an attribute to the task object
            try:
                task.remaining_hours = remaining_hours
                task.actual_hours = actual_hours
            except (AttributeError, ValueError):
                # If setattr fails, create a wrapper object
                pass

            # Only include tasks with remaining hours > 0
            if remaining_hours > 0:
                filtered_tasks.append(task)
            else:
                logger.info(
                    f"Excluding completed task {task_id} '{task.title}' - no remaining hours"
                )

        # Collect task dependencies
        task_dependencies = self._collect_task_dependencies(session, filtered_tasks)

        # Apply relaxed dependency constraints - allow tasks if their dependencies
        # are either completed or can be scheduled in the same week
        schedulable_tasks, blocked_tasks = self._check_dependencies_schedulable_in_week(
            task_dependencies, filtered_tasks, session
        )

        # Use provided project allocations or calculate them if not provided
        if project_allocations is None:
            project_allocations = self._optimize_project_allocations(
                context, request.constraints
            )

        # Filter out tasks from projects with 0% allocation
        final_tasks = []
        zero_allocation_projects = set()

        for task in schedulable_tasks:
            # Find the project for this task
            goal = next((g for g in context.goals if g.id == task.goal_id), None)
            if not goal:
                # If no goal found, include the task (no project allocation to check)
                final_tasks.append(task)
                continue

            # Find the allocation for this project (convert both to string for comparison)
            allocation = next(
                (
                    a
                    for a in project_allocations
                    if str(a.project_id) == str(goal.project_id)
                ),
                None,
            )

            if allocation and allocation.target_hours <= 0.001:
                # This project has 0% allocation - exclude all its tasks
                zero_allocation_projects.add(goal.project_id)
                logger.info(
                    f"Excluding task {task.id} '{task.title}' - project {goal.project_id} has 0% allocation"
                )
            else:
                final_tasks.append(task)

        # Update context with filtered tasks
        context.tasks = final_tasks

        logger.info(
            f"Context filtering: {len(final_tasks)} final tasks, "
            f"{len(schedulable_tasks) - len(final_tasks)} excluded from 0% allocation projects, "
            f"{len(blocked_tasks)} blocked by dependencies, "
            f"out of {len(task_ids)} total tasks"
        )

        if zero_allocation_projects:
            logger.info(
                f"Excluded {len(zero_allocation_projects)} projects with 0% allocation: {zero_allocation_projects}"
            )

        return context

    def _collect_task_dependencies(
        self, session: Session, tasks: list[Task]
    ) -> dict[str, list[str]]:
        """Collect task dependency information for the given tasks."""
        task_ids = [task.id for task in tasks]
        if not task_ids:
            return {}

        try:
            # Get all dependencies for these tasks
            dependencies = session.exec(
                select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))
            ).all()

            # Build dependency mapping
            dependency_map = {}
            for dep in dependencies:
                task_id = str(dep.task_id)
                depends_on_task_id = str(dep.depends_on_task_id)
                if task_id not in dependency_map:
                    dependency_map[task_id] = []
                dependency_map[task_id].append(depends_on_task_id)

            logger.info(f"Collected dependencies for {len(dependency_map)} tasks")
            return dependency_map

        except Exception as e:
            logger.error(f"Error collecting task dependencies: {e}")
            return {}

    def _check_dependencies_schedulable_in_week(
        self,
        task_dependencies: dict[str, list[str]],
        available_tasks: list[Task],
        session: Session,
    ) -> tuple[list[Task], list[Task]]:
        """Check which tasks with dependencies can be scheduled in the same week.

        This implements the relaxed dependency constraint where a task can be scheduled
        if its dependencies are either:
        1. Already completed, or
        2. Available for scheduling in the same week

        Returns:
            tuple: (schedulable_tasks, blocked_tasks)
        """
        available_task_ids = {str(task.id) for task in available_tasks}
        schedulable_tasks = []
        blocked_tasks = []

        for task in available_tasks:
            task_id = str(task.id)

            if task_id not in task_dependencies:
                # No dependencies, always schedulable
                schedulable_tasks.append(task)
                continue

            dependencies = task_dependencies[task_id]

            # Check if all dependencies are either completed or available for scheduling
            all_deps_satisfiable = True
            unsatisfied_deps = []

            for dep_task_id in dependencies:
                if dep_task_id in available_task_ids:
                    # Dependency task is available for scheduling in the same week - this is fine
                    continue
                else:
                    # Dependency task is not available, check if it's completed
                    try:
                        dep_task = session.get(Task, UUID(dep_task_id))
                        if dep_task and dep_task.status in [
                            "completed",
                            "done",
                            "finished",
                        ]:
                            # Dependency is completed, this is fine
                            continue
                        else:
                            # Dependency is not completed and not available for scheduling
                            all_deps_satisfiable = False
                            unsatisfied_deps.append(dep_task_id)
                    except Exception as e:
                        # If we can't check the dependency task, assume it's not satisfiable
                        logger.warning(
                            f"Could not check dependency task {dep_task_id}: {e}"
                        )
                        all_deps_satisfiable = False
                        unsatisfied_deps.append(dep_task_id)

            if all_deps_satisfiable:
                schedulable_tasks.append(task)
                logger.debug(
                    f"Task {task_id} '{task.title}' is schedulable (dependencies satisfiable)"
                )
            else:
                blocked_tasks.append(task)
                logger.info(
                    f"Task {task_id} '{task.title}' blocked by unsatisfied dependencies: {unsatisfied_deps}"
                )

        logger.info(
            f"Relaxed dependency analysis: {len(schedulable_tasks)} schedulable, {len(blocked_tasks)} blocked"
        )
        return schedulable_tasks, blocked_tasks

    def _analyze_constraints(
        self, context: WeeklyPlanContext, constraints: WeeklyConstraints
    ) -> dict[str, Any]:
        """Analyze current constraints and workload."""
        total_task_hours = sum(
            getattr(task, "remaining_hours", float(task.estimate_hours or 0))
            for task in context.tasks
        )
        available_hours = (
            constraints.total_capacity_hours - constraints.meeting_buffer_hours
        )

        # Count urgent tasks (due within week)
        week_start_dt = datetime.combine(context.week_start_date, datetime.min.time())
        week_end_dt = week_start_dt + timedelta(days=7)
        urgent_tasks = []
        for task in context.tasks:
            if task.due_date:
                # Ensure we have a datetime object for comparison
                if hasattr(task.due_date, "hour"):
                    # It's a datetime object
                    task_due_dt = task.due_date
                else:
                    # It's a date object, convert to datetime
                    task_due_dt = datetime.combine(task.due_date, datetime.min.time())

                if task_due_dt <= week_end_dt:
                    urgent_tasks.append(task)

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

            week_start_dt = datetime.combine(
                context.week_start_date, datetime.min.time()
            )
            week_end_dt = week_start_dt + timedelta(days=7)
            urgent_count = 0
            for task in project_tasks:
                if task.due_date:
                    # Ensure we have a datetime object for comparison
                    if hasattr(task.due_date, "hour"):
                        # It's a datetime object
                        task_due_dt = task.due_date
                    else:
                        # It's a date object, convert to datetime
                        task_due_dt = datetime.combine(
                            task.due_date, datetime.min.time()
                        )

                    if task_due_dt <= week_end_dt:
                        urgent_count += 1
            total_hours = sum(
                getattr(task, "remaining_hours", float(task.estimate_hours or 0))
                for task in project_tasks
            )

            priority_score = urgent_count * 2.0 + total_hours * 0.1
            project_priorities[project.id] = priority_score

        # Normalize priorities
        total_priority = sum(project_priorities.values())
        if total_priority == 0:
            # Equal allocation if no priorities
            base_hours = float(available_hours) / project_count
            return [
                ProjectAllocation(
                    project_id=str(project.id),
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
                    project_id=str(project.id),
                    project_title=project.title,
                    target_hours=target_hours,
                    max_hours=target_hours * 1.5,
                    priority_weight=priority_ratio,
                )
            )

        return allocations

    async def _generate_ai_task_selection_responses(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, Any]:
        """Generate AI-powered task selection using GPT-5 Responses API."""
        try:
            solver_context = self._create_solver_context(
                context, constraints, project_allocations
            )

            # Try Responses API first, fallback to Chat Completions if not available
            try:
                # Use new Responses API with GPT-5
                # Note: GPT-5 Responses API only supports default temperature (1.0)
                response = self.openai_client.responses.create(
                    model=self.model,
                    input=solver_context,
                    tools=self._get_solver_tools_definitions(),
                )
            except (AttributeError, APIError) as e:
                # Responses API not available, fallback to Chat Completions
                logger.warning(
                    f"Responses API not available: {e}, falling back to Chat Completions"
                )
                return self._fallback_to_chat_completions(
                    context, solver_context, constraints, project_allocations
                )

            # Parse Responses API output
            return self._parse_responses_solver_output(response, context)

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
        scored_items = []

        # Process regular tasks
        for task in context.tasks:
            # Calculate priority score
            urgency_score = 0
            if task.due_date is not None:
                try:
                    # Convert context.week_start_date to datetime for comparison
                    week_start_dt = datetime.combine(
                        context.week_start_date, datetime.min.time()
                    )
                    task_due_dt = datetime.combine(task.due_date, datetime.min.time())
                    days_until_due = (task_due_dt - week_start_dt).days
                    if days_until_due <= 7:
                        urgency_score = max(
                            0, 10 - days_until_due
                        )  # Ensure non-negative
                except (TypeError, ValueError) as e:
                    logger.warning(
                        f"Invalid due_date for task {task.id}: {task.due_date}, error: {e}"
                    )
                    urgency_score = 0

            effort_score = 10 - min(
                float(task.estimate_hours or 0), 10
            )  # Prefer smaller tasks

            total_score = (
                urgency_score * constraints.deadline_weight
                + effort_score * constraints.effort_efficiency_weight
            )
            scored_items.append((task, total_score, "regular_task"))

        # Process selected weekly recurring tasks
        if context.selected_recurring_task_ids:
            for weekly_task in context.weekly_recurring_tasks:
                if str(weekly_task.id) in context.selected_recurring_task_ids:
                    # Weekly recurring tasks get high priority to ensure they are included
                    recurring_score = 8.0  # High priority for consistency
                    effort_score = 10 - min(float(weekly_task.estimate_hours or 0), 10)
                    total_score = (
                        recurring_score * 0.7  # High weight for weekly consistency
                        + effort_score * constraints.effort_efficiency_weight
                    )
                    scored_items.append((weekly_task, total_score, "weekly_recurring"))

        # Sort by score descending
        scored_items.sort(key=lambda x: x[1], reverse=True)

        # Select items within capacity
        total_hours = 0.0
        for item, score, item_type in scored_items:
            item_hours = getattr(
                item, "remaining_hours", float(item.estimate_hours or 0)
            )
            if total_hours + item_hours <= constraints.total_capacity_hours:
                if item_type == "regular_task":
                    selected_tasks.append(
                        TaskPlan(
                            task_id=str(item.id),
                            task_title=item.title,
                            estimated_hours=item_hours,
                            priority=int(score),
                            rationale=f"Selected based on heuristic score: {score:.1f}",
                        )
                    )
                elif item_type == "weekly_recurring":
                    selected_tasks.append(
                        TaskPlan(
                            task_id=str(item.id),
                            task_title=f"[週課] {item.title}",
                            estimated_hours=item_hours,
                            priority=int(score),
                            rationale=f"Weekly recurring task selected with score: {score:.1f}",
                        )
                    )
                total_hours += item_hours

        return selected_tasks, insights

    def _create_solver_context(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> str:
        """Create context input for Responses API task solver."""
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
                "estimate_hours": getattr(
                    t, "remaining_hours", float(t.estimate_hours or 0)
                ),
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "status": t.status,
                "goal_id": t.goal_id,
            }
            for t in context.tasks
        ]

        # Add selected weekly recurring tasks to the available tasks
        selected_recurring_tasks_data = []
        if context.selected_recurring_task_ids:
            for rt in context.weekly_recurring_tasks:
                if str(rt.id) in context.selected_recurring_task_ids:
                    selected_recurring_tasks_data.append(
                        {
                            "id": rt.id,
                            "title": f"[週課] {rt.title}",
                            "description": rt.description,
                            "estimate_hours": rt.estimate_hours,
                            "due_date": None,  # Weekly recurring tasks don't have specific due dates
                            "status": "weekly_recurring",
                            "category": rt.category,
                        }
                    )

        # Combine regular tasks and selected weekly recurring tasks
        all_available_tasks = tasks_data + selected_recurring_tasks_data

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

        return f"""週間タスクの最適選択と配分を実行してください。

あなたは週間計画に特化した高度なAIタスク配分最適化エージェントです。

## ユーザー情報
- ユーザーID: {context.user_id}
- 週開始日: {context.week_start_date.strftime("%Y-%m-%d")}
- 総容量: {constraints.total_capacity_hours} 時間
- タスク用利用可能時間: {constraints.total_capacity_hours - constraints.meeting_buffer_hours} 時間

## プロジェクト情報
{json.dumps(projects_data, indent=2, ensure_ascii=False)}

## 利用可能タスク（通常タスク + 選択された週課）
{json.dumps(all_available_tasks, indent=2, ensure_ascii=False)}

## プロジェクト配分
{json.dumps(allocations_data, indent=2, ensure_ascii=False)}

## 制約条件
- 日次最大: {constraints.daily_max_hours} 時間
- 必要ディープワークブロック: {constraints.deep_work_blocks} 回/日
- ミーティングバッファ: {constraints.meeting_buffer_hours} 時間
- 締切重み: {constraints.deadline_weight}
- プロジェクトバランス重み: {constraints.project_balance_weight}
- 工数効率重み: {constraints.effort_efficiency_weight}

## 重要な制約
**必ず「利用可能タスク」セクションに記載されているID（通常タスクIDまたは週課ID）のみを選択してください。**
上記の一覧に存在しないIDは使用しないでください。

注意: 週課（status="weekly_recurring"）は週間反復タスクです。これらも通常のタスクと同様に選択し、週間スケジュールに含めてください。

## 最適化要件
以下の要素を考慮して最適なタスクを選択してください：

1. 締切の緊急度とビジネスインパクト
2. タスク依存関係とブロック関係
3. 認知負荷とコンテキストスイッチングコスト
4. プロジェクトの戦略的重要度とリソース配分
5. 週課（週間反復タスク）の確実な実行

締切、プロジェクトバランス、容量制約を考慮して最適なタスクを選択し、作業負荷最適化とタスク優先順位について戦略的な洞察を提供してください。

注意：日ごとの詳細なスケジューリング（何曜日の何時にタスクを実行するか）は別のシステムで行うため、タスクの選択と優先順位付けに集中してください。

solve_weekly_tasks関数を使用して構造化された結果を返してください。"""

    def _get_solver_tools_definitions(self) -> list[dict[str, Any]]:
        """Get tools definitions for AI task solver."""
        return [
            {
                "type": "function",
                "function": {
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
                                        "rationale": {"type": "string"},
                                    },
                                    "required": [
                                        "task_id",
                                        "estimated_hours",
                                        "priority",
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
                },
            }
        ]

    def _parse_solver_response(
        self, function_call, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """Parse AI solver response."""
        try:
            function_args = json.loads(function_call.arguments)
            return self._create_solver_response(function_args, context)

        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Error parsing solver response: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"Response parse error: {str(e)}"],
            }

    def _parse_responses_solver_output(
        self, response, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """Parse Responses API output for task solver"""
        try:
            # Handle different possible response formats
            if hasattr(response, "tool_calls") and response.tool_calls:
                # Tool was called
                tool_call = response.tool_calls[0]
                if tool_call.function.name == "solve_weekly_tasks":
                    function_args = json.loads(tool_call.function.arguments)
                    return self._create_solver_response(function_args, context)
                else:
                    # Unexpected tool call
                    return {
                        "selected_tasks": [],
                        "insights": [
                            f"Unexpected tool call: {tool_call.function.name}"
                        ],
                    }

            # Check for output_text or similar attributes
            elif hasattr(response, "output_text"):
                # Try to parse structured output from text
                return self._parse_solver_text_output(response.output_text, context)

            # Fallback: treat entire response as text and try to extract JSON
            else:
                response_text = str(response)
                return self._parse_solver_text_output(response_text, context)

        except Exception as e:
            logger.error(f"Error parsing Responses API solver output: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"ソルバーレスポンス解析エラー: {str(e)}"],
            }

    def _create_solver_response(
        self, function_args: dict, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """
        Create solver response from function arguments with task filtering.

        This method processes AI-generated task plans and filters out any task IDs
        that don't exist in the database context. Only valid tasks are included
        in the final response to prevent "Unknown Task" entries.

        Args:
            function_args: Dictionary containing task_plans, insights, and allocation_analysis
            context: Weekly plan context with available tasks for validation

        Returns:
            Dictionary with filtered selected_tasks, insights, and allocation_analysis
        """
        # Use shared utility function for task filtering
        selected_tasks, skipped_tasks = filter_valid_tasks(
            function_args.get("task_plans", []), context, "weekly solver"
        )

        return {
            "selected_tasks": selected_tasks,
            "insights": function_args.get("insights", []),
            "allocation_analysis": function_args.get("allocation_analysis", {}),
        }

    def _parse_solver_text_output(
        self, output_text: str, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """Parse structured output from text response"""
        try:
            # Look for JSON in the response
            json_match = re.search(r"\{.*\}", output_text, re.DOTALL)
            if json_match is not None:
                json_data = json.loads(json_match.group())
                return self._create_solver_response(json_data, context)
            else:
                # If no structured data, return basic response
                return {
                    "selected_tasks": [],
                    "insights": [
                        output_text[:200] + "..."
                        if len(output_text) > 200
                        else output_text
                    ],
                    "allocation_analysis": {},
                }
        except Exception as e:
            logger.error(f"Error parsing solver text output: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"テキストレスポンス解析エラー: {str(e)}"],
            }

    def _calculate_solver_metrics(
        self,
        selected_tasks: list[TaskPlan],
        project_allocations: list[ProjectAllocation],
        constraints: WeeklyConstraints,
        context: WeeklyPlanContext,
    ) -> dict[str, Any]:
        """Calculate solver performance metrics."""
        total_allocated = sum(task.estimated_hours for task in selected_tasks)
        capacity_utilization = total_allocated / constraints.total_capacity_hours

        # Calculate project balance score using actual project mapping
        project_hours = {}

        # Build task to project mapping
        task_to_project = {}
        for task in context.tasks:
            for goal in context.goals:
                if goal.id == task.goal_id:
                    task_to_project[task.id] = goal.project_id
                    break

        # Calculate actual project hours distribution
        for task in selected_tasks:
            project_id = task_to_project.get(task.task_id, "unassigned")
            project_hours[project_id] = (
                project_hours.get(project_id, 0) + task.estimated_hours
            )

        # Calculate balance score based on how evenly distributed hours are
        # Perfect balance score = 1.0, completely unbalanced = 0.0
        if len(project_hours) <= 1:
            balance_score = 1.0 if len(project_hours) == 1 else 0.0
        else:
            total_project_hours = sum(project_hours.values())
            if total_project_hours > 0:
                # Calculate variance in distribution
                expected_hours_per_project = total_project_hours / len(project_hours)
                variance = sum(
                    (hours - expected_hours_per_project) ** 2
                    for hours in project_hours.values()
                ) / len(project_hours)
                # Convert variance to balance score (0-1 scale)
                balance_score = max(
                    0.0, 1.0 - (variance / (expected_hours_per_project**2))
                )
            else:
                balance_score = 1.0

        return {
            "capacity_utilization": capacity_utilization,
            "project_balance_score": balance_score,
            "task_count": len(selected_tasks),
            "avg_task_hours": total_allocated / len(selected_tasks)
            if selected_tasks
            else 0,
            "projects_involved": len(project_hours),
            "project_distribution": project_hours,
        }

    def _fallback_to_chat_completions(
        self,
        context: WeeklyPlanContext,
        solver_context: str,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
    ) -> dict[str, Any]:
        """Fallback to Chat Completions API when Responses API is not available"""
        try:
            logger.info(
                f"Using Chat Completions fallback for task solver with model {self.model}"
            )

            # Prepare API parameters for Chat Completions
            api_params = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "あなたは週間タスク最適化の専門家です。与えられた制約とプロジェクト情報に基づいて最適なタスク選択を行ってください。",
                    },
                    {"role": "user", "content": solver_context},
                ],
                "tools": self._get_solver_tools_definitions(),
                "tool_choice": "auto",
                "max_completion_tokens": 2000,
            }

            # GPT-5 models only support default temperature (1.0)
            if not self.model.startswith("gpt-5"):
                api_params["temperature"] = (
                    0.3  # Lower temperature for consistent optimization
                )

            response = self.openai_client.chat.completions.create(**api_params)

            # Parse Chat Completions response
            return self._parse_chat_completions_solver_response(response, context)

        except Exception as e:
            logger.error(f"Chat Completions fallback failed for task solver: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"ソルバーフォールバックエラー: {str(e)}"],
            }

    def _parse_chat_completions_solver_response(
        self, response, context: WeeklyPlanContext
    ) -> dict[str, Any]:
        """Parse Chat Completions API response for task solver"""
        try:
            message = response.choices[0].message

            if message.tool_calls:
                # Tool was called
                tool_call = message.tool_calls[0]
                if tool_call.function.name == "solve_weekly_tasks":
                    function_args = json.loads(tool_call.function.arguments)
                    return self._create_solver_response(function_args, context)
                else:
                    return {
                        "selected_tasks": [],
                        "insights": [
                            f"予期しないツール呼び出し: {tool_call.function.name}"
                        ],
                    }
            else:
                # No tool call, try to parse text content
                if message.content:
                    return self._parse_solver_text_output(message.content, context)
                else:
                    return {
                        "selected_tasks": [],
                        "insights": ["AIからの応答が空でした。"],
                    }

        except Exception as e:
            logger.error(f"Error parsing Chat Completions solver response: {e}")
            return {
                "selected_tasks": [],
                "insights": [f"ソルバー応答解析エラー: {str(e)}"],
            }

    async def _optimize_with_ortools(
        self,
        context: WeeklyPlanContext,
        constraints: WeeklyConstraints,
        project_allocations: list[ProjectAllocation],
        task_priorities: dict[str, float],
        user_prompt: str | None,
    ) -> tuple[list[TaskPlan], list[str]]:
        """
        Apply OR-Tools constraint optimization with extracted priorities.

        This method implements the second stage of the two-stage optimization:
        1. Uses task priorities from OpenAI API
        2. Applies OR-Tools CP-SAT solver for resource allocation
        """
        try:
            from ortools.sat.python import cp_model

            # Create CP-SAT model
            model = cp_model.CpModel()
            solver = cp_model.CpSolver()

            # Decision variables: whether to select each task
            task_vars = {}
            task_hours = {}
            task_priority_scores = {}

            for task in context.tasks:
                task_id = str(task.id)
                task_vars[task_id] = model.NewBoolVar(f"task_{task_id}")
                task_hours[task_id] = getattr(
                    task, "remaining_hours", float(task.estimate_hours or 0)
                )
                task_priority_scores[task_id] = task_priorities.get(task_id, 5.0)

            # Add selected weekly recurring tasks
            weekly_task_vars = {}
            weekly_task_hours = {}
            weekly_task_priorities = {}

            if context.selected_recurring_task_ids:
                for weekly_task in context.weekly_recurring_tasks:
                    if str(weekly_task.id) in context.selected_recurring_task_ids:
                        task_id = f"weekly_{weekly_task.id}"
                        weekly_task_vars[task_id] = model.NewBoolVar(
                            f"weekly_{task_id}"
                        )
                        weekly_task_hours[task_id] = float(
                            weekly_task.estimate_hours or 0
                        )
                        weekly_task_priorities[task_id] = (
                            8.0  # High priority for weekly tasks
                        )

            # Constraint 1: Total capacity constraint
            total_hours_expr = []
            for task_id, var in task_vars.items():
                total_hours_expr.append(
                    var * int(task_hours[task_id] * 10)
                )  # Scale for integer
            for task_id, var in weekly_task_vars.items():
                total_hours_expr.append(var * int(weekly_task_hours[task_id] * 10))

            model.Add(
                sum(total_hours_expr) <= int(constraints.total_capacity_hours * 10)
            )

            # Constraint 2: Project allocation constraints
            for allocation in project_allocations:
                project_tasks = []
                project_goal_ids = [
                    goal.id
                    for goal in context.goals
                    if goal.project_id == allocation.project_id
                ]

                for task in context.tasks:
                    if task.goal_id in project_goal_ids:
                        task_id = str(task.id)
                        if task_id in task_vars:
                            project_tasks.append(
                                task_vars[task_id] * int(task_hours[task_id] * 10)
                            )

                if project_tasks:
                    # Calculate available task hours for this project
                    available_task_hours = sum(
                        task_hours[str(task.id)]
                        for task in context.tasks
                        if task.goal_id in project_goal_ids
                        and str(task.id) in task_hours
                    )

                    # Skip constraint if target_hours is 0 (0% allocation)
                    if (
                        allocation.target_hours <= 0.001
                    ):  # Use small epsilon for float comparison
                        # For 0% allocation, explicitly set maximum to 0
                        if len(project_tasks) > 0:
                            model.Add(sum(project_tasks) <= 0)
                            logger.debug(
                                f"Applied 0% allocation constraint for project {allocation.project_id}"
                            )
                    else:
                        # Strict allocation constraints: 0.9-1.1x target hours range
                        # But ensure feasibility when available task hours are limited

                        # Ideal range: 90%-110% of target hours
                        ideal_min_hours = int(allocation.target_hours * 0.9 * 10)
                        ideal_max_hours = int(allocation.target_hours * 1.1 * 10)

                        # Adjust constraints based on available task hours
                        if available_task_hours * 10 < ideal_min_hours:
                            # Not enough tasks available - use all available hours
                            hard_min_hours = int(available_task_hours * 10)
                            max_hours = int(available_task_hours * 10)
                        else:
                            # Sufficient tasks available - enforce strict 0.9-1.1x range
                            hard_min_hours = ideal_min_hours
                            max_hours = min(
                                ideal_max_hours, int(available_task_hours * 10)
                            )

                        if len(project_tasks) > 0 and max_hours > 0:
                            model.Add(sum(project_tasks) >= hard_min_hours)
                            model.Add(sum(project_tasks) <= max_hours)
                            # Determine constraint type for logging
                            constraint_type = (
                                "strict 0.9-1.1x"
                                if available_task_hours * 10 >= ideal_min_hours
                                else "limited by available tasks"
                            )
                            logger.debug(
                                f"Applied {constraint_type} allocation constraint for project {allocation.project_id}: "
                                f"{hard_min_hours / 10:.1f}h - {max_hours / 10:.1f}h "
                                f"(target: {allocation.target_hours:.1f}h, available: {available_task_hours:.1f}h)"
                            )

            # Constraint 3: Task dependency ordering constraints
            # Note: Dependency constraints are applied during task filtering in _collect_solver_context
            # The tasks passed to this optimization function are already filtered to satisfy dependencies

            # Constraint 4: Prefer high-priority tasks
            priority_expr = []

            # Add task priority weights
            for task_id, var in task_vars.items():
                base_priority = int(task_priority_scores[task_id] * 100)

                # Boost priority for tasks that align with project allocation preferences
                project_allocation_bonus = 0
                task = next((t for t in context.tasks if str(t.id) == task_id), None)
                if task:
                    goal = next(
                        (g for g in context.goals if g.id == task.goal_id), None
                    )
                    if goal:
                        # Find matching project allocation
                        allocation = next(
                            (
                                a
                                for a in project_allocations
                                if a.project_id == goal.project_id
                            ),
                            None,
                        )
                        if allocation:
                            # Boost based on project priority weight (0-100 scale)
                            project_allocation_bonus = int(
                                allocation.priority_weight * 50
                            )

                total_priority = base_priority + project_allocation_bonus
                priority_expr.append(var * total_priority)

            # Add weekly task priorities (no project allocation bonus)
            for task_id, var in weekly_task_vars.items():
                priority_weight = int(weekly_task_priorities[task_id] * 100)
                priority_expr.append(var * priority_weight)

            # Objective: Maximize priority-weighted task selection
            model.Maximize(sum(priority_expr))

            # Solve the optimization problem
            solver.parameters.max_time_in_seconds = 30.0  # Timeout after 30 seconds

            status = solver.Solve(model)

            # Process results
            selected_tasks = []
            insights = []

            if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
                # Extract selected regular tasks
                for task in context.tasks:
                    task_id = str(task.id)
                    if task_id in task_vars and solver.Value(task_vars[task_id]) == 1:
                        selected_tasks.append(
                            TaskPlan(
                                task_id=task_id,
                                task_title=task.title,
                                estimated_hours=task_hours[task_id],
                                priority=int(task_priority_scores[task_id]),
                                rationale=f"OR-Tools最適化で選択 (優先度: {task_priority_scores[task_id]:.1f})",
                            )
                        )

                # Extract selected weekly recurring tasks
                for weekly_task in context.weekly_recurring_tasks:
                    task_id = f"weekly_{weekly_task.id}"
                    if (
                        task_id in weekly_task_vars
                        and solver.Value(weekly_task_vars[task_id]) == 1
                    ):
                        selected_tasks.append(
                            TaskPlan(
                                task_id=str(weekly_task.id),
                                task_title=f"[週課] {weekly_task.title}",
                                estimated_hours=weekly_task_hours[task_id],
                                priority=int(weekly_task_priorities[task_id]),
                                rationale="週間反復タスクとしてOR-Tools最適化で選択",
                            )
                        )

                # Generate insights
                total_selected_hours = sum(
                    task.estimated_hours for task in selected_tasks
                )
                capacity_utilization = (
                    total_selected_hours / constraints.total_capacity_hours
                )

                insights = [
                    "🔧 OR-Tools制約ソルバーによる最適化完了",
                    f"📊 選択タスク数: {len(selected_tasks)}個",
                    f"⏱️ 総工数: {total_selected_hours:.1f}時間 (容量利用率: {capacity_utilization:.1%})",
                    f"🎯 最適化ステータス: {'最適解' if status == cp_model.OPTIMAL else '実行可能解'}",
                ]

                if user_prompt:
                    insights.append(
                        f"💬 ユーザー指示「{user_prompt}」を優先度計算に反映"
                    )

                # Analyze project distribution
                project_distribution: dict[str, float] = {}
                for task_plan in selected_tasks:
                    # Find project for this task
                    db_task = next(
                        (t for t in context.tasks if str(t.id) == task_plan.task_id),
                        None,
                    )
                    if db_task:
                        goal = next(
                            (g for g in context.goals if g.id == db_task.goal_id), None
                        )
                        if goal:
                            project = next(
                                (
                                    p
                                    for p in context.projects
                                    if p.id == goal.project_id
                                ),
                                None,
                            )
                            if project:
                                project_title = project.title
                                project_distribution[project_title] = (
                                    project_distribution.get(project_title, 0)
                                    + task_plan.estimated_hours
                                )

                if project_distribution:
                    insights.append("📈 プロジェクト別配分:")
                    for project_title, hours in project_distribution.items():
                        insights.append(f"  • {project_title}: {hours:.1f}時間")

            else:
                # Optimization failed - use fallback
                logger.warning("OR-Tools optimization failed, using fallback heuristic")

                insights = [
                    "⚠️ OR-Tools最適化が制約を満たす解を見つけられませんでした",
                    "🔄 ヒューリスティック手法にフォールバック中...",
                ]
                selected_tasks, fallback_insights = self._heuristic_task_selection(
                    context, constraints, project_allocations
                )
                insights.extend(fallback_insights)

            return selected_tasks, insights

        except ImportError:
            logger.warning(
                "OR-Tools not available, falling back to heuristic selection"
            )
            insights = [
                "⚠️ OR-Toolsライブラリが利用できません",
                "🔄 ヒューリスティック手法を使用しています",
            ]
            selected_tasks, fallback_insights = self._heuristic_task_selection(
                context, constraints, project_allocations
            )
            return selected_tasks, insights + fallback_insights

        except Exception as e:
            logger.error(f"OR-Tools optimization failed: {e}")
            insights = [
                f"❌ OR-Tools最適化エラー: {str(e)}",
                "🔄 ヒューリスティック手法にフォールバック",
            ]
            selected_tasks, fallback_insights = self._heuristic_task_selection(
                context, constraints, project_allocations
            )
            return selected_tasks, insights + fallback_insights
