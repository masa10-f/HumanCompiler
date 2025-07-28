import logging
import time
from collections import defaultdict
from typing import Dict

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from database import db
from services import UserService
from models import UserCreate

logger = logging.getLogger(__name__)

# Simple in-memory rate limiting 
# WARNING: This implementation does not persist across server restarts 
# and will not work correctly in multi-instance deployments.
# For production environments, use a distributed cache like Redis.
_auth_attempts: Dict[str, list] = defaultdict(list)
MAX_AUTH_ATTEMPTS = 5
RATE_LIMIT_WINDOW = 300  # 5 minutes

# Security scheme
security = HTTPBearer()

class AuthUser:
    """Authenticated user information"""
    def __init__(self, user_id: str, email: str):
        self.user_id = user_id
        self.email = email

def _check_rate_limit(client_ip: str) -> None:
    """Check authentication rate limit for IP address"""
    now = time.time()
    attempts = _auth_attempts[client_ip]
    
    # Remove old attempts outside the window
    attempts[:] = [attempt_time for attempt_time in attempts if now - attempt_time < RATE_LIMIT_WINDOW]
    
    if len(attempts) >= MAX_AUTH_ATTEMPTS:
        logger.warning(f"🔒 Rate limit exceeded for IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Please try again later.",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)}
        )
    
    # Record this attempt
    attempts.append(now)

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
            # Properly close session and generator
            try:
                session_gen.close()  # Close generator properly
            except Exception as close_error:
                logger.debug(f"Session generator close warning: {close_error}")
            
            try:
                session.close()
            except Exception as session_error:
                logger.debug(f"Session close warning: {session_error}")
            
    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {e}")
        # Don't raise exception - user might already exist due to race condition

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request | None = None
) -> AuthUser:
    """
    Extract and validate user from JWT token
    """
    try:
        # Apply rate limiting if request is available
        if request and request.client:
            client_ip = request.client.host or "unknown"
            _check_rate_limit(client_ip)
        
        token = credentials.credentials
        

        # Verify token with Supabase
        client = db.get_client()

        # Get user from token with timeout
        import asyncio
        try:
            user_response = await asyncio.wait_for(
                asyncio.to_thread(client.auth.get_user, token),
                timeout=5.0  # 5 second timeout
            )
        except asyncio.TimeoutError:
            logger.error("❌ Supabase auth timeout")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Authentication service timeout",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = user_response.user
        
        # Skip user creation to avoid hanging issues
        logger.info(f"✅ User authenticated: {user.id}")

        return AuthUser(user_id=user.id, email=user.email or "unknown@example.com")

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log full error details for debugging but return generic message
        logger.error(f"Authentication error: {type(e).__name__}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
        # Pass None for the request parameter as rate limiting handles None cases
        return await get_current_user(credentials, None)
    except HTTPException:
        return None

async def get_current_user_id(
    current_user: AuthUser = Depends(get_current_user)
) -> str:
    """
    Get current user ID from authenticated user
    """
    return current_user.user_id
