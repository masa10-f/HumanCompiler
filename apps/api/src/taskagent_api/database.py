import logging
from collections.abc import Generator

from sqlmodel import Session, create_engine
from supabase import Client, create_client

from taskagent_api.config import settings
from taskagent_api.database_config import (
    configure_database_extensions,
    setup_connection_listeners,
)

# Configure database extensions before any connections are made
configure_database_extensions()

logger = logging.getLogger(__name__)


class Database:
    """Database connection manager"""

    def __init__(self):
        self._client: Client = None
        self._service_client: Client = None
        self._engine = None

    def get_client(self) -> Client:
        """Get Supabase client for user operations"""
        if self._client is None:
            try:
                self._client = create_client(
                    settings.supabase_url, settings.supabase_anon_key
                )
                logger.info("✅ Supabase client initialized")
            except Exception as e:
                logger.warning(f"⚠️ Failed to initialize Supabase client: {e}")
                # Return None or mock client depending on environment
                if (
                    hasattr(settings, "environment")
                    and settings.environment == "development"
                ):
                    logger.info("Using development mode - database disabled")
                    return None
                raise
        return self._client

    def get_service_client(self) -> Client:
        """Get Supabase client with service role for admin operations"""
        if self._service_client is None:
            self._service_client = create_client(
                settings.supabase_url, settings.supabase_service_role_key
            )
            logger.info("✅ Supabase service client initialized")
        return self._service_client

    def get_engine(self):
        """Get SQLModel engine for database operations"""
        if self._engine is None:
            # Use the database URL as-is from environment
            database_url = settings.database_url

            # Minimal connection args
            connect_args = {"connect_timeout": 10, "application_name": "TaskAgent-API"}

            # Configure pool settings with environment variable overrides
            import os

            pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
            max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
            pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
            pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "3600"))

            # Validate pool settings
            if pool_size < 1 or pool_size > 50:
                logger.warning(f"Invalid pool_size: {pool_size}, using default: 5")
                pool_size = 5
            if max_overflow < 0 or max_overflow > 100:
                logger.warning(
                    f"Invalid max_overflow: {max_overflow}, using default: 10"
                )
                max_overflow = 10

            # Create engine with optimized pool settings for better performance
            self._engine = create_engine(
                database_url,
                echo=settings.debug,  # Show SQL queries in debug mode
                pool_pre_ping=True,  # Enable connection health checks
                pool_recycle=pool_recycle,  # Recycle connections periodically
                pool_size=pool_size,  # Configurable pool size
                max_overflow=max_overflow,  # Configurable overflow connections
                pool_timeout=pool_timeout,  # Configurable timeout
                pool_reset_on_return="commit",  # Reset connections on return for consistency
                connect_args=connect_args,
                # Enable query result caching for better performance
                execution_options={
                    "compiled_cache": {},
                    "isolation_level": "READ_COMMITTED",
                },
            )

            logger.info(
                f"✅ Database pool configured: pool_size={pool_size}, "
                f"max_overflow={max_overflow}, pool_timeout={pool_timeout}s"
            )

            # Setup connection event listeners
            setup_connection_listeners(self._engine)

            logger.info("✅ SQLModel engine initialized with optimized configuration")
        return self._engine

    def get_session(self) -> Generator[Session, None, None]:
        """Get database session"""
        engine = self.get_engine()
        with Session(engine) as session:
            yield session

    async def health_check(self) -> bool:
        """Check database connection health"""
        try:
            client = self.get_client()
            if client is None:
                logger.warning("Database client not available (development mode)")
                return False
            # Simple query to test connection
            client.table("users").select("count", count="exact").execute()
            return True
        except Exception as e:
            logger.error(f"❌ Database health check failed: {e}")
            return False


# Global database instance
db = Database()


# Dependency for FastAPI
def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency to get database session"""
    yield from db.get_session()


# Alias for compatibility
get_session = get_db


# SQLModel Base for tests
# ruff: noqa: E402
from sqlmodel import SQLModel

Base = SQLModel.metadata
