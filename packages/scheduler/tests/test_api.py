"""
Tests for scheduler API wrapper functions.
"""

import pytest
from datetime import time, datetime

from scheduler.api import (
    optimize_schedule_api,
    create_task_from_dict,
    create_time_slot_from_dict,
    validate_schedule_request,
    format_schedule_result
)
from scheduler.models import Task, TimeSlot, ScheduleResult, TaskAssignment, TaskKind, SlotKind


class TestSchedulerAPI:
    """Test cases for scheduler API wrapper functions."""
    
    def test_optimize_schedule_api_success(self):
        """Test successful API optimization."""
        request_data = {
            "tasks": [
                {
                    "id": "task1",
                    "title": "Test Task",
                    "estimate_hours": 2.0,
                    "priority": 1,
                    "kind": "light"
                }
            ],
            "time_slots": [
                {
                    "start": "09:00",
                    "end": "12:00",
                    "kind": "light"
                }
            ],
            "date": "2025-06-23"
        }
        
        response = optimize_schedule_api(request_data)
        
        assert "result" in response
        assert "request_id" in response
        assert "generated_at" in response
        assert response["result"]["success"] is True
        assert len(response["result"]["assignments"]) > 0
    
    def test_optimize_schedule_api_validation_error(self):
        """Test API with invalid request data."""
        request_data = {
            "tasks": [],  # Empty tasks should be valid but edge case
            "time_slots": [
                {
                    "start": "09:00",
                    "end": "12:00"
                }
            ],
            "date": "invalid-date"  # Invalid date format
        }
        
        response = optimize_schedule_api(request_data)
        
        assert "result" in response
        assert response["result"]["success"] is False
        assert "ERROR" in response["result"]["optimization_status"]
    
    def test_create_task_from_dict(self):
        """Test task creation from dictionary."""
        task_data = {
            "id": "task1",
            "title": "Test Task",
            "estimate_hours": 2.5,
            "priority": 2,
            "kind": "deep",
            "due_date": "2025-06-25T10:00:00",
            "goal_id": "goal1"
        }
        
        task = create_task_from_dict(task_data)
        
        assert task.id == "task1"
        assert task.title == "Test Task"
        assert task.estimate_hours == 2.5
        assert task.priority == 2
        assert task.kind == TaskKind.DEEP
        assert task.due_date == datetime(2025, 6, 25, 10, 0, 0)
        assert task.goal_id == "goal1"
    
    def test_create_task_from_dict_minimal(self):
        """Test task creation with minimal data."""
        task_data = {
            "id": "task1",
            "title": "Test Task",
            "estimate_hours": 1.0
        }
        
        task = create_task_from_dict(task_data)
        
        assert task.id == "task1"
        assert task.title == "Test Task"
        assert task.estimate_hours == 1.0
        assert task.priority == 3  # Default value
        assert task.kind == TaskKind.LIGHT  # Default value
        assert task.due_date is None
        assert task.goal_id is None
    
    def test_create_task_invalid_kind(self):
        """Test task creation with invalid kind."""
        task_data = {
            "id": "task1",
            "title": "Test Task",
            "estimate_hours": 1.0,
            "kind": "invalid_kind"
        }
        
        task = create_task_from_dict(task_data)
        
        assert task.kind == TaskKind.LIGHT  # Should default to LIGHT
    
    def test_create_time_slot_from_dict(self):
        """Test time slot creation from dictionary."""
        slot_data = {
            "start": "09:00",
            "end": "12:00",
            "kind": "deep",
            "capacity_hours": 2.5
        }
        
        slot = create_time_slot_from_dict(slot_data)
        
        assert slot.start == time(9, 0)
        assert slot.end == time(12, 0)
        assert slot.kind == SlotKind.DEEP
        assert slot.capacity_hours == 2.5
    
    def test_create_time_slot_from_dict_minimal(self):
        """Test time slot creation with minimal data."""
        slot_data = {
            "start": "14:30",
            "end": "16:45"
        }
        
        slot = create_time_slot_from_dict(slot_data)
        
        assert slot.start == time(14, 30)
        assert slot.end == time(16, 45)
        assert slot.kind == SlotKind.LIGHT  # Default value
        assert slot.capacity_hours is None
    
    def test_validate_schedule_request_valid(self):
        """Test validation of valid request."""
        request_data = {
            "tasks": [
                {
                    "id": "task1",
                    "title": "Test Task",
                    "estimate_hours": 2.0
                }
            ],
            "time_slots": [
                {
                    "start": "09:00",
                    "end": "12:00"
                }
            ],
            "date": "2025-06-23"
        }
        
        error = validate_schedule_request(request_data)
        assert error is None
    
    def test_validate_schedule_request_missing_field(self):
        """Test validation with missing required field."""
        request_data = {
            "tasks": [],
            "time_slots": []
            # Missing 'date' field
        }
        
        error = validate_schedule_request(request_data)
        assert error is not None
        assert "Missing required field: date" in error
    
    def test_validate_schedule_request_empty_tasks(self):
        """Test validation with empty tasks list."""
        request_data = {
            "tasks": [],
            "time_slots": [
                {
                    "start": "09:00",
                    "end": "12:00"
                }
            ],
            "date": "2025-06-23"
        }
        
        error = validate_schedule_request(request_data)
        assert error is not None
        assert "At least one task is required" in error
    
    def test_validate_schedule_request_invalid_date(self):
        """Test validation with invalid date format."""
        request_data = {
            "tasks": [
                {
                    "id": "task1",
                    "title": "Test Task",
                    "estimate_hours": 2.0
                }
            ],
            "time_slots": [
                {
                    "start": "09:00",
                    "end": "12:00"
                }
            ],
            "date": "invalid-date"
        }
        
        error = validate_schedule_request(request_data)
        assert error is not None
        assert "Date must be in YYYY-MM-DD format" in error
    
    def test_format_schedule_result(self):
        """Test formatting of schedule result."""
        assignments = [
            TaskAssignment(
                task_id="task1",
                slot_index=0,
                start_time=time(9, 0),
                duration_hours=2.0
            )
        ]
        
        result = ScheduleResult(
            success=True,
            assignments=assignments,
            unscheduled_tasks=["task2"],
            total_scheduled_hours=2.0,
            optimization_status="OPTIMAL",
            solve_time_seconds=0.5,
            objective_value=10.0
        )
        
        formatted = format_schedule_result(result)
        
        assert formatted["success"] is True
        assert len(formatted["assignments"]) == 1
        assert formatted["assignments"][0]["task_id"] == "task1"
        assert formatted["assignments"][0]["start_time"] == "09:00"
        assert formatted["assignments"][0]["duration_hours"] == 2.0
        assert formatted["unscheduled_tasks"] == ["task2"]
        assert formatted["total_scheduled_hours"] == 2.0
        assert formatted["optimization_status"] == "OPTIMAL"
        assert formatted["solve_time_seconds"] == 0.5
        assert formatted["objective_value"] == 10.0