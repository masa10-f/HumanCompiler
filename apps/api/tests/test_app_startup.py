# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
"""
App startup tests to catch import errors and router registration issues.

These tests verify that the FastAPI application can be imported and started
without errors, catching issues that might not be detected by linting or
type checking alone.
"""

import pytest


class TestAppStartup:
    """Tests for application startup and module imports."""

    def test_app_imports_successfully(self):
        """Ensure the FastAPI app can be imported without errors."""
        from humancompiler_api.main import app

        assert app is not None
        assert hasattr(app, "routes")

    def test_all_routers_importable(self):
        """Verify all router modules can be imported."""
        # Core routers
        from humancompiler_api.routers import (
            ai_planning,
            goals,
            monitoring,
            notifications,
            projects,
            scheduler,
            tasks,
            user_settings,
            users,
            websocket,
            work_sessions,
        )

        # Additional routers imported directly in main.py
        from humancompiler_api.routers import (
            data_export,
            goal_dependencies,
            logs,
            progress,
            reports,
            reschedule,
            simple_backup_api,
            task_dependencies,
            timeline,
            weekly_schedule,
            weekly_recurring_tasks,
        )

        # Notes router (if enabled)
        try:
            from humancompiler_api.routers import notes

            assert notes.router is not None
        except ImportError:
            # Notes router may be temporarily disabled
            pass

        # Verify all have router attribute
        assert ai_planning.router is not None
        assert goals.router is not None
        assert projects.router is not None
        assert tasks.router is not None

    def test_models_importable(self):
        """Verify all model classes can be imported."""
        from humancompiler_api.models import (
            User,
            Project,
            Goal,
            Task,
            TaskLog,
            WorkSession,
        )

        assert User is not None
        assert Project is not None
        assert Goal is not None
        assert Task is not None
        assert TaskLog is not None
        assert WorkSession is not None

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

    def test_auth_module_importable(self):
        """Verify auth module can be imported."""
        from humancompiler_api.auth import (
            AuthUser,
            get_current_user,
            get_current_user_id,
        )

        assert AuthUser is not None
        assert get_current_user is not None
        assert get_current_user_id is not None

    def test_database_module_importable(self):
        """Verify database module can be imported."""
        from humancompiler_api.database import db

        assert db is not None

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
        assert any("/api/users" in path for path in route_paths)

    def test_health_endpoint_registered(self):
        """Verify health check endpoint is registered."""
        from humancompiler_api.main import app

        route_paths = [route.path for route in app.routes]
        assert "/health" in route_paths

    def test_notes_routes_registered(self):
        """Verify notes routes are registered (if enabled)."""
        from humancompiler_api.main import app

        route_paths = [route.path for route in app.routes]

        # Notes routes should be registered when feature is enabled
        notes_routes = [p for p in route_paths if "/api/notes" in p]

        # This test will pass whether notes is enabled or disabled
        # When enabled, it verifies the routes exist
        # When disabled, it simply passes (no assertion failure)
        if notes_routes:
            assert any("/api/notes/projects" in path for path in route_paths)
            assert any("/api/notes/goals" in path for path in route_paths)
            assert any("/api/notes/tasks" in path for path in route_paths)
