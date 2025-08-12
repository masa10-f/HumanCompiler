"""
OpenAI prompts and function definitions for AI services
"""

import json
from typing import Any

from taskagent_api.ai.models import WeeklyPlanContext


def get_function_definitions() -> list[dict[str, Any]]:
    """Get OpenAI tools definitions for task planning."""
    return [
        {
            "type": "function",
            "function": {
                "name": "create_week_plan",
                "description": (
                    "Create an optimal weekly plan for tasks based on user "
                    "context and preferences"
                ),
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
                                        "description": (
                                            "Task priority (1=highest, 5=lowest)"
                                        ),
                                    },
                                    "suggested_day": {
                                        "type": "string",
                                        "description": (
                                            "Suggested day of week (Monday, Tuesday, etc.)"
                                        ),
                                    },
                                    "suggested_time_slot": {
                                        "type": "string",
                                        "description": (
                                            "Suggested time slot "
                                            "(morning, afternoon, evening)"
                                        ),
                                    },
                                    "rationale": {
                                        "type": "string",
                                        "description": (
                                            "Reasoning for this scheduling decision"
                                        ),
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
                            "description": (
                                "Insights about workload and optimization opportunities"
                            ),
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["task_plans", "recommendations", "insights"],
                },
            },
        },
        {
            "type": "function",
            "function": {
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
                            "description": (
                                "Overall plan adjustments and recommendations"
                            ),
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["updated_tasks", "plan_adjustments"],
                },
            },
        },
    ]


def create_system_prompt() -> str:
    """Create system prompt for task planning assistant."""
    return """You are an expert task planning and productivity assistant specialized in research and development project management.
Your role is to help users create optimal weekly schedules that maximize productivity and goal achievement.

## Your Expertise:
- Deep work scheduling and time management
- Research project planning and milestone tracking
- Priority-based task organization
- Workload balancing and capacity planning
- Cognitive load optimization

## Planning Principles:
1. **Deep Work First**: Schedule complex, high-cognitive tasks (research, analysis, coding)
   during peak focus hours (typically mornings)
2. **Energy Management**: Match task difficulty to energy levels throughout the day
3. **Priority Optimization**: Focus on high-impact tasks that advance key project
   milestones
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
Always provide specific, actionable recommendations with clear rationale. Include insights
about workload distribution and optimization opportunities. Focus on helping the user
achieve their research and development goals efficiently.

When creating weekly plans, use the create_week_plan function. When updating existing
plans, use the update_plan function."""


def format_context_for_llm(context: WeeklyPlanContext) -> str:
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


def create_weekly_plan_user_message(context: WeeklyPlanContext) -> str:
    """Create user message for weekly plan generation."""
    context_text = format_context_for_llm(context)

    return f"""Please create an optimal weekly plan for the following context:

{context_text}

Focus on:
1. Prioritizing high-impact tasks that advance key goals
2. Scheduling deep work during optimal time slots
3. Balancing workload across the week
4. Considering due dates and dependencies
5. Providing specific scheduling recommendations

Use the create_week_plan function to structure your response."""
