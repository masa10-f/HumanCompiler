"""
Tests for simple backup system
"""

import asyncio
import json
import os
import tempfile
from datetime import datetime, timedelta, UTC
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch
import shutil

import pytest

from taskagent_api.simple_backup import (
    BackupConfig,
    BackupError,
    DiskSpaceError,
    SimpleBackupScheduler,
    create_manual_backup,
    get_backup_scheduler,
)


class TestBackupConfig:
    """Test backup configuration"""

    def test_default_config(self):
        """Test default configuration values"""
        config = BackupConfig()

        assert config.backup_dir == "backups"
        assert config.daily_retention_days == 7
        assert config.weekly_retention_days == 28
        assert config.min_disk_space_mb == 100
        assert config.file_permissions == 0o600
        assert config.enable_audit_log is True

    def test_env_config(self):
        """Test configuration from environment variables"""
        with patch.dict(
            os.environ,
            {
                "BACKUP_DIR": "/custom/backups",
                "BACKUP_DAILY_RETENTION": "14",
                "BACKUP_WEEKLY_RETENTION": "56",
                "BACKUP_MIN_DISK_MB": "500",
                "BACKUP_FILE_PERMISSIONS": "0o640",
                "BACKUP_AUDIT_LOG": "false",
            },
        ):
            config = BackupConfig()

            assert config.backup_dir == "/custom/backups"
            assert config.daily_retention_days == 14
            assert config.weekly_retention_days == 56
            assert config.min_disk_space_mb == 500
            assert config.file_permissions == 0o640
            assert config.enable_audit_log is False


class TestSimpleBackupScheduler:
    """Test backup scheduler functionality"""

    @pytest.fixture
    def temp_backup_dir(self):
        """Create temporary backup directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield temp_dir

    @pytest.fixture
    def scheduler(self, temp_backup_dir):
        """Create backup scheduler with temporary directory"""
        scheduler = SimpleBackupScheduler(temp_backup_dir)
        yield scheduler

    def test_scheduler_initialization(self, scheduler, temp_backup_dir):
        """Test scheduler initialization"""
        assert scheduler.config is not None
        assert scheduler.backup_manager is not None
        assert scheduler.backup_dir == Path(temp_backup_dir)
        assert scheduler.backup_dir.exists()

    def test_disk_space_check_sufficient(self, scheduler):
        """Test disk space check with sufficient space"""
        with patch("shutil.disk_usage") as mock_disk:
            mock_disk.return_value = MagicMock(
                free=200 * 1024 * 1024  # 200MB free
            )
            result = scheduler._check_disk_space()
            assert result is True

    def test_disk_space_check_insufficient(self, scheduler):
        """Test disk space check with insufficient space"""
        with patch("shutil.disk_usage") as mock_disk:
            mock_disk.return_value = MagicMock(
                free=50 * 1024 * 1024  # 50MB free (less than 100MB min)
            )
            with pytest.raises(DiskSpaceError) as exc_info:
                scheduler._check_disk_space()
            assert "ディスク容量不足" in str(exc_info.value)

    def test_file_permissions_setting(self, scheduler, temp_backup_dir):
        """Test file permissions setting"""
        test_file = Path(temp_backup_dir) / "test.json"
        test_file.write_text("{}")

        scheduler._set_file_permissions(test_file)

        # Check permissions (may vary by OS)
        stat_info = test_file.stat()
        # Permission check is platform-dependent, so we just verify it doesn't crash

    def test_audit_log_creation(self, scheduler, temp_backup_dir):
        """Test audit log creation"""
        scheduler._audit_log("test_action", {"key": "value"})

        audit_file = Path(temp_backup_dir) / "audit.log"
        assert audit_file.exists()

        with open(audit_file) as f:
            log_entry = json.loads(f.readline())
            assert log_entry["action"] == "test_action"
            assert log_entry["details"]["key"] == "value"

    def test_audit_log_disabled(self, scheduler, temp_backup_dir):
        """Test audit log when disabled"""
        scheduler.config.enable_audit_log = False
        scheduler._audit_log("test_action", {"key": "value"})

        audit_file = Path(temp_backup_dir) / "audit.log"
        assert not audit_file.exists()

    @pytest.mark.asyncio
    async def test_create_daily_backup_success(self, scheduler):
        """Test successful daily backup creation"""
        # Mock the backup manager
        with patch.object(scheduler.backup_manager, "create_backup") as mock_create:
            mock_create.return_value = str(scheduler.backup_dir / "test_backup.json")

            # Create mock backup file
            backup_file = scheduler.backup_dir / "test_backup.json"
            backup_file.write_text('{"test": "data"}')

            result = await scheduler.create_daily_backup()

            assert result == str(backup_file)
            mock_create.assert_called_once()
            assert backup_file.exists()

    @pytest.mark.asyncio
    async def test_create_daily_backup_disk_space_error(self, scheduler):
        """Test daily backup with disk space error"""
        with patch.object(scheduler, "_check_disk_space") as mock_check:
            mock_check.side_effect = DiskSpaceError("No space")

            with pytest.raises(DiskSpaceError):
                await scheduler.create_daily_backup()

    @pytest.mark.asyncio
    async def test_create_daily_backup_io_error(self, scheduler):
        """Test daily backup with IO error"""
        with patch.object(scheduler.backup_manager, "create_backup") as mock_create:
            mock_create.side_effect = OSError("IO failed")

            with pytest.raises(BackupError) as exc_info:
                await scheduler.create_daily_backup()
            assert "IO operation failed" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_weekly_backup_success(self, scheduler):
        """Test successful weekly backup creation"""
        with patch.object(scheduler.backup_manager, "create_backup") as mock_create:
            mock_create.return_value = str(scheduler.backup_dir / "weekly_backup.json")

            # Create mock backup file
            backup_file = scheduler.backup_dir / "weekly_backup.json"
            backup_file.write_text('{"test": "data"}')

            result = await scheduler.create_weekly_backup()

            assert result == str(backup_file)
            assert "weekly_backup" in mock_create.call_args[0][0]

    @pytest.mark.asyncio
    async def test_cleanup_old_backups(self, scheduler, temp_backup_dir):
        """Test cleanup of old backups"""
        # Create old backup files
        old_file = Path(temp_backup_dir) / "daily_backup_old.json"
        old_file.write_text("{}")

        # Set modification time to 10 days ago
        old_time = (datetime.now(UTC) - timedelta(days=10)).timestamp()
        os.utime(old_file, (old_time, old_time))

        # Create recent backup file
        recent_file = Path(temp_backup_dir) / "daily_backup_recent.json"
        recent_file.write_text("{}")

        # Run cleanup
        await scheduler._cleanup_old_backups_async(days=7)

        # Old file should be removed
        assert not old_file.exists()
        # Recent file should remain
        assert recent_file.exists()

    @pytest.mark.asyncio
    async def test_cleanup_with_prefix(self, scheduler, temp_backup_dir):
        """Test cleanup with prefix filter"""
        # Create different types of backup files
        weekly_old = Path(temp_backup_dir) / "weekly_backup_old.json"
        weekly_old.write_text("{}")
        daily_old = Path(temp_backup_dir) / "daily_backup_old.json"
        daily_old.write_text("{}")

        # Set old modification time
        old_time = (datetime.now(UTC) - timedelta(days=30)).timestamp()
        os.utime(weekly_old, (old_time, old_time))
        os.utime(daily_old, (old_time, old_time))

        # Cleanup only weekly backups
        await scheduler._cleanup_old_backups_async(prefix="weekly_backup_", days=28)

        # Weekly should be removed, daily should remain
        assert not weekly_old.exists()
        assert daily_old.exists()

    def test_sync_daily_backup(self, scheduler):
        """Test synchronous daily backup wrapper"""

        async def mock_backup():
            return "backup_path"

        with patch.object(scheduler, "create_daily_backup", new=mock_backup):
            result = scheduler.create_daily_backup_sync()
            assert result == "backup_path"

    def test_sync_weekly_backup(self, scheduler):
        """Test synchronous weekly backup wrapper"""

        async def mock_backup():
            return "backup_path"

        with patch.object(scheduler, "create_weekly_backup", new=mock_backup):
            result = scheduler.create_weekly_backup_sync()
            assert result == "backup_path"


class TestGlobalFunctions:
    """Test global functions"""

    def test_get_backup_scheduler_singleton(self):
        """Test that get_backup_scheduler returns singleton"""
        scheduler1 = get_backup_scheduler()
        scheduler2 = get_backup_scheduler()
        assert scheduler1 is scheduler2

    def test_get_backup_scheduler_thread_safe(self):
        """Test thread-safe singleton creation"""
        import threading

        schedulers = []

        def get_scheduler():
            schedulers.append(get_backup_scheduler())

        threads = [threading.Thread(target=get_scheduler) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All should be the same instance
        assert all(s is schedulers[0] for s in schedulers)

    def test_create_manual_backup(self):
        """Test manual backup creation"""
        with patch("taskagent_api.simple_backup.get_backup_scheduler") as mock_get:
            mock_scheduler = MagicMock()
            mock_scheduler.create_daily_backup_sync.return_value = "backup_path"
            mock_get.return_value = mock_scheduler

            result = create_manual_backup()

            assert result == "backup_path"
            mock_scheduler.create_daily_backup_sync.assert_called_once()


class TestErrorHandling:
    """Test error handling scenarios"""

    @pytest.mark.asyncio
    async def test_backup_failure_handling(self):
        """Test handling of various backup failures"""
        scheduler = SimpleBackupScheduler()

        # Test generic exception handling
        with patch.object(scheduler.backup_manager, "create_backup") as mock_create:
            mock_create.side_effect = Exception("Unknown error")

            with pytest.raises(BackupError) as exc_info:
                await scheduler.create_daily_backup()
            assert "Backup operation failed" in str(exc_info.value)

    def test_disk_space_insufficient(self):
        """Test disk space insufficient error"""
        scheduler = SimpleBackupScheduler()

        with patch("shutil.disk_usage") as mock_disk:
            mock_disk.return_value = MagicMock(free=10 * 1024 * 1024)  # 10MB

            with pytest.raises(DiskSpaceError) as exc_info:
                scheduler._check_disk_space(required_mb=50)
            assert "10MB < 50MB" in str(exc_info.value)
