import logging
from typing import Generator

from sqlmodel import Session, create_engine
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import psycopg2
from supabase import Client, create_client
import psycopg2.extras

from taskagent_api.config import settings

# Monkey patch to disable hstore entirely
def _disabled_get_oids(connection):
    """Disabled version of HstoreAdapter.get_oids to prevent SSL issues"""
    return None, None

# Apply the monkey patch
psycopg2.extras.HstoreAdapter.get_oids = staticmethod(_disabled_get_oids)

# Also patch the register_hstore function to prevent any hstore setup
original_register_hstore = psycopg2.extras.register_hstore
def _disabled_register_hstore(*args, **kwargs):
    """Disabled version of register_hstore"""
    pass

psycopg2.extras.register_hstore = _disabled_register_hstore

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
            self._client = create_client(
                settings.supabase_url,
                settings.supabase_anon_key
            )
            logger.info("✅ Supabase client initialized")
        return self._client

    def get_service_client(self) -> Client:
        """Get Supabase client with service role for admin operations"""
        if self._service_client is None:
            self._service_client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key
            )
            logger.info("✅ Supabase service client initialized")
        return self._service_client

    def get_engine(self):
        """Get SQLModel engine for database operations"""
        if self._engine is None:
            # Use the database URL as-is from environment
            database_url = settings.database_url
            
            # Minimal connection args
            connect_args = {
                "connect_timeout": 10,
                "application_name": "TaskAgent-API"
            }
            
            # Create engine with optimized pool settings for local development
            self._engine = create_engine(
                database_url,
                echo=settings.debug,  # Show SQL queries in debug mode
                pool_pre_ping=True,   # Enable connection health checks
                pool_recycle=3600,    # Recycle connections after 1 hour
                pool_size=10,         # Increase pool size for concurrent requests
                max_overflow=20,      # Allow more overflow connections
                pool_timeout=60,      # Longer timeout for busy periods
                connect_args=connect_args
            )
            
            logger.info("✅ SQLModel engine initialized with hstore globally disabled")
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

# SQLModel Base for tests
from sqlmodel import SQLModel
Base = SQLModel.metadata
