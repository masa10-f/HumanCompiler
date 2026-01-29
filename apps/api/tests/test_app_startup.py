# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
"""
App startup tests to catch import errors and router registration issues.

These tests verify that the FastAPI application can be imported and started
without errors, catching issues that might not be detected by linting or
type checking alone.
"""


class TestAppStartup:
    """Tests for application startup and module imports."""

    def test_app_imports_successfully(self):
        """Ensure the FastAPI app can be imported without errors."""
        from humancompiler_api.main import app

        assert app is not None
        assert hasattr(app, "routes")

    def test_models_importable(self):
        """Verify core model classes can be imported."""
        from humancompiler_api.models import (
            User,
            Project,
            Goal,
            Task,
        )

        assert User is not None
        assert Project is not None
        assert Goal is not None
        assert Task is not None

    def test_context_note_models_importable(self):
        """Verify context note models can be imported."""
        from humancompiler_api.models import (
            ContextNote,
            ContextNoteUpdate,
            ContextNoteResponse,
        )

        assert ContextNote is not None
        assert ContextNoteUpdate is not None
        assert ContextNoteResponse is not None

    def test_config_module_importable(self):
        """Verify config module can be imported."""
        from humancompiler_api.config import settings

        assert settings is not None


class TestRouterRegistration:
    """Tests for verifying router registration in the app."""

    def test_core_api_routes_registered(self):
        """Verify core API routes are registered."""
        from humancompiler_api.main import app

        route_paths = [route.path for route in app.routes]

        # Check core routes exist
        assert any("/api/projects" in path for path in route_paths)
        assert any("/api/goals" in path for path in route_paths)
        assert any("/api/tasks" in path for path in route_paths)

    def test_health_endpoint_registered(self):
        """Verify health check endpoint is registered."""
        from humancompiler_api.main import app

        route_paths = [route.path for route in app.routes]
        assert "/health" in route_paths

    def test_notes_routes_registered(self):
        """Verify notes routes are registered."""
        from humancompiler_api.main import app

        route_paths = [route.path for route in app.routes]

        # Notes routes should be registered
        assert any("/api/notes/projects" in path for path in route_paths)
        assert any("/api/notes/goals" in path for path in route_paths)
        assert any("/api/notes/tasks" in path for path in route_paths)
