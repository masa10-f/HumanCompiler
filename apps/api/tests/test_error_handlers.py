import json

import pytest
from fastapi import HTTPException, status
from starlette.requests import Request

from humancompiler_api.common.error_handlers import (
    ExternalServiceError,
    ResourceNotFoundError,
    ServiceError,
    ValidationError,
    service_exception_handler,
)
from humancompiler_api.config import settings
from humancompiler_api.exceptions import (
    general_exception_handler,
    http_exception_handler,
)
from humancompiler_api.main import cors_middleware


def make_request() -> Request:
    """Create a minimal request for exception handler tests."""
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "headers": [],
            "query_string": b"token=secret",
            "server": ("testserver", 80),
            "scheme": "http",
            "client": ("testclient", 50000),
        }
    )


@pytest.mark.asyncio
async def test_service_exception_handler_hides_plain_service_error_in_production(
    monkeypatch,
):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    response = await service_exception_handler(
        make_request(), ServiceError("postgres://user:password@internal/db failed")
    )

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert json.loads(response.body) == {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR",
    }


@pytest.mark.asyncio
async def test_service_exception_handler_maps_known_client_errors(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    not_found_response = await service_exception_handler(
        make_request(), ResourceNotFoundError("Task", "missing-id")
    )
    validation_response = await service_exception_handler(
        make_request(), ValidationError("Invalid input")
    )

    assert not_found_response.status_code == status.HTTP_404_NOT_FOUND
    assert validation_response.status_code == status.HTTP_400_BAD_REQUEST
    assert json.loads(not_found_response.body) == {
        "detail": "Task not found with ID: missing-id",
        "error_code": "RESOURCE_NOT_FOUND",
    }


@pytest.mark.asyncio
async def test_service_exception_handler_hides_external_error_in_production(
    monkeypatch,
):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    response = await service_exception_handler(
        make_request(),
        ExternalServiceError("postgres", "connection failed at internal-db:5432"),
    )

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert json.loads(response.body) == {
        "detail": "Service temporarily unavailable",
        "error_code": "EXTERNAL_SERVICE_ERROR",
    }


@pytest.mark.asyncio
async def test_http_exception_handler_hides_server_details_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    response = await http_exception_handler(
        make_request(),
        HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File not found: /app/src/secret.py",
        ),
    )

    assert json.loads(response.body) == {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR",
    }


@pytest.mark.asyncio
async def test_http_exception_handler_preserves_client_message_in_production(
    monkeypatch,
):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    response = await http_exception_handler(
        make_request(),
        HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        ),
    )

    assert json.loads(response.body) == {
        "detail": "Task not found",
        "error_code": None,
    }


@pytest.mark.asyncio
async def test_general_exception_handler_hides_diagnostics_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    response = await general_exception_handler(
        make_request(), RuntimeError("database password was exposed")
    )

    assert json.loads(response.body) == {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR",
    }


@pytest.mark.asyncio
async def test_general_exception_handler_includes_safe_debug_fields_in_development(
    monkeypatch,
):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "debug", True)

    response = await general_exception_handler(
        make_request(), RuntimeError("development diagnostic")
    )

    assert json.loads(response.body) == {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR",
        "path": "/test",
        "error_type": "RuntimeError",
        "debug_message": "development diagnostic",
    }


@pytest.mark.asyncio
async def test_cors_middleware_hides_unexpected_error_details_in_production(
    monkeypatch,
):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "debug", False)

    async def raise_internal_error(_request):
        raise RuntimeError("postgres://user:password@internal-db/app")

    response = await cors_middleware(make_request(), raise_internal_error)

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert json.loads(response.body) == {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR",
    }
