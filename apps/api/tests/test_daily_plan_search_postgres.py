# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Run migrations 029/030/032 against an isolated PostgreSQL schema, including its trigger."""

import os
from pathlib import Path
from uuid import uuid4

import psycopg2
from psycopg2.extras import Json
import pytest

from humancompiler_api.migration_manager import MigrationManager
from humancompiler_api.routers.daily_plans import (
    DailyPlanDocumentV1,
    _document_search_text,
)

SEARCH_DOCUMENTS = [
    {"schema_version": 1, "blocks": []},
    {
        "schema_version": 1,
        "blocks": [
            {
                "id": "never-index-id",
                "type": "text",
                "text": "\n 調査 100%_完了\t",
                "content": {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "調査"}],
                },
            },
            {"id": "empty", "type": "text", "text": ""},
            {
                "id": "fixed",
                "type": "timed_line",
                "title": "会議",
                "start": "11:00",
                "end": "12:00",
            },
            {
                "id": "directive",
                "type": "schedule_directive",
                "mode": "filter",
                "title": "研究",
                "allowed_windows": [
                    {"start": "09:00", "end": "10:00"},
                    {"start": "13:00", "end": "14:00"},
                ],
            },
            {"id": "check", "type": "checklist_item", "title": "確認", "checked": True},
        ],
    },
    {"schema_version": 1, "blocks": [{"id": "space", "type": "text", "text": "   "}]},
    {
        "schema_version": 1,
        "blocks": [
            {"id": "whitespace", "type": "text", "text": "\t\n\r　\u00a0\u2009\x1c"}
        ],
    },
    {
        "schema_version": 1,
        "blocks": [
            {"id": "leading-break", "type": "text", "text": "\n買い物リスト\n牛乳"}
        ],
    },
    {
        "schema_version": 1,
        "blocks": [
            {
                "id": "fixed-note",
                "type": "timed_line",
                "title": "設計レビュー",
                "start": "10:00",
                "end": "11:00",
                "note": "認可の件は確認中\n次回 100%_対応　",
            },
            {
                "id": "directive-note",
                "type": "schedule_directive",
                "mode": "filter",
                "allowed_windows": [{"start": "13:00", "end": "14:00"}],
                "note": "午後は実装",
            },
            {
                "id": "blank-note",
                "type": "timed_line",
                "title": "休憩",
                "start": "12:00",
                "end": "13:00",
                "note": " \t",
            },
        ],
    },
]


def migration_statements(name: str) -> list[str]:
    path = Path(__file__).parents[1] / "migrations" / name
    manager = MigrationManager.__new__(MigrationManager)
    return manager._split_sql_statements(path.read_text())


@pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)
def test_postgres_search_trigger_matches_python_mirror_and_preserves_documents():
    # No production table is touched, even when running against an existing database.
    schema = f"notebook_test_{uuid4().hex}"
    connection = psycopg2.connect(os.environ["NOTEBOOK_TEST_POSTGRES_URL"])
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            cursor.execute(
                f'CREATE TABLE "{schema}".daily_plan_documents (id integer PRIMARY KEY, document_json jsonb NOT NULL)'
            )
            documents = [
                DailyPlanDocumentV1.model_validate(value) for value in SEARCH_DOCUMENTS
            ]
            for index, document in enumerate(documents):
                cursor.execute(
                    f'INSERT INTO "{schema}".daily_plan_documents VALUES (%s, %s)',
                    (index, Json(document.model_dump(mode="json"))),
                )
            for migration in (
                "029_add_daily_plan_search.sql",
                "030_trim_daily_plan_search.sql",
                "032_add_daily_plan_line_note_search.sql",
            ):
                for statement in migration_statements(migration):
                    cursor.execute(statement.replace("public.", f'"{schema}".'))
            cursor.execute(
                f'SELECT search_text FROM "{schema}".daily_plan_documents ORDER BY id'
            )
            assert [row[0] for row in cursor.fetchall()] == [
                _document_search_text(doc) for doc in documents
            ]
            # A deliberately incorrect application mirror is replaced by the authoritative trigger.
            document = documents[1].model_dump(mode="json")
            cursor.execute(
                f'UPDATE "{schema}".daily_plan_documents SET document_json=%s, search_text=%s WHERE id=0',
                (Json(document), "stale mirror"),
            )
            cursor.execute(
                f'SELECT search_text FROM "{schema}".daily_plan_documents WHERE id=0'
            )
            assert cursor.fetchone()[0] == _document_search_text(documents[1])
            # Older API versions don't send search_text at all.
            cursor.execute(
                f'INSERT INTO "{schema}".daily_plan_documents (id, document_json) VALUES (100, %s)',
                (Json(document),),
            )
            cursor.execute(
                f'SELECT search_text FROM "{schema}".daily_plan_documents WHERE id=100'
            )
            assert cursor.fetchone()[0] == _document_search_text(documents[1])
            for migration in (
                "032_add_daily_plan_line_note_search_rollback.sql",
                "030_trim_daily_plan_search_rollback.sql",
                "029_add_daily_plan_search_rollback.sql",
            ):
                for statement in migration_statements(migration):
                    cursor.execute(statement.replace("public.", f'"{schema}".'))
            cursor.execute(
                f'SELECT document_json FROM "{schema}".daily_plan_documents WHERE id=100'
            )
            assert cursor.fetchone()[0] == document
    finally:
        connection.rollback()
        connection.close()
