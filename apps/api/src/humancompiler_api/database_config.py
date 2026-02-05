"""Database configuration and connection management"""

import logging
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import Pool

logger = logging.getLogger(__name__)


def configure_database_extensions() -> None:
    """Configure database extensions and disable problematic features"""

    # Disable psycopg2 hstore extension if available
    try:
        import psycopg2.extras

        # Override register_hstore to prevent hstore registration
        def _disabled_register_hstore(*args, **kwargs):
            """Disabled version of register_hstore"""
            logger.debug("Skipping hstore registration (disabled)")
            return None

        # Replace the function
        psycopg2.extras.register_hstore = _disabled_register_hstore

        # Also disable the adapter's get_oids method
        if hasattr(psycopg2.extras, "HstoreAdapter"):

            def _disabled_get_oids(connection):
                """Disabled version of HstoreAdapter.get_oids"""
                return None, None

            psycopg2.extras.HstoreAdapter.get_oids = staticmethod(_disabled_get_oids)

        logger.info("PostgreSQL hstore extension disabled successfully")

    except ImportError:
        # psycopg2 not available, no need to disable hstore
        logger.debug("psycopg2 not available, skipping hstore configuration")
    except Exception as e:
        logger.warning(f"Error disabling hstore extension: {e}")


def setup_connection_listeners(engine: Engine) -> None:
    """Setup SQLAlchemy connection event listeners"""

    @event.listens_for(Pool, "connect")
    def set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
        """Configure SQLite pragmas for better performance"""
        # Check if this is SQLite
        if hasattr(dbapi_connection, "execute"):
            try:
                # Get database type
                cursor = dbapi_connection.cursor()
                cursor.execute("SELECT 1")
                cursor.close()

                # If we get here and it's SQLite, configure pragmas
                if "sqlite" in str(type(dbapi_connection)).lower():
                    cursor = dbapi_connection.cursor()
                    cursor.execute("PRAGMA foreign_keys=ON")
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA synchronous=NORMAL")
                    cursor.close()
                    logger.debug("SQLite pragmas configured")
            except Exception as e:
                # Not SQLite or error setting pragmas
                logger.debug(f"Failed to set SQLite pragmas: {e}")

    @event.listens_for(Pool, "connect")
    def configure_postgresql_connection(
        dbapi_connection: Any, connection_record: Any
    ) -> None:
        """Configure PostgreSQL connection settings after establishment.

        Sets search_path here (not in connect_args 'options') because
        Supabase's Supavisor in transaction pooling mode rejects
        session-level parameters in the startup packet.
        """
        # Detect PostgreSQL by driver module name instead of executing a query
        driver_module = type(dbapi_connection).__module__
        is_postgresql = "psycopg" in driver_module or "pg8000" in driver_module
        if is_postgresql:
            try:
                cursor = dbapi_connection.cursor()
                cursor.execute("SET search_path TO public")
                cursor.close()
                logger.debug("PostgreSQL search path configured")
            except Exception as e:
                logger.debug(f"Failed to configure PostgreSQL connection: {e}")

    @event.listens_for(engine, "checkout")
    def set_statement_timeout_on_checkout(
        dbapi_connection: Any, connection_record: Any, connection_proxy: Any
    ) -> None:
        """Apply statement_timeout on every connection checkout.

        Supavisor in transaction pooling mode resets session-level SET
        commands between transactions, so the 'connect' event (which fires
        only when a new physical connection is created) is not sufficient.
        The 'checkout' event fires every time a connection is handed out
        from the pool, ensuring statement_timeout is always active.
        """
        driver_module = type(dbapi_connection).__module__
        is_postgresql = "psycopg" in driver_module or "pg8000" in driver_module
        if is_postgresql:
            try:
                cursor = dbapi_connection.cursor()
                cursor.execute("SET statement_timeout = '30s'")
                cursor.close()
            except Exception as e:
                logger.debug(f"Failed to set statement_timeout on checkout: {e}")

    logger.info("Database connection listeners configured")
