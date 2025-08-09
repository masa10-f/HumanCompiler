"""
Tests for authentication module
"""

import asyncio
import time
from unittest.mock import Mock, patch, AsyncMock

import pytest
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from taskagent_api.auth import (
    AuthUser,
    _check_rate_limit,
    ensure_user_exists,
    get_current_user,
    get_optional_user,
    get_current_user_id,
    _auth_attempts,
    MAX_AUTH_ATTEMPTS,
    RATE_LIMIT_WINDOW,
)
from taskagent_api.models import UserCreate


@pytest.fixture
def mock_credentials():
    """Mock HTTP authorization credentials"""
    return HTTPAuthorizationCredentials(
        scheme="Bearer", 
        credentials="mock_token"
    )


@pytest.fixture
def auth_user():
    """Mock AuthUser instance"""
    return AuthUser(user_id="test-user-id", email="test@example.com")


def test_auth_user_initialization():
    """Test AuthUser class initialization"""
    user = AuthUser(user_id="user123", email="user@test.com")
    assert user.user_id == "user123"
    assert user.email == "user@test.com"


def test_check_rate_limit_normal_usage():
    """Test rate limiting with normal usage"""
    client_ip = "192.168.1.1"

    # Clear any existing attempts
    _auth_attempts[client_ip].clear()

    # Normal usage should not raise exception
    _check_rate_limit(client_ip)
    assert len(_auth_attempts[client_ip]) == 1


def test_check_rate_limit_exceeded():
    """Test rate limiting when limit is exceeded"""
    client_ip = "192.168.1.2"

    # Clear any existing attempts
    _auth_attempts[client_ip].clear()

    # Add MAX_AUTH_ATTEMPTS attempts
    current_time = time.time()
    for _ in range(MAX_AUTH_ATTEMPTS):
        _auth_attempts[client_ip].append(current_time)

    # Next attempt should raise exception
    with pytest.raises(HTTPException) as exc_info:
        _check_rate_limit(client_ip)

    assert exc_info.value.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert "Too many authentication attempts" in exc_info.value.detail


def test_check_rate_limit_window_expiry():
    """Test rate limiting window expiry"""
    client_ip = "192.168.1.3"

    # Clear any existing attempts
    _auth_attempts[client_ip].clear()

    # Add old attempts (outside the window)
    old_time = time.time() - RATE_LIMIT_WINDOW - 10
    for _ in range(MAX_AUTH_ATTEMPTS):
        _auth_attempts[client_ip].append(old_time)

    # Should not raise exception as attempts are old
    _check_rate_limit(client_ip)

    # Old attempts should be cleaned up
    assert len([a for a in _auth_attempts[client_ip] if time.time() - a < RATE_LIMIT_WINDOW]) == 1


@pytest.mark.asyncio
async def test_ensure_user_exists_new_user():
    """Test ensure_user_exists creates new user"""
    mock_session = Mock()
    mock_session_gen = Mock()
    mock_session_gen.__next__ = Mock(return_value=mock_session)
    mock_session_gen.close = Mock()
    mock_session.close = Mock()

    with patch("taskagent_api.auth.db.get_session", return_value=mock_session_gen):
        with patch("taskagent_api.auth.UserService.get_user", return_value=None):
            with patch("taskagent_api.auth.UserService.create_user") as mock_create:
                await ensure_user_exists("new-user-id", "new@example.com")

                mock_create.assert_called_once()
                args = mock_create.call_args
                assert args[0][1].email == "new@example.com"
                assert args[0][2] == "new-user-id"


@pytest.mark.asyncio
async def test_ensure_user_exists_existing_user():
    """Test ensure_user_exists with existing user"""
    mock_session = Mock()
    mock_session_gen = Mock()
    mock_session_gen.__next__ = Mock(return_value=mock_session)
    mock_session_gen.close = Mock()
    mock_session.close = Mock()

    existing_user = Mock()

    with patch("taskagent_api.auth.db.get_session", return_value=mock_session_gen):
        with patch("taskagent_api.auth.UserService.get_user", return_value=existing_user):
            with patch("taskagent_api.auth.UserService.create_user") as mock_create:
                await ensure_user_exists("existing-user-id", "existing@example.com")

                # Should not create user if already exists
                mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_user_exists_error_handling():
    """Test ensure_user_exists error handling"""
    with patch("taskagent_api.auth.db.get_session", side_effect=Exception("Database error")):
        # Should not raise exception even on error
        await ensure_user_exists("user-id", "user@example.com")


@pytest.mark.asyncio
async def test_get_current_user_success(mock_credentials):
    """Test successful user authentication"""
    mock_user = Mock()
    mock_user.id = "test-user-id"
    mock_user.email = "test@example.com"

    mock_user_response = Mock()
    mock_user_response.user = mock_user

    mock_client = Mock()

    with patch("taskagent_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.return_value = mock_user_response

            result = await get_current_user(mock_credentials)

            assert result.user_id == "test-user-id"
            assert result.email == "test@example.com"


@pytest.mark.asyncio
async def test_get_current_user_invalid_token(mock_credentials):
    """Test authentication with invalid token"""
    mock_user_response = Mock()
    mock_user_response.user = None

    mock_client = Mock()

    with patch("taskagent_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", return_value=mock_user_response):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(mock_credentials)

            assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
            assert "Invalid authentication token" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_timeout(mock_credentials):
    """Test authentication timeout"""
    mock_client = Mock()

    with patch("taskagent_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", side_effect=TimeoutError("Timeout")):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(mock_credentials)

            assert exc_info.value.status_code == status.HTTP_504_GATEWAY_TIMEOUT
            assert "Authentication service timeout" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_general_exception(mock_credentials):
    """Test authentication with general exception"""
    with patch("taskagent_api.auth.db.get_client", side_effect=Exception("General error")):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(mock_credentials)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
        assert "Authentication failed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_optional_user_with_credentials(mock_credentials, auth_user):
    """Test optional authentication with valid credentials"""
    with patch("taskagent_api.auth.get_current_user", return_value=auth_user):
        result = await get_optional_user(mock_credentials)
        assert result == auth_user


@pytest.mark.asyncio
async def test_get_optional_user_without_credentials():
    """Test optional authentication without credentials"""
    result = await get_optional_user(None)
    assert result is None


@pytest.mark.asyncio
async def test_get_optional_user_auth_failure(mock_credentials):
    """Test optional authentication with authentication failure"""
    with patch("taskagent_api.auth.get_current_user", side_effect=HTTPException(401, "Auth failed")):
        result = await get_optional_user(mock_credentials)
        assert result is None


@pytest.mark.asyncio
async def test_get_current_user_id(auth_user):
    """Test getting current user ID"""
    result = await get_current_user_id(auth_user)
    assert result == "test-user-id"


@pytest.mark.asyncio
async def test_get_current_user_no_email(mock_credentials):
    """Test authentication with user having no email"""
    mock_user = Mock()
    mock_user.id = "test-user-id"
    mock_user.email = None

    mock_user_response = Mock()
    mock_user_response.user = mock_user

    mock_client = Mock()

    with patch("taskagent_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", return_value=mock_user_response):
            result = await get_current_user(mock_credentials)

            assert result.user_id == "test-user-id"
            assert result.email == "unknown@example.com"


def test_auth_constants():
    """Test authentication constants"""
    assert MAX_AUTH_ATTEMPTS == 5
    assert RATE_LIMIT_WINDOW == 300


def test_auth_attempts_data_structure():
    """Test _auth_attempts data structure"""
    assert isinstance(_auth_attempts, dict)
    # Test that accessing a new key creates an empty list
    test_ip = "test.ip.address"
    attempts = _auth_attempts[test_ip]
    assert isinstance(attempts, list)
    assert len(attempts) == 0
