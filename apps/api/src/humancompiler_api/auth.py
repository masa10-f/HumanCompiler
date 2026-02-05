import logging
import threading
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

# In-memory cache of known user IDs to skip DB check on every request.
# This eliminates the stale connection issue caused by ensure_user_exists()
# creating independent Session(engine) on every authenticated request.
# Cache is cleared on server restart; users are re-verified on first request.
_known_users: set[str] = set()
_known_users_lock = threading.Lock()

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


def _ensure_user_exists_sync(user_id: str, email: str) -> None:
    """
    Synchronous DB check/create for user existence.
    Runs in a thread to avoid blocking the event loop.
    """
    from sqlmodel import Session

    engine = db.get_engine()

    with Session(engine) as session:
        try:
            existing_user = UserService.get_user(session, user_id)

            if existing_user:
                logger.debug(f"✅ User already exists in database: {user_id}")
                with _known_users_lock:
                    _known_users.add(user_id)
                return

            # Create user if not exists
            user_data = UserCreate(email=email)
            UserService.create_user(session, user_data, user_id)
            session.commit()
            logger.info(f"✅ Created new user in database: {user_id} ({email})")
            with _known_users_lock:
                _known_users.add(user_id)

        except Exception as service_error:
            # If UserService fails, try direct model creation
            logger.warning(
                f"UserService failed, trying direct creation: {service_error}"
            )
            session.rollback()

            from datetime import UTC, datetime
            from uuid import UUID

            from humancompiler_api.models import User

            # Check if user exists directly
            existing_user = session.get(User, UUID(user_id))
            if existing_user:
                logger.debug(f"✅ User already exists (direct check): {user_id}")
                with _known_users_lock:
                    _known_users.add(user_id)
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
            with _known_users_lock:
                _known_users.add(user_id)


# Timeout for ensure_user_exists DB operations (seconds).
# Bounds the worst-case hang when a stale connection is encountered.
_ENSURE_USER_TIMEOUT = 10.0


async def ensure_user_exists(user_id: str, email: str) -> None:
    """
    Ensure user exists in public.users table.
    Uses in-memory cache to skip DB check for already-known users,
    preventing stale connection hangs from independent Session(engine) creation.
    DB operations are run in a thread with a timeout to bound worst-case latency.
    """
    # Fast path: user already verified during this server lifetime
    if user_id in _known_users:
        logger.debug(f"✅ User known from cache: {user_id}")
        return

    import asyncio

    try:
        await asyncio.wait_for(
            asyncio.to_thread(_ensure_user_exists_sync, user_id, email),
            timeout=_ENSURE_USER_TIMEOUT,
        )
    except TimeoutError:
        logger.error(
            f"❌ ensure_user_exists timed out after {_ENSURE_USER_TIMEOUT}s "
            f"for user {user_id} — likely a stale DB connection"
        )
    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {type(e).__name__}: {e}")
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


async def verify_token_for_websocket(token: str) -> AuthUser:
    """
    Verify a token for WebSocket authentication.

    This is similar to get_current_user but doesn't use FastAPI dependencies,
    making it suitable for WebSocket authentication via query parameters.

    Raises:
        Exception: If token is invalid or verification fails
    """
    if not token:
        raise ValueError("No token provided")

    logger.info(f"🔍 [WS AUTH] Verifying WebSocket token: {token[:20]}...")

    # Verify token with Supabase
    client = db.get_client()

    import asyncio

    try:
        user_response = await asyncio.wait_for(
            asyncio.to_thread(client.auth.get_user, token),
            timeout=5.0,
        )
    except TimeoutError as e:
        logger.error("❌ [WS AUTH] Supabase auth timeout")
        raise Exception("Authentication service timeout") from e

    if not user_response.user:
        logger.warning(f"❌ [WS AUTH] Invalid token: {token[:20]}...")
        raise Exception("Invalid authentication token")

    user = user_response.user
    logger.info(f"✅ [WS AUTH] WebSocket user authenticated: {user.id}")

    # Ensure user exists in database
    try:
        await ensure_user_exists(user.id, user.email or "unknown@example.com")
    except Exception as e:
        logger.warning(f"⚠️ [WS AUTH] Failed to ensure user exists: {e}")

    return AuthUser(user_id=user.id, email=user.email or "unknown@example.com")
