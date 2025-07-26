import logging
from typing import Generator

from sqlmodel import Session, create_engine
from supabase import Client, create_client

from config import settings

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
            # Modify database URL to include SSL parameters
            database_url = settings.database_url
            if "?" not in database_url:
                database_url += "?sslmode=require&connect_timeout=30"
            else:
                database_url += "&sslmode=require&connect_timeout=30"
            
            # Connection args for psycopg2
            connect_args = {
                "sslmode": "require",
                "connect_timeout": 30,
                "application_name": "TaskAgent-API",
                "options": "-c default_transaction_isolation=read_committed"
            }
            
            self._engine = create_engine(
                database_url,
                echo=settings.debug,
                pool_pre_ping=True,
                pool_recycle=1800,   # Recycle connections after 30 minutes
                pool_size=3,         # Smaller pool for better connection management
                max_overflow=5,      # Fewer overflow connections
                pool_timeout=30,     # Connection timeout from pool
                connect_args=connect_args,
                # Disable hstore support to avoid SSL issues during connection init
                module=None
            )
            logger.info("✅ SQLModel engine initialized with enhanced SSL settings")
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
