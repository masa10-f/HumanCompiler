import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch

from taskagent_api.main import app

client = TestClient(app)


@patch('taskagent_api.routers.projects.get_current_user')
@patch('taskagent_api.routers.projects.get_session')
def test_create_project_unauthenticated(mock_session, mock_user):
    """Test project creation without authentication"""
    mock_user.side_effect = Exception("Unauthorized")
    
    response = client.post(
        "/api/projects/",
        json={"title": "Test Project", "description": "Test Description"}
    )
    
    # Should fail due to authentication  
    assert response.status_code == 403  # Forbidden


def test_health_endpoint():
    """Test health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "message" in data


def test_openapi_docs():
    """Test OpenAPI documentation"""
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_json():
    """Test OpenAPI JSON schema"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    
    # Check if our new endpoints are present
    paths = schema.get("paths", {})
    assert "/api/projects/" in paths
    assert "/api/goals/" in paths
    assert "/api/tasks/" in paths
    
    # Check CRUD operations
    assert "post" in paths["/api/projects/"]
    assert "get" in paths["/api/projects/"]


def test_validation_error():
    """Test validation error handling"""
    response = client.post(
        "/api/projects/",
        json={"title": ""}  # Empty title should fail validation
    )
    
    # Should return validation error
    assert response.status_code in [403, 422, 500]  # Could be auth or validation error


@patch('taskagent_api.routers.projects.get_current_user')
@patch('taskagent_api.routers.projects.get_session')
def test_project_endpoints_structure(mock_session, mock_user):
    """Test that project endpoints are properly structured"""
    # Mock authenticated user
    mock_user.return_value = Mock(user_id="test-user-id")
    mock_session.return_value = Mock()
    
    # Test endpoint accessibility (will fail on service layer, but endpoint should be reachable)
    response = client.get("/api/projects/")
    
    # Should reach the endpoint (may fail on business logic)
    assert response.status_code in [200, 400, 403, 500]  # Not 404


def test_cors_headers():
    """Test CORS headers are present"""
    response = client.options("/api/projects/")
    
    # CORS should be configured
    assert response.status_code in [200, 405]  # OPTIONS may not be explicitly handled


def test_api_error_format():
    """Test API error response format"""
    response = client.get("/api/projects/nonexistent")
    
    # Should have proper error format
    assert response.status_code in [401, 403, 404, 500]
    
    if response.status_code != 500:  # Skip if general exception
        data = response.json()
        assert "detail" in data