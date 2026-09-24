from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session

from humancompiler_api.config import settings
from humancompiler_api.migration_manager import MigrationManager


def _use_sqlite_database(tmp_path):
    settings.database_url = f"sqlite:///{tmp_path / 'migration-test.db'}"


def test_apply_migration_records_version_with_bound_params(tmp_path):
    _use_sqlite_database(tmp_path)
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    migration_file = migrations_dir / "001_noop.sql"
    migration_file.write_text(
        "-- Description: No-op migration for manager tests\nSELECT 1;\n"
    )
    manager = MigrationManager(str(migrations_dir))

    try:
        assert manager.apply_migration(migration_file) is True

        with Session(manager.engine) as session:
            row = session.exec(
                text(
                    "SELECT version, description FROM schema_migrations "
                    "WHERE version = '001_noop'"
                )
            ).one()

        assert row == ("001_noop", "No-op migration for manager tests")
    finally:
        manager.engine.dispose()


def test_baseline_existing_schema_marks_legacy_migrations(tmp_path):
    _use_sqlite_database(tmp_path)
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    (migrations_dir / "001_initial_schema.sql").write_text(
        "-- Description: Initial schema\nSELECT 1;\n"
    )
    (migrations_dir / "021_add_slot_templates.sql").write_text(
        "-- Description: Slot templates\nSELECT 1;\n"
    )
    (migrations_dir / "022_add_capacity_triage.sql").write_text(
        "-- Description: Capacity triage\nSELECT 1;\n"
    )
    manager = MigrationManager(str(migrations_dir))

    try:
        with Session(manager.engine) as session:
            session.exec(text("CREATE TABLE slot_templates (id TEXT PRIMARY KEY)"))
            session.commit()

        baselined = manager.baseline_existing_schema()
        pending = [version for version, _path in manager.get_pending_migrations()]

        assert baselined == ["001_initial_schema", "021_add_slot_templates"]
        assert pending == ["022_add_capacity_triage"]
    finally:
        manager.engine.dispose()


def test_daily_plan_policy_upgrade_is_pending_after_baselining_027(tmp_path):
    _use_sqlite_database(tmp_path)
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    real_migrations = Path(__file__).resolve().parents[1] / "migrations"
    for name in (
        "027_add_daily_plan_documents.sql",
        "028_scope_daily_plan_policy.sql",
        "028_scope_daily_plan_policy_rollback.sql",
    ):
        (migrations_dir / name).write_text((real_migrations / name).read_text())
    manager = MigrationManager(str(migrations_dir))
    try:
        with Session(manager.engine) as session:
            session.exec(
                text("CREATE TABLE daily_plan_documents (id TEXT PRIMARY KEY)")
            )
            session.commit()
        assert manager.baseline_existing_schema() == ["027_add_daily_plan_documents"]
        assert [version for version, _path in manager.get_pending_migrations()] == [
            "028_scope_daily_plan_policy"
        ]
        # Test discovery/splitting only; PostgreSQL RLS is not executed on SQLite.
        statements = manager._split_sql_statements(
            (migrations_dir / "028_scope_daily_plan_policy.sql").read_text()
        )
        assert len(statements) == 1
        assert "TO authenticated" in statements[0]
    finally:
        manager.engine.dispose()


def test_daily_notebook_search_migration_keeps_function_bodies_together():
    manager = MigrationManager.__new__(MigrationManager)
    path = (
        Path(__file__).resolve().parents[1] / "migrations/029_add_daily_plan_search.sql"
    )
    statements = manager._split_sql_statements(path.read_text())
    assert len(statements) == 5
    assert "CREATE FUNCTION public.daily_plan_search_text" in statements[1]
    assert "RETURN NEW;" in statements[2]
    assert "END;" in statements[2]
    assert "CREATE TRIGGER" in statements[3]
    assert "UPDATE public.daily_plan_documents" in statements[4]


def test_line_note_search_migrations_keep_function_body_together():
    manager = MigrationManager.__new__(MigrationManager)
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    for name in (
        "032_add_daily_plan_line_note_search.sql",
        "032_add_daily_plan_line_note_search_rollback.sql",
    ):
        statements = manager._split_sql_statements((migrations / name).read_text())
        assert len(statements) == 2
        assert "FUNCTION public.daily_plan_search_text" in statements[0]
        assert "WHERE line <> ''''" in statements[0]
        assert "UPDATE public.daily_plan_documents" in statements[1]
    upgrade = (migrations / "032_add_daily_plan_line_note_search.sql").read_text()
    assert "NULLIF(block->>''note'', '''')" in upgrade
