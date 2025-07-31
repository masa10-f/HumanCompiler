"""
Tests for base service functionality
"""

from uuid import uuid4

import pytest
from sqlmodel import Session, SQLModel, create_engine

from taskagent_api.base_service import BaseService
from taskagent_api.common.error_handlers import ResourceNotFoundError, ValidationError
from taskagent_api.models import Project, ProjectCreate, ProjectUpdate


def create_test_project_service():
    """Factory function to create test service instance"""

    class TestProjectService(BaseService[Project, ProjectCreate, ProjectUpdate]):
        """Test service implementation"""

        def __init__(self):
            super().__init__(Project)

        def _create_instance(self, data: ProjectCreate, user_id, **kwargs) -> Project:
            return Project(
                owner_id=user_id,
                title=data.title,
                description=data.description,
            )

        def _get_user_filter(self, user_id):
            return Project.owner_id == user_id

    return TestProjectService()


@pytest.fixture
def memory_db():
    """Create in-memory SQLite database for testing"""
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    yield engine
    # Properly dispose of the engine after use
    engine.dispose()


@pytest.fixture
def session(memory_db):
    """Create database session"""
    with Session(memory_db) as session:
        yield session


@pytest.fixture
def service():
    """Create test service instance"""
    return create_test_project_service()


@pytest.fixture
def user_id():
    """Test user ID"""
    return uuid4()


@pytest.fixture
def project_data():
    """Test project data"""
    return ProjectCreate(title="Test Project", description="Test Description")


def test_create_project(service, session, user_id, project_data):
    """Test creating a project"""
    project = service.create(session, project_data, user_id)

    assert project.id is not None
    assert project.title == "Test Project"
    assert project.description == "Test Description"
    assert project.owner_id == user_id


def test_get_by_id_existing(service, session, user_id, project_data):
    """Test getting existing project by ID"""
    # Create project
    created_project = service.create(session, project_data, user_id)

    # Get project
    retrieved_project = service.get_by_id(session, created_project.id, user_id)

    assert retrieved_project.id == created_project.id
    assert retrieved_project.title == created_project.title


def test_get_by_id_not_found(service, session, user_id):
    """Test getting non-existent project"""
    non_existent_id = uuid4()

    with pytest.raises(ResourceNotFoundError):
        service.get_by_id(session, non_existent_id, user_id)


def test_get_by_id_different_user(service, session, user_id, project_data):
    """Test getting project with different user ID"""
    # Create project with user_id
    created_project = service.create(session, project_data, user_id)

    # Try to get with different user ID
    different_user_id = uuid4()

    with pytest.raises(ResourceNotFoundError):
        service.get_by_id(session, created_project.id, different_user_id)


def test_update_project(service, session, user_id, project_data):
    """Test updating a project"""
    # Create project
    created_project = service.create(session, project_data, user_id)

    # Update project
    update_data = ProjectUpdate(title="Updated Title")
    updated_project = service.update(session, created_project.id, update_data, user_id)

    assert updated_project.title == "Updated Title"
    assert updated_project.description == "Test Description"  # Should remain unchanged


def test_delete_project(service, session, user_id, project_data):
    """Test deleting a project"""
    # Create project
    created_project = service.create(session, project_data, user_id)

    # Delete project
    result = service.delete(session, created_project.id, user_id)

    assert result is True

    # Verify project is deleted
    with pytest.raises(ResourceNotFoundError):
        service.get_by_id(session, created_project.id, user_id)


def test_invalid_uuid(service, session, user_id):
    """Test handling invalid UUID format"""
    with pytest.raises(ValidationError):
        service.get_by_id(session, "invalid-uuid", user_id)
