"""Database configuration and connection management"""

import logging
from sqlalchemy import event
from sqlalchemy.pool import Pool

logger = logging.getLogger(__name__)


def configure_database_extensions():
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


def setup_connection_listeners(engine):
    """Setup SQLAlchemy connection event listeners"""

    @event.listens_for(Pool, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
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
            except Exception:
                # Not SQLite or error setting pragmas
                pass

    @event.listens_for(Pool, "connect")
    def set_postgresql_search_path(dbapi_connection, connection_record):
        """Set PostgreSQL search path for security"""
        # Check if this is PostgreSQL
        if hasattr(dbapi_connection, "execute"):
            try:
                cursor = dbapi_connection.cursor()
                # Test if this is PostgreSQL by trying a PG-specific query
                cursor.execute("SELECT version()")
                version = cursor.fetchone()[0]
                if "PostgreSQL" in version:
                    # Set search path to public schema only
                    cursor.execute("SET search_path TO public")
                    logger.debug("PostgreSQL search path configured")
                cursor.close()
            except Exception:
                # Not PostgreSQL or error setting search path
                pass

    logger.info("Database connection listeners configured")
