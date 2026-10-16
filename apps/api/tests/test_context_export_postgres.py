# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Check the context export's daily plan pre-filter against PostgreSQL."""

import json
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session, col, select

from humancompiler_api.ai.context_export import (
    ContextExportOptions,
    _ContextExportBuilder,
)
from humancompiler_api.models import DailyPlanDocument


def _timed_line(title: str, task_ref_id: str) -> dict:
    return {
        "id": title,
        "type": "timed_line",
        "start": "09:00",
        "end": "10:00",
        "title": title,
        "task_ref": {"source": "task", "id": task_ref_id},
    }


@pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)
def test_postgres_daily_plan_filter_matches_task_ids_across_chunks():
    # No production table is touched, even when running against an existing database.
    schema = f"context_export_test_{uuid4().hex}"
    engine = create_engine(
        os.environ["NOTEBOOK_TEST_POSTGRES_URL"],
        connect_args={"options": f"-c search_path={schema}"},
    )
    owner_id = uuid4()
    task_id = uuid4()
    # More IDs than one regex chunk, with the referenced task in the second one.
    task_ids = [uuid4() for _ in range(150)]
    task_ids[120] = task_id
    documents = [
        (date(2026, 9, 1), {"blocks": [_timed_line("一致", str(task_id).upper())]}),
        (date(2026, 9, 2), {"blocks": [_timed_line("無関係", str(uuid4()))]}),
        # Mentions the task, so it is fetched, but the lenient scan skips it.
        (date(2026, 9, 3), {"blocks": "not-a-list", "note": str(task_id)}),
    ]
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(
                text(
                    f'CREATE TABLE "{schema}".daily_plan_documents ('
                    "id uuid PRIMARY KEY, user_id uuid NOT NULL, date date NOT NULL, "
                    "revision integer NOT NULL DEFAULT 1, document_json jsonb NOT NULL, "
                    "search_text text NOT NULL DEFAULT '', "
                    "created_at timestamptz, updated_at timestamptz)"
                )
            )
            for plan_date, document in documents:
                connection.execute(
                    text(
                        f'INSERT INTO "{schema}".daily_plan_documents '
                        "(id, user_id, date, document_json) "
                        "VALUES (:id, :user_id, :date, CAST(:document AS jsonb))"
                    ),
                    {
                        "id": uuid4(),
                        "user_id": owner_id,
                        "date": plan_date,
                        "document": json.dumps(document),
                    },
                )

        with Session(engine) as session:
            builder = _ContextExportBuilder(
                session,
                owner_id,
                ContextExportOptions(),
                datetime(2026, 9, 28, tzinfo=UTC),
            )
            fetched = session.exec(
                select(DailyPlanDocument.date)
                .where(builder._mentions_any_task([str(t) for t in task_ids]))
                .order_by(col(DailyPlanDocument.date))
            ).all()
            entries = builder._load_daily_plan_entries(task_ids)

        assert fetched == [date(2026, 9, 1), date(2026, 9, 3)]
        assert entries == {task_id: ["- 2026-09-01 09:00〜10:00 一致"]}
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()
