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
    Filter task plans to include only valid tasks and weekly recurring tasks that exist in the database context.

    This function validates task IDs against the available tasks and weekly recurring tasks in the 
    weekly plan context and creates TaskPlan objects only for valid items. Unknown or invalid IDs are
    logged and excluded from the results.

    Args:
        plans: List of task plan dictionaries from AI response
        context: Weekly plan context containing available tasks and weekly recurring tasks
        context_label: Label for logging context (e.g., "weekly solver", "openai client")

    Returns:
        Tuple of (valid_task_plans, skipped_task_ids)
        - valid_task_plans: List of TaskPlan objects for valid tasks and weekly recurring tasks
        - skipped_task_ids: List of IDs that were skipped due to not being found

    Example:
        >>> plans = [{"task_id": "valid-task-id", "estimated_hours": 2.0, ...},
        ...          {"task_id": "valid-recurring-id", "estimated_hours": 1.0, ...},
        ...          {"task_id": "invalid-id", "estimated_hours": 1.0, ...}]
        >>> valid_tasks, skipped = filter_valid_tasks(plans, context)
        >>> len(valid_tasks), len(skipped)
        (2, 1)
    """
    selected_tasks = []
    skipped_tasks = []

    for plan in plans:
        plan_id = str(plan["task_id"])
        
        # First, try to find matching task in context.tasks
        task = next(
            (t for t in context.tasks if str(t.id) == plan_id),
            None,
        )

        if task is not None:
            # Create TaskPlan for valid regular task
            task_plan = TaskPlan(
                task_id=plan_id,
                task_title=task.title,
                estimated_hours=plan["estimated_hours"],
                priority=plan["priority"],
                rationale=plan["rationale"],
            )
            selected_tasks.append(task_plan)
            continue

        # If not found in regular tasks, try to find in weekly recurring tasks
        weekly_task = next(
            (wt for wt in context.weekly_recurring_tasks if str(wt.id) == plan_id),
            None,
        )

        if weekly_task is not None:
            # Create TaskPlan for valid weekly recurring task
            task_plan = TaskPlan(
                task_id=plan_id,
                task_title=f"[週課] {weekly_task.title}",  # Add prefix to distinguish
                estimated_hours=plan["estimated_hours"],
                priority=plan["priority"],
                rationale=plan["rationale"],
            )
            selected_tasks.append(task_plan)
            continue

        # If not found in either, skip and log
        skipped_tasks.append(plan_id)
        logger.warning(
            f"Skipping unknown ID: {plan_id} - not found in task or weekly recurring task database "
            f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
            f"context: {context_label})"
        )

    # Log summary of filtered results with context
    logger.info(
        f"Task filtering results: {len(selected_tasks)} valid items selected, "
        f"{len(skipped_tasks)} unknown IDs skipped "
        f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
        f"context: {context_label})"
    )

    if skipped_tasks:
        logger.warning(
            f"Skipped IDs: {skipped_tasks} "
            f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')}, "
            f"context: {context_label})"
        )

    return selected_tasks, skipped_tasks
