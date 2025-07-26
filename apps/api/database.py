import logging
from typing import Generator

from sqlmodel import Session, create_engine
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import psycopg2
from supabase import Client, create_client
import psycopg2.extras

from config import settings

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
            
            # Create engine with minimal settings to avoid SSL issues
            self._engine = create_engine(
                database_url,
                echo=False,           # Disable echo to reduce queries
                pool_pre_ping=False,  # Disable pre-ping 
                pool_recycle=600,     # Recycle connections after 10 minutes
                pool_size=1,          # Single connection
                max_overflow=0,       # No overflow connections
                pool_timeout=30,      # Connection timeout
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
