import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from database import db
from services import UserService
from models import UserCreate

logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer()

class AuthUser:
    """Authenticated user information"""
    def __init__(self, user_id: str, email: str):
        self.user_id = user_id
        self.email = email

async def ensure_user_exists(user_id: str, email: str) -> None:
    """
    Ensure user exists in public.users table
    Create if not exists
    """
    try:
        # Get database session
        session_gen = db.get_session()
        session = next(session_gen)
        
        try:
            # Check if user exists
            existing_user = UserService.get_user(session, user_id)
            
            if not existing_user:
                # Create user if not exists
                user_data = UserCreate(email=email)
                UserService.create_user(session, user_data, user_id)
                logger.info(f"✅ Created user in public.users: {user_id}")
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {e}")
        # Don't raise exception - user might already exist due to race condition

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> AuthUser:
    """
    Extract and validate user from JWT token
    """
    try:
        token = credentials.credentials

        # Verify token with Supabase
        client = db.get_client()

        # Get user from token
        user_response = client.auth.get_user(token)

        if not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = user_response.user
        
        # Ensure user exists in public.users table
        await ensure_user_exists(user.id, user.email)
        
        return AuthUser(user_id=user.id, email=user.email)

    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        HTTPBearer(auto_error=False)
    )
) -> AuthUser | None:
    """
    Optional authentication - returns None if no token provided
    """
    if not credentials:
        return None

    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None

async def get_current_user_id(
    current_user: AuthUser = Depends(get_current_user)
) -> str:
    """
    Get current user ID from authenticated user
    """
    return current_user.user_id
