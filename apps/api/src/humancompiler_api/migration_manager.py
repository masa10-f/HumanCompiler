"""Database migration manager for TaskAgent"""

import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import Session, create_engine

from humancompiler_api.config import settings
from humancompiler_api.database_config import configure_database_extensions

logger = logging.getLogger(__name__)


class MigrationManager:
    """Manages database migrations with version tracking"""

    def __init__(self, migrations_dir: str = "migrations"):
        self.migrations_dir = Path(migrations_dir)
        self.engine = None
        self._init_engine()

    def _init_engine(self):
        """Initialize database engine"""
        configure_database_extensions()
        self.engine = create_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
        )

    def _ensure_migrations_table(self, session: Session):
        """Ensure migrations tracking table exists"""
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms INTEGER,
            checksum VARCHAR(64),
            description TEXT
        );
        """
        session.exec(text(create_table_sql))
        session.commit()

    def _get_applied_migrations(self, session: Session) -> list[str]:
        """Get list of already applied migrations"""
        self._ensure_migrations_table(session)
        result = session.exec(
            text("SELECT version FROM schema_migrations ORDER BY version")
        )
        return [row[0] for row in result]

    def _calculate_checksum(self, content: str) -> str:
        """Calculate checksum for migration content"""
        import hashlib

        return hashlib.sha256(content.encode()).hexdigest()

    def _extract_description(self, content: str) -> str:
        """Extract description from migration file comments"""
        for line in content.split("\n"):
            if line.strip().startswith("-- Description:"):
                return line.replace("-- Description:", "").strip()
        return ""

    def _migration_number(self, version: str) -> int | None:
        """Extract the leading numeric migration version."""
        prefix = version.split("_", 1)[0]
        try:
            return int(prefix)
        except ValueError:
            return None

    def _numbered_migration_files(self) -> list[Path]:
        """Return numbered migration files in stable application order."""
        if not self.migrations_dir.exists():
            logger.warning(f"Migrations directory {self.migrations_dir} does not exist")
            return []
        return sorted(
            [
                f
                for f in self.migrations_dir.glob("*.sql")
                if not f.name.endswith("_rollback.sql")
                and self._is_numbered_migration(f.name)
            ]
        )

    def _record_migration(
        self,
        session: Session,
        version: str,
        checksum: str,
        description: str,
        execution_time_ms: int,
    ) -> bool:
        """Record a migration if it has not already been tracked."""
        existing = session.execute(
            text("SELECT 1 FROM schema_migrations WHERE version = :version"),
            {"version": version},
        ).first()
        if existing:
            return False

        insert_sql = """
        INSERT INTO schema_migrations (version, execution_time_ms, checksum, description)
        VALUES (:version, :execution_time_ms, :checksum, :description)
        """
        session.execute(
            text(insert_sql),
            {
                "version": version,
                "execution_time_ms": execution_time_ms,
                "checksum": checksum,
                "description": description,
            },
        )
        return True

    def _split_sql_statements(self, sql_content: str) -> list[str]:
        """
        Split SQL content into individual statements, accounting for:
        - Strings (both single and double quoted)
        - Comments (both -- and /* */ style)
        - Semicolons within strings or comments
        - Proper escape sequence handling

        WARNING: While this implementation handles many cases, for production use with
        complex SQL files, consider using sqlparse library for more robust parsing:
        ```
        pip install sqlparse
        import sqlparse
        statements = sqlparse.split(sql_content)
        ```

        The current implementation is sufficient for most migration files but may not
        handle all edge cases like nested block comments or PostgreSQL-specific features.
        """
        statements = []
        current_statement = []
        in_single_quote = False
        in_double_quote = False
        in_line_comment = False
        in_block_comment = False
        i = 0

        while i < len(sql_content):
            char = sql_content[i]

            # Handle line comments
            if not in_single_quote and not in_double_quote and not in_block_comment:
                if (
                    char == "-"
                    and i + 1 < len(sql_content)
                    and sql_content[i + 1] == "-"
                ):
                    in_line_comment = True

            # Handle block comments
            if not in_single_quote and not in_double_quote and not in_line_comment:
                if (
                    char == "/"
                    and i + 1 < len(sql_content)
                    and sql_content[i + 1] == "*"
                ):
                    in_block_comment = True
                    current_statement.append(char)
                    i += 1
                    continue
                elif (
                    char == "*"
                    and i + 1 < len(sql_content)
                    and sql_content[i + 1] == "/"
                ):
                    in_block_comment = False
                    current_statement.append(char)
                    current_statement.append("/")
                    i += 2
                    continue

            # Handle string quotes - check for proper escaping
            if not in_line_comment and not in_block_comment:

                def count_preceding_backslashes(s, idx):
                    """Count consecutive backslashes preceding the given index"""
                    count = 0
                    j = idx - 1
                    while j >= 0 and s[j] == "\\":
                        count += 1
                        j -= 1
                    return count

                if char == "'" and count_preceding_backslashes(sql_content, i) % 2 == 0:
                    in_single_quote = not in_single_quote
                elif (
                    char == '"' and count_preceding_backslashes(sql_content, i) % 2 == 0
                ):
                    in_double_quote = not in_double_quote

            # Handle newlines (end line comments)
            if char == "\n":
                in_line_comment = False

            # Handle statement delimiter
            if (
                char == ";"
                and not in_single_quote
                and not in_double_quote
                and not in_line_comment
                and not in_block_comment
            ):
                # End of statement
                statement = "".join(current_statement).strip()
                if statement:
                    statements.append(statement)
                current_statement = []
            else:
                current_statement.append(char)

            i += 1

        # Add final statement if any
        final_statement = "".join(current_statement).strip()
        if final_statement:
            statements.append(final_statement)

        return statements

    def _is_numbered_migration(self, filename: str) -> bool:
        """Check if a migration file follows the numbered naming convention (NNN_*.sql)"""
        import re

        # Match files starting with 3 digits followed by underscore
        return bool(re.match(r"^\d{3}_", filename))

    def get_pending_migrations(self) -> list[tuple[str, Path]]:
        """Get list of pending migrations to apply"""
        migration_files = self._numbered_migration_files()

        # Get applied migrations
        with Session(self.engine) as session:
            applied = set(self._get_applied_migrations(session))

        # Return pending migrations
        pending = []
        for file_path in migration_files:
            version = file_path.stem
            if version not in applied:
                pending.append((version, file_path))

        return pending

    def apply_migration(self, file_path: Path) -> bool:
        """Apply a single migration file"""
        version = file_path.stem
        logger.info(f"Applying migration: {version}")

        try:
            # Read migration content
            content = file_path.read_text()
            checksum = self._calculate_checksum(content)
            description = self._extract_description(content)

            # Apply migration
            start_time = datetime.now()
            with Session(self.engine) as session:
                self._ensure_migrations_table(session)
                # Use transaction to ensure atomicity
                with session.begin():
                    # Execute migration statements using a more robust approach
                    # This splits SQL properly, accounting for strings and comments
                    statements = self._split_sql_statements(content)
                    for statement in statements:
                        if statement.strip():
                            session.exec(text(statement))

                    # Record migration within the same transaction
                    execution_time_ms = int(
                        (datetime.now() - start_time).total_seconds() * 1000
                    )

                    self._record_migration(
                        session=session,
                        version=version,
                        checksum=checksum,
                        description=description,
                        execution_time_ms=execution_time_ms,
                    )

            logger.info(
                f"✅ Migration {version} applied successfully in {execution_time_ms}ms"
            )
            return True

        except Exception as e:
            logger.error(f"❌ Failed to apply migration {version}: {e}")
            return False

    def apply_all_pending(self) -> tuple[int, int]:
        """Apply all pending migrations"""
        pending = self.get_pending_migrations()
        if not pending:
            logger.info("No pending migrations to apply")
            return 0, 0

        logger.info(f"Found {len(pending)} pending migrations")

        applied = 0
        failed = 0

        for _version, file_path in pending:
            if self.apply_migration(file_path):
                applied += 1
            else:
                failed += 1
                # Stop on first failure
                break

        return applied, failed

    def _has_table(self, table_name: str) -> bool:
        """Check whether a table exists, supporting PostgreSQL and SQLite tests."""
        inspector = inspect(self.engine)
        dialect = self.engine.dialect.name if self.engine else ""
        schemas: tuple[str | None, ...] = ("public", None)
        if dialect == "sqlite":
            schemas = (None,)

        for schema in schemas:
            try:
                table_exists = inspector.has_table(table_name, schema=schema)
            except Exception as exc:
                logger.debug(
                    "Could not inspect table %s in schema %s: %s",
                    table_name,
                    schema,
                    exc,
                )
                table_exists = False
            if table_exists:
                return True
        return False

    def _has_column(self, table_name: str, column_name: str) -> bool:
        """Check whether a column exists, supporting PostgreSQL and SQLite tests."""
        inspector = inspect(self.engine)
        dialect = self.engine.dialect.name if self.engine else ""
        schemas: tuple[str | None, ...] = ("public", None)
        if dialect == "sqlite":
            schemas = (None,)

        for schema in schemas:
            try:
                columns = inspector.get_columns(table_name, schema=schema)
            except Exception as exc:
                logger.debug(
                    "Could not inspect columns for table %s in schema %s: %s",
                    table_name,
                    schema,
                    exc,
                )
                columns = []
            if any(column["name"] == column_name for column in columns):
                return True
        return False

    def _detect_existing_schema_baseline_number(self) -> int | None:
        """Infer the newest already-present migration for legacy untracked DBs."""
        milestones: list[tuple[int, bool]] = [
            (21, self._has_table("slot_templates")),
            (20, self._has_column("work_sessions", "is_manual_execution")),
            (19, self._has_table("email_notification_logs")),
            (18, self._has_table("quick_tasks")),
            (17, self._has_table("context_notes")),
            (
                15,
                self._has_table("reschedule_suggestions")
                and self._has_table("reschedule_decisions"),
            ),
            (14, self._has_column("work_sessions", "total_paused_seconds")),
            (11, self._has_column("work_sessions", "snooze_count")),
            (10, self._has_table("push_subscriptions")),
            (9, self._has_column("projects", "status")),
            (8, self._has_column("tasks", "priority")),
            (7, self._has_table("work_sessions")),
            (5, self._has_table("weekly_schedules")),
            (4, self._has_table("task_dependencies")),
            (2, self._has_table("user_settings")),
            (
                1,
                self._has_table("projects")
                and self._has_table("goals")
                and self._has_table("tasks"),
            ),
        ]

        for migration_number, exists in milestones:
            if exists:
                return migration_number
        return None

    def baseline_existing_schema(self) -> list[str]:
        """Record already-present legacy schema migrations without executing them.

        Earlier deployments created and evolved the production schema manually, so
        some databases have the expected tables but an empty schema_migrations table.
        This method makes that state explicit before applying new migrations.
        """
        migration_files = self._numbered_migration_files()
        if not migration_files:
            return []

        with Session(self.engine) as session:
            self._ensure_migrations_table(session)
            applied = set(self._get_applied_migrations(session))
            if applied:
                logger.info(
                    "Schema migrations already tracked; skipping existing schema baseline"
                )
                return []

            baseline_number = self._detect_existing_schema_baseline_number()
            if baseline_number is None:
                logger.info("No existing schema baseline detected")
                return []

            baselined_versions: list[str] = []
            for file_path in migration_files:
                version = file_path.stem
                migration_number = self._migration_number(version)
                if migration_number is None or migration_number > baseline_number:
                    continue

                content = file_path.read_text()
                checksum = self._calculate_checksum(content)
                description = self._extract_description(content)
                if self._record_migration(
                    session=session,
                    version=version,
                    checksum=checksum,
                    description=f"Baseline existing schema: {description}",
                    execution_time_ms=0,
                ):
                    baselined_versions.append(version)

            session.commit()
            if baselined_versions:
                logger.warning(
                    "Baselined %s existing migration(s) through numeric version %s",
                    len(baselined_versions),
                    baseline_number,
                )
            return baselined_versions

    def rollback_migration(self, version: str) -> bool:
        """Rollback a specific migration"""
        rollback_file = self.migrations_dir / f"{version}_rollback.sql"

        if not rollback_file.exists():
            logger.error(f"Rollback file not found: {rollback_file}")
            return False

        try:
            # Read rollback content
            content = rollback_file.read_text()

            # Apply rollback
            with Session(self.engine) as session:
                # Use transaction to ensure atomicity
                with session.begin():
                    # Execute rollback statements using robust SQL splitting
                    statements = self._split_sql_statements(content)
                    for statement in statements:
                        if statement.strip():
                            session.exec(text(statement))

                    # Remove migration record within the same transaction
                    session.execute(
                        text("DELETE FROM schema_migrations WHERE version = :version"),
                        {"version": version},
                    )

            logger.info(f"✅ Migration {version} rolled back successfully")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to rollback migration {version}: {e}")
            return False

    def get_migration_status(self) -> list[dict]:
        """Get status of all migrations"""
        all_migrations = sorted(
            [
                f.stem
                for f in self.migrations_dir.glob("*.sql")
                if not f.name.endswith("_rollback.sql")
                and self._is_numbered_migration(f.name)
            ]
        )

        with Session(self.engine) as session:
            applied_migrations = self._get_applied_migrations(session)

            # Get detailed info for applied migrations
            result = session.exec(
                text("""
                SELECT version, executed_at, execution_time_ms, description
                FROM schema_migrations
                ORDER BY version
            """)
            )
            applied_info = {
                row[0]: {
                    "executed_at": row[1],
                    "execution_time_ms": row[2],
                    "description": row[3],
                }
                for row in result
            }

        status = []
        for version in all_migrations:
            if version in applied_info:
                status.append(
                    {
                        "version": version,
                        "status": "applied",
                        "executed_at": applied_info[version]["executed_at"],
                        "execution_time_ms": applied_info[version]["execution_time_ms"],
                        "description": applied_info[version]["description"],
                    }
                )
            else:
                # Read description from file
                file_path = self.migrations_dir / f"{version}.sql"
                description = ""
                if file_path.exists():
                    content = file_path.read_text()
                    description = self._extract_description(content)

                status.append(
                    {
                        "version": version,
                        "status": "pending",
                        "executed_at": None,
                        "execution_time_ms": None,
                        "description": description,
                    }
                )

        return status


# CLI interface for migration management
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="TaskAgent Database Migration Manager")
    parser.add_argument(
        "command", choices=["apply", "status", "rollback"], help="Command to execute"
    )
    parser.add_argument("--version", help="Migration version (for rollback)")
    parser.add_argument("--dir", default="migrations", help="Migrations directory")

    args = parser.parse_args()

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    manager = MigrationManager(args.dir)

    if args.command == "apply":
        applied, failed = manager.apply_all_pending()
        print(f"\nMigrations applied: {applied}, failed: {failed}")

    elif args.command == "status":
        status_list = manager.get_migration_status()
        print("\nMigration Status:")
        print("-" * 80)
        for item in status_list:
            status_icon = "✅" if item["status"] == "applied" else "⏳"
            print(f"{status_icon} {item['version']:<30} {item['status']:<10}", end="")
            if item["executed_at"]:
                print(f" {item['executed_at']} ({item['execution_time_ms']}ms)")
            else:
                print()
            if item["description"]:
                print(f"   {item['description']}")

    elif args.command == "rollback":
        if not args.version:
            print("Error: --version required for rollback")
            exit(1)
        success = manager.rollback_migration(args.version)
        if success:
            print(f"✅ Rolled back migration: {args.version}")
        else:
            print(f"❌ Failed to rollback migration: {args.version}")
            exit(1)
