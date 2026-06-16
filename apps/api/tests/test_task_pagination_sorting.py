from decimal import Decimal
from uuid import UUID

from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import SortBy, SortOrder, Task, TaskStatus, WorkType
from humancompiler_api.services import TaskService


def test_get_tasks_by_goal_has_stable_tiebreaker_across_pages(
    session: Session, test_user_id: str
):
    data = create_test_data(session, test_user_id)
    goal = data["goal"]
    task_service = TaskService()

    expected_ids = [UUID(int=index + 1) for index in range(120)]
    for index, task_id in enumerate(reversed(expected_ids)):
        session.add(
            Task(
                id=task_id,
                goal_id=goal.id,
                title=f"Task {index}",
                estimate_hours=Decimal("1.0"),
                status=TaskStatus.PENDING,
                work_type=WorkType.LIGHT_WORK,
                priority=3,
            )
        )
    session.flush()

    first_page = task_service.get_tasks_by_goal(
        session,
        goal.id,
        test_user_id,
        skip=0,
        limit=100,
        sort_by=SortBy.STATUS,
        sort_order=SortOrder.ASC,
    )
    second_page = task_service.get_tasks_by_goal(
        session,
        goal.id,
        test_user_id,
        skip=100,
        limit=100,
        sort_by=SortBy.STATUS,
        sort_order=SortOrder.ASC,
    )

    paged_ids = [task.id for task in [*first_page, *second_page]]
    assert paged_ids == expected_ids
    assert len(paged_ids) == len(set(paged_ids)) == 120
