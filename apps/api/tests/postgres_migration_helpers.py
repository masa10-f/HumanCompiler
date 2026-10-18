# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Shared helpers for tests that run SQL migrations against PostgreSQL."""

from pathlib import Path

from humancompiler_api.migration_manager import MigrationManager


def migration_statements(name: str) -> list[str]:
    path = Path(__file__).parents[1] / "migrations" / name
    manager = MigrationManager.__new__(MigrationManager)
    return manager._split_sql_statements(path.read_text())


def run_migration(cursor, schema: str, name: str) -> None:
    for statement in migration_statements(name):
        cursor.execute(statement.replace("public.", f'"{schema}".'))


def create_supabase_objects(cursor) -> None:
    # Only create what is missing, so a Supabase database keeps its own definitions.
    cursor.execute(
        """
        DO $$
        BEGIN
            IF to_regrole('anon') IS NULL THEN
                CREATE ROLE anon NOLOGIN;
            END IF;
            IF to_regrole('authenticated') IS NULL THEN
                CREATE ROLE authenticated NOLOGIN;
            END IF;
        END $$
        """
    )
    cursor.execute("CREATE SCHEMA IF NOT EXISTS auth")
    cursor.execute(
        """
        DO $$
        BEGIN
            IF to_regprocedure('auth.uid()') IS NULL THEN
                CREATE FUNCTION auth.uid() RETURNS uuid
                    LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
            END IF;
        END $$
        """
    )
