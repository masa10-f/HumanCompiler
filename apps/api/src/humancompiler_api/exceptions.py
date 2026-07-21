import logging
from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from humancompiler_api.config import settings

logger = logging.getLogger(__name__)


def include_debug_error_details() -> bool:
    """Return whether diagnostic fields may be exposed to API clients."""
    return settings.environment == "development" and settings.debug


def build_error_content(
    *,
    detail: Any,
    error_code: str | None,
    request: Request | None = None,
    exception: Exception | None = None,
) -> dict[str, Any]:
    """Build an error payload without exposing diagnostics outside local debug mode."""
    content: dict[str, Any] = {
        "detail": detail,
        "error_code": error_code,
    }

    if include_debug_error_details():
        if request is not None:
            # Keep query parameters out of responses even in development because they
            # can contain tokens or other credentials.
            content["path"] = request.url.path
        if exception is not None:
            content["error_type"] = type(exception).__name__
            content["debug_message"] = str(exception) or "No details available"

    return content


def _log_server_error(request: Request, exc: Exception) -> None:
    logger.error(
        "Unhandled error during %s %s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )


class HumanCompilerException(Exception):
    """Base exception for HumanCompiler API"""

    def __init__(self, message: str, error_code: str | None = None):
        self.message = message
        self.error_code = error_code
        super().__init__(message)


class ResourceNotFoundError(HumanCompilerException):
    """Resource not found exception"""

    def __init__(self, resource_type: str, resource_id: str | None = None):
        message = f"{resource_type} not found"
        if resource_id:
            message += f" with ID: {resource_id}"
        super().__init__(message, "RESOURCE_NOT_FOUND")


class UnauthorizedError(HumanCompilerException):
    """Unauthorized access exception"""

    def __init__(self, message: str = "Unauthorized access"):
        super().__init__(message, "UNAUTHORIZED")


class ValidationError(HumanCompilerException):
    """Validation error exception"""

    def __init__(self, message: str, field: str | None = None):
        if field:
            message = f"Validation error for field '{field}': {message}"
        super().__init__(message, "VALIDATION_ERROR")


# Aliases for common exception names
NotFoundError = ResourceNotFoundError
# Backwards compatibility alias
TaskAgentException = HumanCompilerException


async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions"""
    is_server_error = exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR
    if is_server_error:
        _log_server_error(request, exc)

    detail = exc.detail
    if is_server_error and not include_debug_error_details():
        detail = "Internal server error"

    return JSONResponse(
        status_code=exc.status_code,
        content=build_error_content(
            detail=detail,
            error_code=getattr(exc, "error_code", None)
            or ("INTERNAL_ERROR" if is_server_error else None),
            request=request,
        ),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle request validation errors"""
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "field": " -> ".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

    content = build_error_content(
        detail="Request validation failed",
        error_code="VALIDATION_ERROR",
        request=request,
    )
    content["errors"] = errors
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=content
    )


async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    """Handle Pydantic validation errors"""
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "field": " -> ".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

    content = build_error_content(
        detail="Data validation failed",
        error_code="VALIDATION_ERROR",
        request=request,
    )
    content["errors"] = errors
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=content
    )


async def humancompiler_exception_handler(
    request: Request, exc: HumanCompilerException
):
    """Handle custom HumanCompiler exceptions"""
    status_code = status.HTTP_400_BAD_REQUEST

    if isinstance(exc, ResourceNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, UnauthorizedError):
        status_code = status.HTTP_401_UNAUTHORIZED
    elif isinstance(exc, ValidationError):
        status_code = status.HTTP_422_UNPROCESSABLE_ENTITY

    return JSONResponse(
        status_code=status_code,
        content=build_error_content(
            detail=exc.message,
            error_code=exc.error_code,
            request=request,
        ),
    )


async def general_exception_handler(request: Request, exc: Exception):
    """Handle general exceptions"""
    _log_server_error(request, exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=build_error_content(
            detail="Internal server error",
            error_code="INTERNAL_ERROR",
            request=request,
            exception=exc,
        ),
    )
