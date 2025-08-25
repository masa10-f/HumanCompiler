from fastapi.testclient import TestClient

from humancompiler_api.main import app

client = TestClient(app)


def test_root_endpoint():
    """Test root endpoint"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "status" in data
    assert data["message"] == "HumanCompiler API"
    assert data["status"] == "active"


def test_health_endpoint():
    """Test health check endpoint"""
    response = client.get("/health")
    # Health check may return 503 if database is disconnected in test environment
    assert response.status_code in [200, 503]
    data = response.json()
    assert "status" in data
    assert "message" in data

    # Check response content based on status code
    if response.status_code == 200:
        assert data["status"] == "healthy"
        assert data["message"] == "OK"
    else:
        assert data["status"] == "unhealthy"
        assert data["message"] == "Service temporarily unavailable"


def test_openapi_docs():
    """Test that OpenAPI docs are accessible"""
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_json():
    """Test that OpenAPI JSON is accessible"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
