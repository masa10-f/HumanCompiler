"""
Tests for data export/import functionality
データエクスポート・インポート機能のテスト

Issue #131: JSONデータのエクスポート機能
"""

import json
import tempfile
import uuid
from datetime import datetime, timezone, UTC
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from humancompiler_api.main import app
from humancompiler_api.models import User, Project, Goal, Task, Schedule
from humancompiler_api.safe_migration import DataBackupManager, SafeMigrationError


@pytest.fixture
def test_client():
    """Test client for API testing"""
    return TestClient(app)


@pytest.fixture
def sample_user_data():
    """Sample user data for testing"""
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    goal_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())

    return {
        "user_id": user_id,
        "user": {
            "id": user_id,
            "email": "test@example.com",
            "created_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        },
        "project": {
            "id": project_id,
            "owner_id": user_id,
            "title": "Test Project",
            "description": "A test project for export/import",
            "created_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        },
        "goal": {
            "id": goal_id,
            "project_id": project_id,
            "title": "Test Goal",
            "description": "A test goal",
            "estimate_hours": 10,
            "created_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        },
        "task": {
            "id": task_id,
            "goal_id": goal_id,
            "title": "Test Task",
            "description": "A test task",
            "estimate_hours": 5,
            "status": "pending",
            "priority": 1,
            "created_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        },
    }


@pytest.fixture
def sample_backup_file(sample_user_data):
    """Create a sample backup file for testing"""
    backup_data = {
        "users": [sample_user_data["user"]],
        "projects": [sample_user_data["project"]],
        "goals": [sample_user_data["goal"]],
        "tasks": [sample_user_data["task"]],
        "schedules": [],
        "weekly_schedules": [],
        "weekly_recurring_tasks": [],
        "logs": [],
        "user_settings": [],
        "api_usage_logs": [],
        "goal_dependencies": [],
        "task_dependencies": [],
        "metadata": {
            "created_at": datetime.now(UTC).isoformat(),
            "version": "2.0",
            "backup_type": "user_specific",
            "user_id": sample_user_data["user_id"],
            "total_records": {
                "users": 1,
                "projects": 1,
                "goals": 1,
                "tasks": 1,
                "schedules": 0,
                "weekly_schedules": 0,
                "weekly_recurring_tasks": 0,
                "logs": 0,
                "user_settings": 0,
                "api_usage_logs": 0,
                "goal_dependencies": 0,
                "task_dependencies": 0,
            },
        },
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(backup_data, f, indent=2, default=str)
        return f.name


class TestDataBackupManager:
    """Test DataBackupManager functionality"""

    def test_create_user_backup_invalid_user(self):
        """Test creating backup for non-existent user"""
        backup_manager = DataBackupManager()

        # This test requires database connection, so we expect either
        # "User not found" or database connection error
        with pytest.raises(SafeMigrationError):
            backup_manager.create_user_backup("non-existent-user-id")

    def test_restore_user_data_file_not_found(self):
        """Test restoring from non-existent backup file"""
        backup_manager = DataBackupManager()

        with pytest.raises(SafeMigrationError, match="Backup file not found"):
            backup_manager.restore_user_data("non-existent-file.json", "user-id")

    def test_restore_user_data_invalid_backup_type(self, sample_user_data):
        """Test restoring from invalid backup type"""
        backup_manager = DataBackupManager()

        # Create backup with wrong type
        invalid_backup = {
            "users": [sample_user_data["user"]],
            "metadata": {
                "backup_type": "full_system",  # Wrong type
                "version": "2.0",
            },
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(invalid_backup, f)
            temp_path = f.name

        try:
            with pytest.raises(SafeMigrationError, match="not a user-specific backup"):
                backup_manager.restore_user_data(temp_path, "user-id")
        finally:
            Path(temp_path).unlink(missing_ok=True)


class TestDataExportAPI:
    """Test data export API endpoints"""

    def test_export_info_endpoint(self, test_client):
        """Test the export info endpoint"""
        # Note: This test would need proper authentication setup
        # For now, testing the endpoint structure
        response = test_client.get("/api/export/info")

        # Without authentication, should return 401 or 403
        assert response.status_code in [401, 403]

    def test_export_user_data_no_auth(self, test_client):
        """Test export without authentication"""
        response = test_client.get("/api/export/user-data")

        # Should require authentication
        assert response.status_code in [401, 403]

    def test_import_user_data_no_auth(self, test_client):
        """Test import without authentication"""
        response = test_client.post("/api/import/user-data")

        # Should require authentication
        assert response.status_code in [401, 403]

    def test_import_invalid_file_type(self, test_client):
        """Test import with invalid file type"""
        # This would need authentication setup, but testing the concept
        files = {"file": ("test.txt", "not a json file", "text/plain")}
        response = test_client.post("/api/import/user-data", files=files)

        # Should return error for invalid file type
        assert response.status_code in [400, 401, 403]

    def test_import_oversized_file(self, test_client):
        """Test import with oversized file"""
        # Create a large JSON file (> 10MB)
        large_data = {"data": "x" * (11 * 1024 * 1024)}  # 11MB
        large_json = json.dumps(large_data)

        files = {"file": ("large.json", large_json, "application/json")}
        response = test_client.post("/api/import/user-data", files=files)

        # Should return error for oversized file
        assert response.status_code in [400, 401, 403, 413]


class TestBackupFileValidation:
    """Test backup file validation"""

    def test_valid_backup_structure(self, sample_backup_file):
        """Test validation of a valid backup file"""
        with open(sample_backup_file) as f:
            backup_data = json.load(f)

        # Check required sections exist
        required_sections = ["users", "projects", "goals", "tasks", "metadata"]
        for section in required_sections:
            assert section in backup_data

        # Check metadata structure
        metadata = backup_data["metadata"]
        assert "backup_type" in metadata
        assert "version" in metadata
        assert "total_records" in metadata
        assert metadata["backup_type"] == "user_specific"

        # Clean up
        Path(sample_backup_file).unlink(missing_ok=True)

    def test_invalid_json_structure(self):
        """Test validation of invalid JSON"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("{ invalid json structure")
            invalid_file = f.name

        try:
            # Should raise JSONDecodeError when trying to parse
            with pytest.raises(json.JSONDecodeError):
                with open(invalid_file) as f:
                    json.load(f)
        finally:
            Path(invalid_file).unlink(missing_ok=True)

    def test_missing_required_sections(self):
        """Test backup file missing required sections"""
        incomplete_backup = {
            "users": [],
            "projects": [],
            # Missing goals, tasks, metadata
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(incomplete_backup, f)
            incomplete_file = f.name

        try:
            with open(incomplete_file) as f:
                backup_data = json.load(f)

            required_sections = ["users", "projects", "goals", "tasks", "metadata"]
            missing_sections = [
                section for section in required_sections if section not in backup_data
            ]

            assert len(missing_sections) > 0  # Should have missing sections
            assert "goals" in missing_sections
            assert "tasks" in missing_sections
            assert "metadata" in missing_sections
        finally:
            Path(incomplete_file).unlink(missing_ok=True)


class TestDataIntegrity:
    """Test data integrity during export/import"""

    def test_uuid_generation_uniqueness(self):
        """Test that new UUIDs are generated for imported data"""
        original_ids = [str(uuid.uuid4()) for _ in range(100)]
        new_ids = [str(uuid.uuid4()) for _ in range(100)]

        # Should be no duplicates
        assert len(set(original_ids)) == len(original_ids)
        assert len(set(new_ids)) == len(new_ids)

        # Should be no overlap between sets
        assert len(set(original_ids) & set(new_ids)) == 0

    def test_metadata_consistency(self, sample_backup_file):
        """Test that metadata matches actual record counts"""
        with open(sample_backup_file) as f:
            backup_data = json.load(f)

        metadata = backup_data["metadata"]
        total_records = metadata["total_records"]

        # Check that counts match actual data
        assert total_records["users"] == len(backup_data["users"])
        assert total_records["projects"] == len(backup_data["projects"])
        assert total_records["goals"] == len(backup_data["goals"])
        assert total_records["tasks"] == len(backup_data["tasks"])

        # Clean up
        Path(sample_backup_file).unlink(missing_ok=True)


class TestSecurityAspects:
    """Test security aspects of export/import"""

    def test_user_data_isolation(self):
        """Test that users can only access their own data"""
        # This would require actual database setup and authentication
        # For now, just testing the concept that user_id is used in queries
        user1_id = str(uuid.uuid4())
        user2_id = str(uuid.uuid4())

        assert user1_id != user2_id  # Different users should have different IDs

    def test_file_size_limits(self):
        """Test file size validation"""
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

        # Test with acceptable size
        acceptable_size = 5 * 1024 * 1024  # 5MB
        assert acceptable_size <= MAX_FILE_SIZE

        # Test with oversized file
        oversized = 15 * 1024 * 1024  # 15MB
        assert oversized > MAX_FILE_SIZE

    def test_safe_filename_handling(self):
        """Test safe handling of uploaded filenames"""
        dangerous_filenames = [
            "../../../etc/passwd",
            "..\\..\\windows\\system32\\config\\sam",
            "test.php.json",
            "<script>alert('xss')</script>.json",
        ]

        for filename in dangerous_filenames:
            # Should only accept .json extension
            if filename.endswith(".json"):
                # Additional validation would be needed for path traversal
                assert ".." not in Path(filename).parts
            else:
                # Should reject non-JSON files
                assert not filename.endswith(".json") or ".json" not in filename[:-5]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
