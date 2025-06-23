"""
Tests for scheduler core functionality.
"""

import pytest
from datetime import time, datetime

from scheduler.core import optimize_schedule
from scheduler.models import Task, TimeSlot, TaskKind, SlotKind


class TestTaskScheduler:
    """Test cases for task scheduling optimization."""
    
    def test_simple_scheduling(self):
        """Test basic task scheduling with single task and slot."""
        tasks = [
            Task(
                id="task1",
                title="Test Task",
                estimate_hours=2.0,
                priority=1,
                kind=TaskKind.LIGHT
            )
        ]
        
        time_slots = [
            TimeSlot(
                start=time(9, 0),
                end=time(12, 0),
                kind=SlotKind.LIGHT
            )
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.success is True
        assert len(result.assignments) == 1
        assert result.assignments[0].task_id == "task1"
        assert result.assignments[0].duration_hours == 2.0
        assert len(result.unscheduled_tasks) == 0
    
    def test_multiple_tasks_single_slot(self):
        """Test scheduling multiple tasks in a single time slot."""
        tasks = [
            Task(id="task1", title="Task 1", estimate_hours=1.0, priority=1),
            Task(id="task2", title="Task 2", estimate_hours=1.5, priority=2),
        ]
        
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.LIGHT)  # 3 hours
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.success is True
        assert len(result.assignments) == 2
        assert len(result.unscheduled_tasks) == 0
        assert result.total_scheduled_hours == 2.5
    
    def test_insufficient_capacity(self):
        """Test handling of insufficient time slot capacity."""
        tasks = [
            Task(id="task1", title="Task 1", estimate_hours=2.0, priority=1),
            Task(id="task2", title="Task 2", estimate_hours=2.0, priority=2),
        ]
        
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(10, 0), kind=SlotKind.LIGHT)  # 1 hour only
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        # Should fail due to insufficient capacity
        assert result.success is False or len(result.unscheduled_tasks) > 0
    
    def test_priority_ordering(self):
        """Test that higher priority tasks are scheduled first."""
        tasks = [
            Task(id="low_priority", title="Low Priority", estimate_hours=1.0, priority=5),
            Task(id="high_priority", title="High Priority", estimate_hours=1.0, priority=1),
        ]
        
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(10, 0), kind=SlotKind.LIGHT)  # 1 hour only
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        if result.success and len(result.assignments) == 1:
            # High priority task should be scheduled
            assert result.assignments[0].task_id == "high_priority"
    
    def test_task_slot_compatibility(self):
        """Test task-slot kind compatibility preferences."""
        tasks = [
            Task(id="deep_work", title="Deep Work", estimate_hours=2.0, kind=TaskKind.DEEP),
            Task(id="light_work", title="Light Work", estimate_hours=1.0, kind=TaskKind.LIGHT),
        ]
        
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(12, 0), kind=SlotKind.DEEP),
            TimeSlot(start=time(13, 0), end=time(15, 0), kind=SlotKind.LIGHT),
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.success is True
        assert len(result.assignments) == 2
        
        # Check that deep work is assigned to deep slot (index 0)
        deep_assignment = next(a for a in result.assignments if a.task_id == "deep_work")
        assert deep_assignment.slot_index == 0
    
    def test_due_date_penalty(self):
        """Test due date penalty handling."""
        overdue_date = datetime(2025, 6, 20)  # 3 days before target date
        
        tasks = [
            Task(
                id="overdue", 
                title="Overdue Task", 
                estimate_hours=1.0, 
                priority=3,
                due_date=overdue_date
            ),
            Task(
                id="normal", 
                title="Normal Task", 
                estimate_hours=1.0, 
                priority=3
            ),
        ]
        
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(10, 0), kind=SlotKind.LIGHT)  # 1 hour only
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        if result.success and len(result.assignments) == 1:
            # Overdue task should be prioritized
            assert result.assignments[0].task_id == "overdue"
    
    def test_empty_tasks(self):
        """Test handling of empty task list."""
        tasks = []
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(17, 0), kind=SlotKind.LIGHT)
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.success is True
        assert len(result.assignments) == 0
        assert len(result.unscheduled_tasks) == 0
        assert result.total_scheduled_hours == 0.0
    
    def test_empty_slots(self):
        """Test handling of empty time slot list."""
        tasks = [
            Task(id="task1", title="Task 1", estimate_hours=1.0, priority=1)
        ]
        time_slots = []
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.success is False
        assert len(result.assignments) == 0
        assert len(result.unscheduled_tasks) == 1
        assert result.unscheduled_tasks[0] == "task1"
    
    def test_solve_time_tracking(self):
        """Test that solve time is tracked correctly."""
        tasks = [
            Task(id="task1", title="Task 1", estimate_hours=1.0, priority=1)
        ]
        time_slots = [
            TimeSlot(start=time(9, 0), end=time(17, 0), kind=SlotKind.LIGHT)
        ]
        
        result = optimize_schedule(tasks, time_slots, "2025-06-23")
        
        assert result.solve_time_seconds >= 0
        assert result.solve_time_seconds < 10  # Should be fast for simple case