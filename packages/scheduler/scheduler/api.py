"""
API wrapper functions for task scheduling optimization.
"""

import uuid
from datetime import datetime
from typing import Dict, Any, Optional

from .core import optimize_schedule
from .models import (
    ScheduleRequest, 
    ScheduleResponse, 
    ScheduleResult,
    Task,
    TimeSlot,
    TaskKind,
    SlotKind
)


def optimize_schedule_api(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    API wrapper for schedule optimization.
    
    Args:
        request_data: Dictionary containing schedule request data
        
    Returns:
        Dictionary containing schedule response data
        
    Raises:
        ValueError: If request data is invalid
        Exception: If optimization fails
    """
    try:
        # Validate and parse request
        request = ScheduleRequest(**request_data)
        
        # Generate request ID
        request_id = str(uuid.uuid4())
        
        # Run optimization
        result = optimize_schedule(
            tasks=request.tasks,
            time_slots=request.time_slots,
            date=request.date
        )
        
        # Create response
        response = ScheduleResponse(
            result=result,
            request_id=request_id,
            generated_at=datetime.now()
        )
        
        return response.dict()
        
    except Exception as e:
        # Return error response
        error_result = ScheduleResult(
            success=False,
            assignments=[],
            unscheduled_tasks=[],
            total_scheduled_hours=0.0,
            optimization_status=f"ERROR: {str(e)}",
            solve_time_seconds=0.0
        )
        
        response = ScheduleResponse(
            result=error_result,
            request_id=str(uuid.uuid4()),
            generated_at=datetime.now()
        )
        
        return response.dict()


def create_task_from_dict(task_data: Dict[str, Any]) -> Task:
    """
    Create Task instance from dictionary data.
    
    Args:
        task_data: Dictionary containing task data
        
    Returns:
        Task instance
    """
    # Handle task kind conversion
    kind_str = task_data.get('kind', 'light')
    if isinstance(kind_str, str):
        try:
            task_kind = TaskKind(kind_str.lower())
        except ValueError:
            task_kind = TaskKind.LIGHT
    else:
        task_kind = TaskKind.LIGHT
    
    # Handle due_date conversion
    due_date = None
    if 'due_date' in task_data and task_data['due_date']:
        if isinstance(task_data['due_date'], str):
            try:
                due_date = datetime.fromisoformat(task_data['due_date'])
            except ValueError:
                due_date = None
        elif isinstance(task_data['due_date'], datetime):
            due_date = task_data['due_date']
    
    return Task(
        id=task_data['id'],
        title=task_data['title'],
        estimate_hours=float(task_data['estimate_hours']),
        priority=int(task_data.get('priority', 3)),
        due_date=due_date,
        kind=task_kind,
        goal_id=task_data.get('goal_id')
    )


def create_time_slot_from_dict(slot_data: Dict[str, Any]) -> TimeSlot:
    """
    Create TimeSlot instance from dictionary data.
    
    Args:
        slot_data: Dictionary containing time slot data
        
    Returns:
        TimeSlot instance
    """
    from datetime import time
    
    # Handle time conversion
    def parse_time(time_str: str) -> time:
        if isinstance(time_str, str):
            if ':' in time_str:
                parts = time_str.split(':')
                hour = int(parts[0])
                minute = int(parts[1]) if len(parts) > 1 else 0
                return time(hour=hour, minute=minute)
        raise ValueError(f"Invalid time format: {time_str}")
    
    # Handle slot kind conversion
    kind_str = slot_data.get('kind', 'light')
    if isinstance(kind_str, str):
        try:
            slot_kind = SlotKind(kind_str.lower())
        except ValueError:
            slot_kind = SlotKind.LIGHT
    else:
        slot_kind = SlotKind.LIGHT
    
    return TimeSlot(
        start=parse_time(slot_data['start']),
        end=parse_time(slot_data['end']),
        kind=slot_kind,
        capacity_hours=slot_data.get('capacity_hours')
    )


def format_schedule_result(result: ScheduleResult) -> Dict[str, Any]:
    """
    Format ScheduleResult for API response.
    
    Args:
        result: ScheduleResult instance
        
    Returns:
        Formatted dictionary
    """
    return {
        'success': result.success,
        'assignments': [
            {
                'task_id': assignment.task_id,
                'slot_index': assignment.slot_index,
                'start_time': assignment.start_time.strftime('%H:%M'),
                'duration_hours': assignment.duration_hours,
            }
            for assignment in result.assignments
        ],
        'unscheduled_tasks': result.unscheduled_tasks,
        'total_scheduled_hours': result.total_scheduled_hours,
        'optimization_status': result.optimization_status,
        'solve_time_seconds': result.solve_time_seconds,
        'objective_value': result.objective_value,
        'utilization_rate': result.utilization_rate,
    }


def validate_schedule_request(request_data: Dict[str, Any]) -> Optional[str]:
    """
    Validate schedule request data.
    
    Args:
        request_data: Dictionary containing request data
        
    Returns:
        Error message if validation fails, None if valid
    """
    try:
        # Check required fields
        required_fields = ['tasks', 'time_slots', 'date']
        for field in required_fields:
            if field not in request_data:
                return f"Missing required field: {field}"
        
        # Validate tasks
        tasks = request_data['tasks']
        if not isinstance(tasks, list):
            return "Tasks must be a list"
        
        if len(tasks) == 0:
            return "At least one task is required"
        
        for i, task in enumerate(tasks):
            if not isinstance(task, dict):
                return f"Task {i} must be a dictionary"
            
            required_task_fields = ['id', 'title', 'estimate_hours']
            for field in required_task_fields:
                if field not in task:
                    return f"Task {i} missing required field: {field}"
        
        # Validate time slots
        time_slots = request_data['time_slots']
        if not isinstance(time_slots, list):
            return "Time slots must be a list"
        
        if len(time_slots) == 0:
            return "At least one time slot is required"
        
        for i, slot in enumerate(time_slots):
            if not isinstance(slot, dict):
                return f"Time slot {i} must be a dictionary"
            
            required_slot_fields = ['start', 'end']
            for field in required_slot_fields:
                if field not in slot:
                    return f"Time slot {i} missing required field: {field}"
        
        # Validate date format
        date_str = request_data['date']
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            return "Date must be in YYYY-MM-DD format"
        
        return None
        
    except Exception as e:
        return f"Validation error: {str(e)}"