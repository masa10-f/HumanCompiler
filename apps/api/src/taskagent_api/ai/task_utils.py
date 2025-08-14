"""
Utility functions for AI task processing and filtering
"""

import logging
from typing import Any

from taskagent_api.ai.models import TaskPlan, WeeklyPlanContext

logger = logging.getLogger(__name__)


def filter_valid_tasks(
    plans: list[dict[str, Any]],
    context: WeeklyPlanContext,
    context_label: str = "task filtering",
) -> tuple[list[TaskPlan], list[str]]:
    """
    Filter task plans to include only valid tasks that exist in the database context.

    This function validates task IDs against the available tasks in the weekly plan context
    and creates TaskPlan objects only for valid tasks. Unknown or invalid task IDs are
    logged and excluded from the results.

    Args:
        plans: List of task plan dictionaries from AI response
        context: Weekly plan context containing available tasks
        context_label: Label for logging context (e.g., "weekly solver", "openai client")

    Returns:
        Tuple of (valid_task_plans, skipped_task_ids)
        - valid_task_plans: List of TaskPlan objects for valid tasks
        - skipped_task_ids: List of task IDs that were skipped due to not being found

    Example:
        >>> plans = [{"task_id": "valid-id", "estimated_hours": 2.0, ...},
        ...          {"task_id": "invalid-id", "estimated_hours": 1.0, ...}]
        >>> valid_tasks, skipped = filter_valid_tasks(plans, context)
        >>> len(valid_tasks), len(skipped)
        (1, 1)
    """
    selected_tasks = []
    skipped_tasks = []

    for plan in plans:
        # Find matching task in context
        task = next(
            (t for t in context.tasks if str(t.id) == str(plan["task_id"])),
            None,
        )

        if task is None:
            # Skip unknown tasks and log them with context
            skipped_tasks.append(plan["task_id"])
            logger.warning(
                f"Skipping unknown task ID: {plan['task_id']} - not found in task database "
                f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
                f"context: {context_label})"
            )
            continue

        # Create TaskPlan for valid task
        task_plan = TaskPlan(
            task_id=plan["task_id"],
            task_title=task.title,
            estimated_hours=plan["estimated_hours"],
            priority=plan["priority"],
            suggested_day=plan["suggested_day"],
            suggested_time_slot=plan["suggested_time_slot"],
            rationale=plan["rationale"],
        )
        selected_tasks.append(task_plan)

    # Log summary of filtered results with context
    logger.info(
        f"Task filtering results: {len(selected_tasks)} valid tasks selected, "
        f"{len(skipped_tasks)} unknown tasks skipped "
        f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
        f"context: {context_label})"
    )

    if skipped_tasks:
        logger.warning(
            f"Skipped task IDs: {skipped_tasks} "
            f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
            f"context: {context_label})"
        )

    return selected_tasks, skipped_tasks
