"""
Common error handling utilities
"""

import logging
from typing import Optional, Union
from uuid import UUID

from fastapi import HTTPException, status
from sqlmodel import Session

logger = logging.getLogger(__name__)


class ServiceError(Exception):
    """Base exception for service-layer errors"""
    def __init__(self, message: str, error_code: Optional[str] = None):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


class ResourceNotFoundError(ServiceError):
    """Raised when a requested resource is not found"""
    def __init__(self, resource_type: str, resource_id: Union[str, UUID]):
        message = f"{resource_type} with ID {resource_id} not found"
        super().__init__(message, "RESOURCE_NOT_FOUND")


class ValidationError(ServiceError):
    """Raised when validation fails"""
    def __init__(self, message: str, field: Optional[str] = None):
        self.field = field
        super().__init__(message, "VALIDATION_ERROR")


class AuthorizationError(ServiceError):
    """Raised when user is not authorized to access a resource"""
    def __init__(self, resource_type: str, action: str = "access"):
        message = f"Not authorized to {action} {resource_type}"
        super().__init__(message, "AUTHORIZATION_ERROR")


class ExternalServiceError(ServiceError):
    """Raised when external service (e.g., OpenAI) fails"""
    def __init__(self, service_name: str, message: str):
        full_message = f"{service_name} service error: {message}"
        super().__init__(full_message, "EXTERNAL_SERVICE_ERROR")


def handle_service_error(error: Exception) -> HTTPException:
    """Convert service errors to HTTP exceptions"""
    if isinstance(error, ResourceNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=error.message
        )
    elif isinstance(error, ValidationError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error.message
        )
    elif isinstance(error, AuthorizationError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=error.message
        )
    elif isinstance(error, ExternalServiceError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.message
        )
    else:
        logger.error(f"Unhandled service error: {error}")
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


def safe_execute(session: Session, operation, rollback_on_error: bool = True):
    """Safely execute database operations with error handling"""
    try:
        result = operation()
        session.commit()
        return result
    except Exception as e:
        if rollback_on_error:
            session.rollback()
        
        # Log the error
        logger.error(f"Database operation failed: {e}")
        
        # Re-raise as service error
        if "not found" in str(e).lower():
            raise ResourceNotFoundError("Resource", "unknown")
        elif "constraint" in str(e).lower():
            raise ValidationError("Database constraint violation")
        else:
            raise ServiceError(f"Database operation failed: {str(e)}")


def validate_uuid(value: Union[str, UUID], name: str) -> UUID:
    """Validate UUID format"""
    if isinstance(value, UUID):
        return value
    
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        raise ValidationError(f"Invalid UUID format for {name}: {value}")


def check_resource_ownership(resource, user_id: Union[str, UUID], resource_type: str):
    """Check if user owns the resource"""
    if not resource:
        raise ResourceNotFoundError(resource_type, "unknown")
    
    resource_owner_id = getattr(resource, 'owner_id', None)
    if resource_owner_id and str(resource_owner_id) != str(user_id):
        raise AuthorizationError(resource_type)
    
    return resource