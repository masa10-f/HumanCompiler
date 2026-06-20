import logging
from collections.abc import Generator

from sqlmodel import Session, create_engine
from supabase import Client, create_client

from humancompiler_api.config import settings
from humancompiler_api.database_config import (
    configure_database_extensions,
    setup_connection_listeners,
)

# Configure database extensions before any connections are made
configure_database_extensions()

logger = logging.getLogger(__name__)

# Database pool configuration constants
POOL_SIZE_DEFAULT = 10
POOL_SIZE_MIN = 1
POOL_SIZE_MAX = 50

MAX_OVERFLOW_DEFAULT = 20
MAX_OVERFLOW_MIN = 0
MAX_OVERFLOW_MAX = 100

POOL_TIMEOUT_DEFAULT = 30
# Recycle connections before Supavisor's ~60s client_idle_timeout kills them.
# Connections older than this are discarded on checkout and replaced with
# fresh ones, preventing InterfaceError("connection already closed") errors.
POOL_RECYCLE_DEFAULT = 55

# Connection-level timeouts for PostgreSQL (seconds)
PG_CONNECT_TIMEOUT = 5
PG_STATEMENT_TIMEOUT_MS = 30000  # 30 seconds


class Database:
    """Database connection manager"""

    def __init__(self):
        self._client: Client | None = None
        self._service_client: Client | None = None
        self._engine = None

    def get_client(self) -> Client | None:
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

    def get_service_client(self) -> Client | None:
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

            # Connection args for PostgreSQL: timeouts, keepalives, and optional SSL.
            # NOTE: Do NOT use 'options' parameter (e.g. -c statement_timeout=...)
            # here — Supabase's Supavisor in transaction pooling mode rejects
            # session-level parameters in the startup packet, closing the
            # connection immediately. Set statement_timeout via pool event
            # listener in database_config.py instead.
            connect_args = {}
            if "postgresql" in database_url:
                import os

                # Prevent hanging on stale/half-open connections
                connect_args["connect_timeout"] = PG_CONNECT_TIMEOUT

                # TCP keepalives: detect dead connections within ~25s
                # instead of default TCP timeout of 120-180s.
                # Critical for Supabase/PgBouncer which silently drops
                # idle connections after ~5 min.
                connect_args["keepalives"] = 1
                connect_args["keepalives_idle"] = 10  # Probe after 10s idle
                connect_args["keepalives_interval"] = 5  # Probe every 5s
                connect_args["keepalives_count"] = 3  # Fail after 3 missed
                # Linux-specific: hard upper bound on unacknowledged data
                connect_args["tcp_user_timeout"] = 10000  # 10s in ms

                sslmode = os.getenv("DB_SSLMODE")
                if sslmode:
                    connect_args["sslmode"] = sslmode

            # Configure pool settings with environment variable overrides
            import os

            pool_size = int(os.getenv("DB_POOL_SIZE", str(POOL_SIZE_DEFAULT)))
            max_overflow = int(os.getenv("DB_MAX_OVERFLOW", str(MAX_OVERFLOW_DEFAULT)))
            pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", str(POOL_TIMEOUT_DEFAULT)))
            pool_recycle = int(os.getenv("DB_POOL_RECYCLE", str(POOL_RECYCLE_DEFAULT)))

            # Validate pool settings
            if pool_size < POOL_SIZE_MIN or pool_size > POOL_SIZE_MAX:
                logger.warning(
                    f"Invalid pool_size: {pool_size}, using default: {POOL_SIZE_DEFAULT}"
                )
                pool_size = POOL_SIZE_DEFAULT
            if max_overflow < MAX_OVERFLOW_MIN or max_overflow > MAX_OVERFLOW_MAX:
                logger.warning(
                    f"Invalid max_overflow: {max_overflow}, using default: {MAX_OVERFLOW_DEFAULT}"
                )
                max_overflow = MAX_OVERFLOW_DEFAULT

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
                # Enable query result caching for better performance.
                # NOTE: Do NOT set isolation_level here — PostgreSQL defaults
                # to READ_COMMITTED already, and explicitly setting it forces a
                # psycopg2 set_isolation_level() C-call on every Connection.__init__,
                # which fails on stale connections (InterfaceError) because it runs
                # AFTER pool_pre_ping, outside the pool's invalidation retry loop.
                execution_options={
                    "compiled_cache": {},
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

    def _try_connect(self) -> None:
        """Execute a single test connection (runs in a thread for timeout)."""
        from sqlalchemy import text

        engine = self.get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            conn.commit()

    def warm_pool(
        self,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        per_attempt_timeout: float = 10.0,
    ) -> bool:
        """
        Pre-warm the connection pool by establishing and validating a connection.

        This triggers SQLAlchemy's dialect initialization (first_connect event)
        during startup rather than on the first user request. Each attempt has
        a strict thread-level timeout to prevent blocking server startup.

        Returns True if warm-up succeeded, False otherwise.
        """
        import concurrent.futures
        import time as _time

        for attempt in range(1, max_retries + 1):
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            try:
                future = executor.submit(self._try_connect)
                future.result(timeout=per_attempt_timeout)
                logger.info(
                    f"✅ Connection pool warmed up successfully (attempt {attempt})"
                )
                executor.shutdown(wait=False)
                return True
            except concurrent.futures.TimeoutError:
                # Don't wait for the stuck thread — shutdown immediately
                executor.shutdown(wait=False, cancel_futures=True)
                logger.warning(
                    f"⚠️ Pool warm-up attempt {attempt}/{max_retries} timed out "
                    f"after {per_attempt_timeout}s"
                )
            except Exception as e:
                executor.shutdown(wait=False)
                logger.warning(
                    f"⚠️ Pool warm-up attempt {attempt}/{max_retries} failed: "
                    f"{type(e).__name__}: {e}"
                )
            # Dispose stale connections so next attempt gets a fresh one
            if attempt < max_retries:
                self.get_engine().dispose()
                _time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
        logger.error("❌ Connection pool warm-up failed after all retries")
        return False

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
