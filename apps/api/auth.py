from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import jwt
from database import db
import logging

logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer()

class AuthUser:
    """Authenticated user information"""
    def __init__(self, user_id: str, email: str):
        self.user_id = user_id
        self.email = email

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
        return AuthUser(user_id=user.id, email=user.email)
        
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
) -> Optional[AuthUser]:
    """
    Optional authentication - returns None if no token provided
    """
    if not credentials:
        return None
    
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None