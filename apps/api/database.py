import logging

from supabase import Client, create_client

from config import settings

logger = logging.getLogger(__name__)

class Database:
    """Database connection manager"""

    def __init__(self):
        self._client: Client = None
        self._service_client: Client = None

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
