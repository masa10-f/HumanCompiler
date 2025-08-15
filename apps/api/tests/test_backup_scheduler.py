"""
Tests for backup scheduler functionality
"""

import asyncio
import json
import tempfile
from datetime import datetime, UTC
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from taskagent_api.backup_scheduler import (
    BackupConfig,
    BackupScheduler,
    BackupStatus,
    BackupRecord,
    create_manual_backup,
)
from taskagent_api.main import app


class TestBackupConfig:
    """Test backup configuration"""
    
    def test_default_config(self):
        """Test default configuration values"""
        config = BackupConfig()
        
        assert config.backup_interval_hours == 6
        assert config.daily_backup_time == "02:00"
        assert config.weekly_backup_day == 0
        assert config.keep_hourly_backups == 24
        assert config.keep_daily_backups == 30
        assert config.keep_weekly_backups == 12
        assert config.keep_monthly_backups == 12
        assert config.max_backup_size_mb == 500
        assert config.alert_on_failure == True
        assert config.email_alerts_enabled == False
    
    def test_custom_config(self):
        """Test custom configuration"""
        config = BackupConfig(
            backup_interval_hours=12,
            daily_backup_time="03:30",
            keep_hourly_backups=48,
            email_alerts_enabled=True,
            email_recipients=["admin@test.com"]
        )
        
        assert config.backup_interval_hours == 12
        assert config.daily_backup_time == "03:30"
        assert config.keep_hourly_backups == 48
        assert config.email_alerts_enabled == True
        assert config.email_recipients == ["admin@test.com"]


class TestBackupRecord:
    """Test backup record functionality"""
    
    def test_backup_record_creation(self):
        """Test creating a backup record"""
        timestamp = datetime.now(UTC)
        record = BackupRecord(
            timestamp=timestamp,
            backup_path="/test/backup.json",
            file_size_bytes=1024,
            status=BackupStatus.SUCCESS,
            backup_type="manual",
            duration_seconds=2.5,
            tables_backed_up={"users": 10, "projects": 5}
        )
        
        assert record.timestamp == timestamp
        assert record.backup_path == "/test/backup.json"
        assert record.file_size_bytes == 1024
        assert record.status == BackupStatus.SUCCESS
        assert record.backup_type == "manual"
        assert record.duration_seconds == 2.5
        assert record.tables_backed_up == {"users": 10, "projects": 5}


class TestBackupScheduler:
    """Test backup scheduler functionality"""
    
    @pytest.fixture
    def temp_backup_dir(self):
        """Create temporary backup directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield temp_dir
    
    @pytest.fixture
    def scheduler(self, temp_backup_dir):
        """Create backup scheduler with temporary directory"""
        config = BackupConfig(local_backup_dir=temp_backup_dir)
        scheduler = BackupScheduler(config)
        yield scheduler
        if scheduler.is_running:
            scheduler.stop()
    
    def test_scheduler_initialization(self, scheduler):
        """Test scheduler initialization"""
        assert scheduler.config is not None
        assert scheduler.backup_manager is not None
        assert scheduler.scheduler is not None
        assert not scheduler.is_running
        assert scheduler.backup_history == []
    
    def test_start_stop_scheduler(self, scheduler):
        """Test starting and stopping the scheduler"""
        # Start scheduler
        scheduler.start()
        assert scheduler.is_running
        
        # Stop scheduler
        scheduler.stop()
        assert not scheduler.is_running
    
    @pytest.mark.asyncio
    async def test_create_backup_success(self, scheduler):
        """Test successful backup creation"""
        # Mock the backup manager
        with patch.object(scheduler.backup_manager, 'create_backup') as mock_create:
            mock_create.return_value = "/tmp/test_backup.json"
            
            # Create mock backup file
            backup_path = Path("/tmp/test_backup.json")
            backup_data = {
                "users": [{"id": 1, "email": "test@test.com"}],
                "projects": [],
                "goals": [],
                "tasks": [],
                "metadata": {
                    "created_at": "2024-01-01T00:00:00Z",
                    "total_records": {"users": 1, "projects": 0, "goals": 0, "tasks": 0}
                }
            }
            
            with patch('pathlib.Path.stat') as mock_stat:
                mock_stat.return_value.st_size = 1024
                
                with patch('builtins.open', mock_open_with_json(backup_data)):
                    record = await scheduler.create_backup("test")
                    
                    assert record.status == BackupStatus.SUCCESS
                    assert record.backup_type == "test"
                    assert record.file_size_bytes == 1024
                    assert record.tables_backed_up == {"users": 1, "projects": 0, "goals": 0, "tasks": 0}
                    assert len(scheduler.backup_history) == 1
    
    @pytest.mark.asyncio
    async def test_create_backup_failure(self, scheduler):
        """Test backup creation failure"""
        # Mock the backup manager to raise an exception
        with patch.object(scheduler.backup_manager, 'create_backup') as mock_create:
            mock_create.side_effect = Exception("Backup failed")
            
            with pytest.raises(Exception, match="Backup failed"):
                await scheduler.create_backup("test")
            
            # Check that failure was recorded
            assert len(scheduler.backup_history) == 1
            record = scheduler.backup_history[0]
            assert record.status == BackupStatus.FAILED
            assert record.error_message == "Backup failed"
    
    def test_backup_history_save_load(self, scheduler):
        """Test saving and loading backup history"""
        # Create sample backup record
        record = BackupRecord(
            timestamp=datetime.now(UTC),
            backup_path="/test/backup.json",
            file_size_bytes=1024,
            status=BackupStatus.SUCCESS,
            backup_type="manual",
            duration_seconds=2.5,
            tables_backed_up={"users": 10}
        )
        
        scheduler.backup_history.append(record)
        scheduler._save_backup_history()
        
        # Create new scheduler and verify history is loaded
        new_scheduler = BackupScheduler(scheduler.config)
        assert len(new_scheduler.backup_history) == 1
        loaded_record = new_scheduler.backup_history[0]
        assert loaded_record.backup_path == record.backup_path
        assert loaded_record.status == record.status
        assert loaded_record.backup_type == record.backup_type
    
    def test_cleanup_old_backups(self, scheduler):
        """Test cleanup of old backups"""
        # Create old backup records
        now = datetime.now(UTC)
        old_records = []
        
        # Create many old hourly backups (should exceed retention limit)
        for i in range(30):
            record = BackupRecord(
                timestamp=now,  # All same time for simplicity
                backup_path=f"/test/backup_{i}.json",
                file_size_bytes=1024,
                status=BackupStatus.SUCCESS,
                backup_type="interval",
                duration_seconds=1.0
            )
            old_records.append(record)
        
        scheduler.backup_history = old_records
        
        # Mock file deletion
        with patch('pathlib.Path.exists') as mock_exists, \
             patch('pathlib.Path.unlink') as mock_unlink:
            
            mock_exists.return_value = True
            scheduler.cleanup_old_backups()
            
            # Should keep only the retention limit amount
            assert len(scheduler.backup_history) <= scheduler.config.keep_hourly_backups
    
    def test_get_backup_status_no_backups(self, scheduler):
        """Test status when no backups exist"""
        status = scheduler.get_backup_status()
        
        assert status["status"] == "no_backups"
        assert status["last_backup"] is None
        assert status["total_backups"] == 0
        assert status["scheduler_running"] == False
    
    def test_get_backup_status_with_backups(self, scheduler):
        """Test status with existing backups"""
        # Add sample backup record
        record = BackupRecord(
            timestamp=datetime.now(UTC),
            backup_path="/test/backup.json",
            file_size_bytes=1024,
            status=BackupStatus.SUCCESS,
            backup_type="manual",
            duration_seconds=2.5
        )
        scheduler.backup_history.append(record)
        
        status = scheduler.get_backup_status()
        
        assert status["status"] == "healthy"
        assert status["last_backup"] is not None
        assert status["last_backup"]["status"] == "success"
        assert status["total_backups"] == 1
        assert status["successful_backups"] == 1
        assert status["failed_backups"] == 0


class TestBackupAPI:
    """Test backup API endpoints"""
    
    @pytest.fixture
    def client(self):
        """Create test client"""
        return TestClient(app)
    
    @pytest.fixture
    def mock_auth(self):
        """Mock authentication"""
        with patch('taskagent_api.routes.backup.get_current_user') as mock_user:
            mock_user.return_value = MagicMock(id=1, email="test@test.com")
            yield mock_user
    
    def test_backup_status_endpoint(self, client, mock_auth):
        """Test backup status endpoint"""
        with patch('taskagent_api.routes.backup.get_backup_scheduler') as mock_scheduler:
            mock_scheduler_instance = MagicMock()
            mock_scheduler_instance.get_backup_status.return_value = {
                "status": "healthy",
                "last_backup": None,
                "total_backups": 0,
                "successful_backups": 0,
                "failed_backups": 0,
                "scheduler_running": True,
                "next_scheduled": None
            }
            mock_scheduler_instance.config.local_backup_dir = "/tmp/backups"
            mock_scheduler.return_value = mock_scheduler_instance
            
            with patch('pathlib.Path.exists') as mock_exists:
                mock_exists.return_value = True
                
                response = client.get("/api/backup/status")
                assert response.status_code == 200
                
                data = response.json()
                assert data["status"] == "healthy"
                assert data["total_backups"] == 0
                assert data["scheduler_running"] == True
    
    def test_create_backup_endpoint(self, client, mock_auth):
        """Test create backup endpoint"""
        with patch('taskagent_api.routes.backup.create_manual_backup') as mock_create:
            mock_record = BackupRecord(
                timestamp=datetime.now(UTC),
                backup_path="/tmp/test_backup.json",
                file_size_bytes=1024,
                status=BackupStatus.SUCCESS,
                backup_type="manual",
                duration_seconds=2.5
            )
            mock_create.return_value = mock_record
            
            response = client.post("/api/backup/create")
            assert response.status_code == 200
            
            data = response.json()
            assert data["success"] == True
            assert "Backup created successfully" in data["message"]
            assert data["backup_record"] is not None
    
    def test_backup_history_endpoint(self, client, mock_auth):
        """Test backup history endpoint"""
        with patch('taskagent_api.routes.backup.get_backup_scheduler') as mock_scheduler:
            mock_scheduler_instance = MagicMock()
            mock_record = BackupRecord(
                timestamp=datetime.now(UTC),
                backup_path="/tmp/test_backup.json",
                file_size_bytes=1024,
                status=BackupStatus.SUCCESS,
                backup_type="manual",
                duration_seconds=2.5
            )
            mock_scheduler_instance.backup_history = [mock_record]
            mock_scheduler.return_value = mock_scheduler_instance
            
            response = client.get("/api/backup/history")
            assert response.status_code == 200
            
            data = response.json()
            assert len(data) == 1
            assert data[0]["status"] == "success"
            assert data[0]["backup_type"] == "manual"


# Utility functions for tests

def mock_open_with_json(json_data):
    """Create a mock open function that returns JSON data"""
    import io
    
    class MockOpen:
        def __init__(self, json_data):
            self.json_data = json_data
        
        def __call__(self, *args, **kwargs):
            if 'w' in args[1] if len(args) > 1 else kwargs.get('mode', 'r'):
                # Writing mode
                return MagicMock()
            else:
                # Reading mode
                return io.StringIO(json.dumps(self.json_data))
        
        def __enter__(self):
            return self
        
        def __exit__(self, *args):
            pass
    
    return MockOpen(json_data)


@pytest.mark.asyncio
async def test_create_manual_backup_function():
    """Test the create_manual_backup function"""
    with patch('taskagent_api.backup_scheduler.get_backup_scheduler') as mock_get_scheduler:
        mock_scheduler = MagicMock()
        mock_record = BackupRecord(
            timestamp=datetime.now(UTC),
            backup_path="/tmp/test_backup.json",
            file_size_bytes=1024,
            status=BackupStatus.SUCCESS,
            backup_type="manual",
            duration_seconds=2.5
        )
        mock_scheduler.create_backup = AsyncMock(return_value=mock_record)
        mock_get_scheduler.return_value = mock_scheduler
        
        result = await create_manual_backup()
        
        assert result == mock_record
        mock_scheduler.create_backup.assert_called_once_with("manual")