import logging
import time
from collections import defaultdict

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from humancompiler_api.database import db
from humancompiler_api.models import UserCreate
from humancompiler_api.services import UserService

logger = logging.getLogger(__name__)

# Simple in-memory rate limiting
# WARNING: This implementation does not persist across server restarts
# and will not work correctly in multi-instance deployments.
# For production environments, use a distributed cache like Redis.
_auth_attempts: dict[str, list] = defaultdict(list)
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
    attempts[:] = [
        attempt_time
        for attempt_time in attempts
        if now - attempt_time < RATE_LIMIT_WINDOW
    ]

    if len(attempts) >= MAX_AUTH_ATTEMPTS:
        logger.warning(f"🔒 Rate limit exceeded for IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Please try again later.",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )

    # Record this attempt
    attempts.append(now)


async def ensure_user_exists(user_id: str, email: str) -> None:
    """
    Ensure user exists in public.users table
    Create if not exists
    """
    try:
        from sqlmodel import Session

        engine = db.get_engine()

        with Session(engine) as session:
            # Check if user exists
            try:
                existing_user = UserService.get_user(session, user_id)

                if existing_user:
                    logger.debug(f"✅ User already exists in database: {user_id}")
                    return

                # Create user if not exists
                user_data = UserCreate(email=email)
                new_user = UserService.create_user(session, user_data, user_id)
                session.commit()
                logger.info(f"✅ Created new user in database: {user_id} ({email})")

            except Exception as service_error:
                # If UserService fails, try direct model creation
                logger.warning(
                    f"UserService failed, trying direct creation: {service_error}"
                )
                session.rollback()

                from humancompiler_api.models import User
                from sqlmodel import select
                from uuid import UUID
                from datetime import datetime, UTC

                # Check if user exists directly
                existing_user = session.get(User, UUID(user_id))
                if existing_user:
                    logger.debug(f"✅ User already exists (direct check): {user_id}")
                    return

                # Create user directly
                new_user = User(
                    id=UUID(user_id),
                    email=email,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
                session.add(new_user)
                session.commit()
                logger.info(f"✅ Created user via direct model: {user_id} ({email})")

    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {type(e).__name__}: {e}")
        # Don't raise exception - user creation failure shouldn't block authentication
        import traceback

        logger.debug(f"Traceback: {traceback.format_exc()}")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> AuthUser:
    """
    Extract and validate user from JWT token
    """
    try:
        if not credentials:
            logger.warning("❌ [AUTH] No credentials provided")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No authentication credentials provided",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = credentials.credentials
        if not token:
            logger.warning("❌ [AUTH] Empty token provided")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Empty authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        logger.info(f"🔍 [AUTH] Attempting authentication with token: {token[:20]}...")

        # Verify token with Supabase
        client = db.get_client()

        # Get user from token with timeout
        import asyncio

        try:
            user_response = await asyncio.wait_for(
                asyncio.to_thread(client.auth.get_user, token),
                timeout=5.0,  # 5 second timeout
            )
        except TimeoutError as e:
            logger.error("❌ Supabase auth timeout")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Authentication service timeout",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e

        if not user_response.user:
            logger.warning(
                f"❌ [AUTH] Invalid token: {token[:20]}... - No user found in response"
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = user_response.user

        # Ensure user exists in our database
        logger.info(f"✅ User authenticated: {user.id}")

        # Create user in database if not exists
        try:
            await ensure_user_exists(user.id, user.email or "unknown@example.com")
            logger.info(f"✅ User ensured in database: {user.id}")
        except Exception as user_creation_error:
            logger.error(f"⚠️ Failed to ensure user exists: {user_creation_error}")
            # Continue with authentication - user creation failure shouldn't block login

        return AuthUser(user_id=user.id, email=user.email or "unknown@example.com")

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log full error details for debugging but return generic message
        logger.error(
            f"❌ [AUTH] Authentication exception: {type(e).__name__}: {str(e)}"
        )
        logger.error(
            f"❌ [AUTH] Token was: {token[:20] if 'token' in locals() else 'N/A'}..."
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        HTTPBearer(auto_error=False)
    ),
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
    current_user: AuthUser = Depends(get_current_user),
) -> str:
    """
    Get current user ID from authenticated user
    """
    return current_user.user_id
