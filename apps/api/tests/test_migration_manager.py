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
