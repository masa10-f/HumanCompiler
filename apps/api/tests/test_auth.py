"""
Tests for authentication module
"""

import logging
import time
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from humancompiler_api.auth import (
    AuthUser,
    ensure_user_exists,
    get_current_user,
    get_optional_user,
    get_current_user_id,
    verify_token_for_websocket,
)

# Fake values: the secret part must never appear in logs.
AGENT_TOKEN_PREFIX = "hc_agent_" + "p" * 8
AGENT_TOKEN = AGENT_TOKEN_PREFIX + "_" + "s" * 32
OPAQUE_TOKEN = "opaque-test-value-" + "x" * 32


@pytest.fixture
def mock_credentials():
    """Mock HTTP authorization credentials"""
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="mock_token")


@pytest.fixture
def auth_user():
    """Mock AuthUser instance"""
    return AuthUser(
        user_id="87654321-4321-8765-4321-876543218765", email="test@example.com"
    )


def test_auth_user_initialization():
    """Test AuthUser class initialization"""
    user_id = "87654321-4321-8765-4321-876543218765"
    user = AuthUser(user_id=user_id, email="user@test.com")
    assert user.user_id == user_id
    assert user.email == "user@test.com"


@pytest.mark.asyncio
async def test_ensure_user_exists_new_user():
    """Test ensure_user_exists creates new user"""
    mock_session = Mock()
    mock_session_gen = Mock()
    mock_session_gen.__next__ = Mock(return_value=mock_session)
    mock_session_gen.close = Mock()
    mock_session.close = Mock()

    with patch("humancompiler_api.auth.db.get_session", return_value=mock_session_gen):
        with patch("humancompiler_api.auth.UserService.get_user", return_value=None):
            with patch("humancompiler_api.auth.UserService.create_user") as mock_create:
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

    with patch("humancompiler_api.auth.db.get_session", return_value=mock_session_gen):
        with patch(
            "humancompiler_api.auth.UserService.get_user", return_value=existing_user
        ):
            with patch("humancompiler_api.auth.UserService.create_user") as mock_create:
                await ensure_user_exists("existing-user-id", "existing@example.com")

                # Should not create user if already exists
                mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_user_exists_error_handling():
    """Test ensure_user_exists error handling"""
    with patch(
        "humancompiler_api.auth.db.get_session", side_effect=Exception("Database error")
    ):
        # Should not raise exception even on error
        await ensure_user_exists("user-id", "user@example.com")


@pytest.mark.asyncio
async def test_get_current_user_success(mock_credentials):
    """Test successful user authentication"""
    mock_user = Mock()
    mock_user.id = "87654321-4321-8765-4321-876543218765"
    mock_user.email = "test@example.com"

    mock_user_response = Mock()
    mock_user_response.user = mock_user

    mock_client = Mock()

    with patch("humancompiler_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.return_value = mock_user_response

            result = await get_current_user(mock_credentials)

            assert result.user_id == "87654321-4321-8765-4321-876543218765"
            assert result.email == "test@example.com"


@pytest.mark.asyncio
async def test_get_current_user_invalid_token(mock_credentials):
    """Test authentication with invalid token"""
    mock_user_response = Mock()
    mock_user_response.user = None

    mock_client = Mock()

    with patch("humancompiler_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", return_value=mock_user_response):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(mock_credentials)

            assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
            assert "Invalid authentication token" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_timeout(mock_credentials):
    """Test authentication timeout"""
    mock_client = Mock()

    with patch("humancompiler_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", side_effect=TimeoutError("Timeout")):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(mock_credentials)

            assert exc_info.value.status_code == status.HTTP_504_GATEWAY_TIMEOUT
            assert "Authentication service timeout" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_general_exception(mock_credentials):
    """Test authentication with general exception"""
    with patch(
        "humancompiler_api.auth.db.get_client", side_effect=Exception("General error")
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(mock_credentials)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
        assert "Authentication failed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_optional_user_with_credentials(mock_credentials, auth_user):
    """Test optional authentication with valid credentials"""
    with patch("humancompiler_api.auth.get_current_user", return_value=auth_user):
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
    with patch(
        "humancompiler_api.auth.get_current_user",
        side_effect=HTTPException(401, "Auth failed"),
    ):
        result = await get_optional_user(mock_credentials)
        assert result is None


@pytest.mark.asyncio
async def test_get_current_user_id(auth_user):
    """Test getting current user ID"""
    result = await get_current_user_id(auth_user)
    assert result == "87654321-4321-8765-4321-876543218765"


@pytest.mark.asyncio
async def test_get_current_user_no_email(mock_credentials):
    """Test authentication with user having no email"""
    mock_user = Mock()
    mock_user.id = "87654321-4321-8765-4321-876543218765"
    mock_user.email = None

    mock_user_response = Mock()
    mock_user_response.user = mock_user

    mock_client = Mock()

    with patch("humancompiler_api.auth.db.get_client", return_value=mock_client):
        with patch("asyncio.wait_for", return_value=mock_user_response):
            result = await get_current_user(mock_credentials)

            assert result.user_id == "87654321-4321-8765-4321-876543218765"
            assert result.email == "unknown@example.com"


def _invalid_user_response():
    response = Mock()
    response.user = None
    return response


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["invalid", "error"])
async def test_get_current_user_logs_only_agent_token_prefix(caplog, outcome):
    """An agent token sent to a user endpoint logs its public prefix only."""
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=AGENT_TOKEN)
    wait_for = (
        {"return_value": _invalid_user_response()}
        if outcome == "invalid"
        else {"side_effect": Exception("boom")}
    )

    with caplog.at_level(logging.INFO, logger="humancompiler_api.auth"):
        with patch("humancompiler_api.auth.db.get_client", return_value=Mock()):
            with patch("asyncio.wait_for", **wait_for):
                with pytest.raises(HTTPException):
                    await get_current_user(credentials)

    assert AGENT_TOKEN_PREFIX in caplog.text
    assert AGENT_TOKEN[: len(AGENT_TOKEN_PREFIX) + 2] not in caplog.text


@pytest.mark.asyncio
async def test_get_current_user_does_not_log_other_token_characters(caplog):
    """A non-agent token is logged as a fingerprint, never by its characters."""
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials=OPAQUE_TOKEN
    )

    with caplog.at_level(logging.INFO, logger="humancompiler_api.auth"):
        with patch("humancompiler_api.auth.db.get_client", return_value=Mock()):
            with patch("asyncio.wait_for", return_value=_invalid_user_response()):
                with pytest.raises(HTTPException):
                    await get_current_user(credentials)

    assert "sha256:" in caplog.text
    assert OPAQUE_TOKEN[:8] not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("token", "secret_part"),
    [
        (AGENT_TOKEN, AGENT_TOKEN[: len(AGENT_TOKEN_PREFIX) + 2]),
        (OPAQUE_TOKEN, OPAQUE_TOKEN[:8]),
    ],
)
async def test_verify_token_for_websocket_does_not_log_secret(
    caplog, token, secret_part
):
    """WebSocket auth logs follow the same rule as get_current_user."""
    with caplog.at_level(logging.INFO, logger="humancompiler_api.auth"):
        with patch("humancompiler_api.auth.db.get_client", return_value=Mock()):
            with patch("asyncio.wait_for", return_value=_invalid_user_response()):
                with pytest.raises(Exception, match="Invalid authentication token"):
                    await verify_token_for_websocket(token)

    assert "[WS AUTH]" in caplog.text
    assert secret_part not in caplog.text
