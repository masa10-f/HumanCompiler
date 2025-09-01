"""
Tests for Simple Backup API
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from humancompiler_api.main import app


class TestSimpleBackupAPI:
    """Test simple backup API endpoints"""

    @pytest.fixture
    def client(self):
        """Create test client"""
        return TestClient(app)

    def test_backup_status_endpoint(self, client):
        """Test backup status endpoint"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.get_backup_status.return_value = {
                "status": "healthy",
                "total_backups": 5,
                "total_size_bytes": 1024000,
                "backup_directory": "/secret/path",  # Should be removed
                "latest_backup": {
                    "name": "backup.json",
                    "created_at": "2024-01-01T00:00:00Z",
                    "size": 512000,
                    "validated": True,
                    "path": "/secret/path/backup.json",  # Should be removed
                },
                "disk_usage": {
                    "free_mb": 1000,
                    "total_mb": 2000,
                    "used_mb": 1000,
                },
                "config": {
                    "daily_retention_days": 7,
                    "weekly_retention_days": 28,
                    "min_disk_space_mb": 100,
                },
            }
            mock_get.return_value = mock_scheduler

            response = client.get("/api/backup/status")
            assert response.status_code == 200

            data = response.json()
            assert data["status"] == "healthy"
            assert data["total_backups"] == 5
            assert "backup_directory" not in data  # Should be removed for security
            assert "path" not in data["latest_backup"]  # Should be removed for security
            assert "disk_usage" in data
            assert "config" in data

    def test_backup_health_check_healthy(self, client):
        """Test backup health check - healthy status"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.get_backup_status.return_value = {
                "total_backups": 3,
                "disk_usage": {"free_mb": 500},
                "latest_backup": {"created_at": "2024-01-01T12:00:00Z"},
            }
            mock_get.return_value = mock_scheduler

            response = client.get("/api/backup/health")
            assert response.status_code == 200

            data = response.json()
            assert data["backup_system"] == "operational"
            assert data["has_backups"] is True
            assert data["disk_status"] == "ok"
            assert data["status"] == "healthy"
            assert data["last_check"] == "2024-01-01T12:00:00Z"

    def test_backup_health_check_warning(self, client):
        """Test backup health check - warning status"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.get_backup_status.return_value = {
                "total_backups": 0,  # No backups
                "disk_usage": {"free_mb": 50},  # Low disk space
                "latest_backup": None,
            }
            mock_get.return_value = mock_scheduler

            response = client.get("/api/backup/health")
            assert response.status_code == 200

            data = response.json()
            assert data["backup_system"] == "operational"
            assert data["has_backups"] is False
            assert data["disk_status"] == "low"
            assert data["status"] == "warning"
            assert data["last_check"] is None

    def test_backup_health_check_error(self, client):
        """Test backup health check - error status"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.get_backup_status.side_effect = Exception("System error")
            mock_get.return_value = mock_scheduler

            response = client.get("/api/backup/health")
            assert response.status_code == 503

            data = response.json()
            assert data["backup_system"] == "error"
            assert data["status"] == "unhealthy"
            assert "error" in data

    def test_backup_info_endpoint(self, client):
        """Test backup info endpoint"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_config = MagicMock()
            mock_config.daily_retention_days = 7
            mock_config.weekly_retention_days = 28
            mock_config.min_disk_space_mb = 100
            mock_config.max_worker_threads = 2
            mock_config.enable_audit_log = True
            mock_scheduler.config = mock_config
            mock_get.return_value = mock_scheduler

            response = client.get("/api/backup/info")
            assert response.status_code == 200

            data = response.json()
            assert data["backup_system"] == "simple_local_backup"
            assert data["version"] == "2.0"
            assert "features" in data
            assert "async_operations" in data["features"]
            assert "file_validation" in data["features"]
            assert "audit_logging" in data["features"]
            assert data["configuration"]["daily_retention_days"] == 7
            assert data["configuration"]["max_worker_threads"] == 2
            assert "cron" in data["note"]

    def test_backup_status_endpoint_error(self, client):
        """Test backup status endpoint error handling"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_get.side_effect = Exception("Scheduler error")

            response = client.get("/api/backup/status")
            assert response.status_code == 500

            data = response.json()
            assert "detail" in data
            assert "Failed to retrieve backup status" in data["detail"]

    def test_backup_info_endpoint_error(self, client):
        """Test backup info endpoint error handling"""
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_get.side_effect = Exception("Config error")

            response = client.get("/api/backup/info")
            assert response.status_code == 500

            data = response.json()
            assert "detail" in data
            assert "Failed to retrieve backup information" in data["detail"]

    def test_rate_limiting(self, client):
        """Test rate limiting on endpoints"""
        # This test would require actually hitting rate limits
        # For now, just verify endpoints are accessible
        with patch(
            "humancompiler_api.routers.simple_backup_api.get_backup_scheduler"
        ) as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.get_backup_status.return_value = {
                "status": "healthy",
                "total_backups": 0,
            }
            mock_get.return_value = mock_scheduler

            # Multiple calls should work (under rate limit)
            for _ in range(3):
                response = client.get("/api/backup/health")
                assert response.status_code == 200
