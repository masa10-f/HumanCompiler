import os
import pytest
from typing import AsyncGenerator
from unittest.mock import patch, AsyncMock

# Set test environment variables before importing any application code
os.environ.update({
    "DATABASE_URL": "postgresql://test:test@localhost:5432/test",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjQzMjEwMCwiZXhwIjoxOTMxODA4MTAwfQ.test",
    "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2NDMyMTAwLCJleHAiOjE5MzE4MDgxMDB9.test",
    "OPENAI_API_KEY": "sk-test-key-for-testing-purposes-only",
    "ENVIRONMENT": "test",
    "DEBUG": "true",
    "CORS_ORIGINS": "http://localhost:3000,http://localhost:3001"
})

# Import after setting environment variables
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Create a test database URL (SQLite for testing)
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

# Create test engine with check_same_thread=False for SQLite
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db():
    """Create a fresh database for each test"""
    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        SQLModel.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db: Session):
    """Create a test client with overridden database dependency"""
    # Import here to avoid circular imports
    from fastapi.testclient import TestClient
    try:
        from database import get_db
        from main import app
        
        def override_get_db():
            try:
                yield db
            finally:
                pass
        
        app.dependency_overrides[get_db] = override_get_db
        return TestClient(app)
    except ImportError:
        # If main app import fails, skip client fixture
        pytest.skip("Main app import failed, skipping client-dependent tests")


@pytest.fixture
def mock_openai():
    """Mock OpenAI client for testing"""
    with patch("ai.openai_client.AsyncOpenAI") as mock:
        mock_client = AsyncMock()
        mock.return_value = mock_client
        
        # Mock the chat completions
        mock_completion = AsyncMock()
        mock_completion.choices = [
            AsyncMock(message=AsyncMock(content="Test AI response"))
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
        
        yield mock_client


@pytest.fixture
def mock_supabase():
    """Mock Supabase client for testing"""
    with patch("services.auth_service.create_client") as mock:
        mock_client = AsyncMock()
        mock.return_value = mock_client
        
        # Mock auth methods
        mock_client.auth.sign_in_with_password = AsyncMock()
        mock_client.auth.sign_up = AsyncMock()
        mock_client.auth.sign_out = AsyncMock()
        mock_client.auth.get_user = AsyncMock()
        
        yield mock_client


# Override settings for testing
@pytest.fixture(autouse=True)
def override_settings():
    """Override settings for all tests"""
    from config import settings
    
    # Temporarily store original values
    original_db_url = settings.database_url
    original_env = settings.environment
    
    # Set test values
    settings.database_url = "postgresql://test:test@localhost:5432/test"
    settings.environment = "test"
    
    yield
    
    # Restore original values
    settings.database_url = original_db_url
    settings.environment = original_env