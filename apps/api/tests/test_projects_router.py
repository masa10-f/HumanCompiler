"""
Tests for projects router
"""

from uuid import UUID
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser
from humancompiler_api.models import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectStatus,
    ErrorResponse,
    SortBy,
    SortOrder,
)
from humancompiler_api.routers.projects import (
    router,
    get_session,
    create_project,
    get_projects,
    get_project,
    update_project,
    delete_project,
)


@pytest.fixture
def mock_session():
    """Mock database session"""
    return Mock(spec=Session)


@pytest.fixture
def auth_user():
    """Mock authenticated user"""
    return AuthUser(
        user_id="87654321-4321-8765-4321-876543218765", email="test@example.com"
    )


@pytest.fixture
def project_create_data():
    """Mock project creation data"""
    return ProjectCreate(
        title="Test Project",
        description="Test description",
        status=ProjectStatus.PENDING,
    )


@pytest.fixture
def project_update_data():
    """Mock project update data"""
    return ProjectUpdate(title="Updated Project", description="Updated description")


@pytest.fixture
def mock_project():
    """Mock project object"""
    from datetime import datetime
    from decimal import Decimal

    project = Mock()
    project.id = UUID("12345678-1234-5678-1234-567812345678")
    project.title = "Test Project"
    project.description = "Test description"
    project.status = ProjectStatus.PENDING
    project.weekly_work_hours = Decimal("40")
    project.owner_id = UUID("87654321-4321-8765-4321-876543218765")
    project.created_at = datetime.now()
    project.updated_at = datetime.now()
    return project


def test_router_initialization():
    """Test router initialization"""
    assert router.prefix == "/projects"
    assert "projects" in router.tags


def test_get_session():
    """Test database session dependency"""
    with patch("humancompiler_api.routers.projects.db.get_engine") as mock_get_engine:
        mock_engine = Mock()
        mock_get_engine.return_value = mock_engine

        session_gen = get_session()
        # Test that generator is created
        assert session_gen is not None


@pytest.mark.asyncio
async def test_create_project_success(
    mock_session, auth_user, project_create_data, mock_project
):
    """Test successful project creation"""
    with patch(
        "humancompiler_api.routers.projects.project_service.create_project",
        return_value=mock_project,
    ):
        result = await create_project(project_create_data, mock_session, auth_user)

        assert isinstance(result, ProjectResponse)


@pytest.mark.asyncio
async def test_get_projects_success(mock_session, auth_user):
    """Test successful projects retrieval"""
    from datetime import datetime
    from decimal import Decimal

    mock_project = Mock()
    mock_project.id = UUID("12345678-1234-5678-1234-567812345678")
    mock_project.title = "Project 1"
    mock_project.description = "Test description"
    mock_project.status = ProjectStatus.PENDING
    mock_project.weekly_work_hours = Decimal("40")
    mock_project.owner_id = UUID("87654321-4321-8765-4321-876543218765")
    mock_project.created_at = datetime.now()
    mock_project.updated_at = datetime.now()
    mock_projects = [mock_project]

    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=mock_projects,
    ):
        result = await get_projects(mock_session, auth_user)

        assert isinstance(result, list)
        assert len(result) > 0


@pytest.mark.asyncio
async def test_get_projects_with_pagination(mock_session, auth_user):
    """Test projects retrieval with pagination"""
    mock_projects = []

    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=mock_projects,
    ):
        result = await get_projects(mock_session, auth_user, skip=10, limit=5)

        assert isinstance(result, list)


@pytest.mark.asyncio
async def test_get_projects_with_timing_logs(mock_session, auth_user):
    """Test projects retrieval includes timing logs"""
    from datetime import datetime
    from decimal import Decimal

    mock_project = Mock()
    mock_project.id = UUID("12345678-1234-5678-1234-567812345678")
    mock_project.title = "Project 1"
    mock_project.description = "Test description"
    mock_project.status = ProjectStatus.PENDING
    mock_project.weekly_work_hours = Decimal("40")
    mock_project.owner_id = UUID("87654321-4321-8765-4321-876543218765")
    mock_project.created_at = datetime.now()
    mock_project.updated_at = datetime.now()
    mock_projects = [mock_project]

    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=mock_projects,
    ):
        with patch("logging.getLogger") as mock_logger:
            mock_log_instance = Mock()
            mock_logger.return_value = mock_log_instance

            result = await get_projects(mock_session, auth_user)

            # Verify debug logging calls were made (changed from info to debug)
            assert mock_log_instance.debug.called
            assert "Getting projects for user" in str(
                mock_log_instance.debug.call_args_list[0]
            )


@pytest.mark.asyncio
async def test_get_projects_error_handling(mock_session, auth_user):
    """Test projects retrieval error handling"""
    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        side_effect=Exception("Database error"),
    ):
        with patch("logging.getLogger") as mock_logger:
            mock_log_instance = Mock()
            mock_logger.return_value = mock_log_instance

            with pytest.raises(Exception):
                await get_projects(mock_session, auth_user)

            # Verify error was logged
            mock_log_instance.error.assert_called()


@pytest.mark.asyncio
async def test_get_project_success(mock_session, auth_user, mock_project):
    """Test successful single project retrieval"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.get_project",
        return_value=mock_project,
    ):
        result = await get_project(project_id, mock_session, auth_user)

        assert isinstance(result, ProjectResponse)


@pytest.mark.asyncio
async def test_get_project_not_found(mock_session, auth_user):
    """Test project not found scenario"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.get_project",
        return_value=None,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_project(project_id, mock_session, auth_user)

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_update_project_success(
    mock_session, auth_user, project_update_data, mock_project
):
    """Test successful project update"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.update_project",
        return_value=mock_project,
    ):
        result = await update_project(
            project_id, project_update_data, mock_session, auth_user
        )

        assert isinstance(result, ProjectResponse)


@pytest.mark.asyncio
async def test_delete_project_success(mock_session, auth_user):
    """Test successful project deletion"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch("humancompiler_api.routers.projects.project_service.delete_project"):
        result = await delete_project(project_id, mock_session, auth_user)

        assert result is None  # Delete endpoint returns None


@pytest.mark.asyncio
async def test_delete_project_error(mock_session, auth_user):
    """Test project deletion error handling"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.delete_project",
        side_effect=Exception("Delete error"),
    ):
        with patch("logging.getLogger") as mock_logger:
            mock_log_instance = Mock()
            mock_logger.return_value = mock_log_instance

            with pytest.raises(HTTPException) as exc_info:
                await delete_project(project_id, mock_session, auth_user)

            assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
            # Verify error logging
            assert mock_log_instance.error.called


@pytest.mark.asyncio
async def test_create_project_service_call(
    mock_session, auth_user, project_create_data, mock_project
):
    """Test that create_project calls service with correct parameters"""
    with patch(
        "humancompiler_api.routers.projects.project_service.create_project",
        return_value=mock_project,
    ) as mock_create:
        await create_project(project_create_data, mock_session, auth_user)

        mock_create.assert_called_once_with(
            mock_session, project_create_data, auth_user.user_id
        )


@pytest.mark.asyncio
async def test_get_projects_service_call(mock_session, auth_user):
    """Test that get_projects calls service with correct parameters"""
    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=[],
    ) as mock_get:
        await get_projects(mock_session, auth_user, skip=5, limit=10)

        mock_get.assert_called_once_with(
            mock_session, auth_user.user_id, 5, 10, SortBy.STATUS, SortOrder.ASC
        )


@pytest.mark.asyncio
async def test_get_project_service_call(mock_session, auth_user, mock_project):
    """Test that get_project calls service with correct parameters"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.get_project",
        return_value=mock_project,
    ) as mock_get:
        await get_project(project_id, mock_session, auth_user)

        mock_get.assert_called_once_with(mock_session, project_id, auth_user.user_id)


@pytest.mark.asyncio
async def test_update_project_service_call(
    mock_session, auth_user, project_update_data, mock_project
):
    """Test that update_project calls service with correct parameters"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.update_project",
        return_value=mock_project,
    ) as mock_update:
        await update_project(project_id, project_update_data, mock_session, auth_user)

        mock_update.assert_called_once_with(
            mock_session, project_id, auth_user.user_id, project_update_data
        )


@pytest.mark.asyncio
async def test_delete_project_service_call(mock_session, auth_user):
    """Test that delete_project calls service with correct parameters"""
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    with patch(
        "humancompiler_api.routers.projects.project_service.delete_project"
    ) as mock_delete:
        await delete_project(project_id, mock_session, auth_user)

        mock_delete.assert_called_once_with(mock_session, project_id, auth_user.user_id)


def test_error_response_creation():
    """Test ErrorResponse creation in get_project"""
    # This tests the ErrorResponse.create call
    project_id = UUID("12345678-1234-5678-1234-567812345678")

    error = ErrorResponse.create(
        code="RESOURCE_NOT_FOUND",
        message="Project not found",
        details={"project_id": str(project_id)},
    )

    assert error.error.code == "RESOURCE_NOT_FOUND"
    assert error.error.message == "Project not found"
    assert error.error.details["project_id"] == str(project_id)


@pytest.mark.asyncio
async def test_get_projects_with_sorting_parameters(mock_session, auth_user):
    """Test projects retrieval with sorting parameters"""
    mock_projects = []

    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=mock_projects,
    ) as mock_get:
        result = await get_projects(
            mock_session,
            auth_user,
            skip=0,
            limit=20,
            sort_by=SortBy.STATUS,
            sort_order=SortOrder.DESC,
        )

        # Verify that the service was called with correct sorting parameters
        mock_get.assert_called_once_with(
            mock_session, auth_user.user_id, 0, 20, SortBy.STATUS, SortOrder.DESC
        )
        assert isinstance(result, list)


@pytest.mark.asyncio
async def test_get_projects_with_default_sorting(mock_session, auth_user):
    """Test projects retrieval with default sorting parameters"""
    mock_projects = []

    with patch(
        "humancompiler_api.routers.projects.project_service.get_projects",
        return_value=mock_projects,
    ) as mock_get:
        result = await get_projects(mock_session, auth_user)

        # Verify that the service was called with default sorting parameters
        mock_get.assert_called_once_with(
            mock_session, auth_user.user_id, 0, 20, SortBy.STATUS, SortOrder.ASC
        )
        assert isinstance(result, list)
