# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

from decimal import Decimal
from uuid import uuid4

import pytest
from sqlmodel import Session

from conftest import create_test_data
from humancompiler_api.models import Goal, GoalStatus, SortBy, SortOrder
from humancompiler_api.services import GoalService


@pytest.mark.parametrize(
    ("sort_order", "expected"),
    [
        (
            SortOrder.ASC,
            [
                GoalStatus.IN_PROGRESS,
                GoalStatus.PENDING,
                GoalStatus.PENDING,
                GoalStatus.COMPLETED,
                GoalStatus.CANCELLED,
            ],
        ),
        (
            SortOrder.DESC,
            [
                GoalStatus.CANCELLED,
                GoalStatus.COMPLETED,
                GoalStatus.PENDING,
                GoalStatus.PENDING,
                GoalStatus.IN_PROGRESS,
            ],
        ),
    ],
)
def test_status_sort_puts_in_progress_before_pending(
    session: Session,
    test_user_id: str,
    sort_order: SortOrder,
    expected: list[GoalStatus],
):
    data = create_test_data(session, test_user_id)
    project = data["project"]
    for status in (
        GoalStatus.COMPLETED,
        GoalStatus.CANCELLED,
        GoalStatus.IN_PROGRESS,
        GoalStatus.PENDING,
    ):
        session.add(
            Goal(
                id=uuid4(),
                project_id=project.id,
                title=f"{status.value} goal",
                estimate_hours=Decimal("1.0"),
                status=status,
            )
        )
    session.flush()

    goals = GoalService().get_goals_by_project(
        session,
        project.id,
        test_user_id,
        sort_by=SortBy.STATUS,
        sort_order=sort_order,
    )

    assert [goal.status for goal in goals] == expected
