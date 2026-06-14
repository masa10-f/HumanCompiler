import json

import pytest
from fastapi import status
from starlette.requests import Request

from humancompiler_api.common.error_handlers import (
    ResourceNotFoundError,
    ServiceError,
    ValidationError,
    service_exception_handler,
)


def make_request() -> Request:
    """Create a minimal request for exception handler tests."""
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "headers": [],
            "query_string": b"",
            "server": ("testserver", 80),
            "scheme": "http",
            "client": ("testclient", 50000),
        }
    )


@pytest.mark.asyncio
async def test_service_exception_handler_returns_500_for_plain_service_error():
    response = await service_exception_handler(
        make_request(), ServiceError("Database operation failed")
    )

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert json.loads(response.body)["detail"] == "Database operation failed"


@pytest.mark.asyncio
async def test_service_exception_handler_maps_known_client_errors():
    not_found_response = await service_exception_handler(
        make_request(), ResourceNotFoundError("Task", "missing-id")
    )
    validation_response = await service_exception_handler(
        make_request(), ValidationError("Invalid input")
    )

    assert not_found_response.status_code == status.HTTP_404_NOT_FOUND
    assert validation_response.status_code == status.HTTP_400_BAD_REQUEST
