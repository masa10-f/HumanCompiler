"""
Data models for task scheduling using Pydantic.
"""

from datetime import datetime, time
from typing import List, Optional, Dict, Any
from enum import Enum

from pydantic import BaseModel, Field, validator


class TaskKind(str, Enum):
    """Task type classification for scheduling preferences."""
    DEEP = "deep"      # Deep work - requires focused time slots
    LIGHT = "light"    # Light work - can be done in any time slot  
    STUDY = "study"    # Study work - best in morning/focused slots
    MEETING = "meeting"  # Meetings - flexible scheduling


class SlotKind(str, Enum):
    """Time slot type classification."""
    DEEP = "deep"      # Deep work time (morning, quiet periods)
    LIGHT = "light"    # Light work time (afternoon, flexible)
    STUDY = "study"    # Study time (optimal learning periods)
    MEETING = "meeting"  # Meeting time (collaborative periods)


class Task(BaseModel):
    """Task to be scheduled."""
    id: str = Field(..., description="Unique task identifier")
    title: str = Field(..., description="Task title")
    estimate_hours: float = Field(..., gt=0, le=24, description="Estimated hours to complete")
    priority: int = Field(1, ge=1, le=5, description="Priority level (1=highest, 5=lowest)")
    due_date: Optional[datetime] = Field(None, description="Due date for the task")
    kind: TaskKind = Field(TaskKind.LIGHT, description="Task type classification")
    goal_id: Optional[str] = Field(None, description="Associated goal ID")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class TimeSlot(BaseModel):
    """Available time slot for scheduling."""
    start: time = Field(..., description="Start time of the slot")
    end: time = Field(..., description="End time of the slot") 
    kind: SlotKind = Field(SlotKind.LIGHT, description="Slot type classification")
    capacity_hours: Optional[float] = Field(None, description="Maximum hours for this slot")
    
    @validator('end')
    def end_after_start(cls, v, values):
        if 'start' in values and v <= values['start']:
            raise ValueError('End time must be after start time')
        return v
    
    @property
    def duration_hours(self) -> float:
        """Calculate slot duration in hours."""
        start_minutes = self.start.hour * 60 + self.start.minute
        end_minutes = self.end.hour * 60 + self.end.minute
        return (end_minutes - start_minutes) / 60.0
    
    class Config:
        json_encoders = {
            time: lambda v: v.strftime("%H:%M")
        }


class TaskAssignment(BaseModel):
    """Assignment of a task to a time slot."""
    task_id: str = Field(..., description="Task identifier")
    slot_index: int = Field(..., ge=0, description="Time slot index")
    start_time: time = Field(..., description="Actual start time within the slot")
    duration_hours: float = Field(..., gt=0, description="Assigned duration in hours")
    
    class Config:
        json_encoders = {
            time: lambda v: v.strftime("%H:%M")
        }


class ScheduleResult(BaseModel):
    """Result of schedule optimization."""
    success: bool = Field(..., description="Whether optimization succeeded")
    assignments: List[TaskAssignment] = Field(default_factory=list, description="Task assignments")
    unscheduled_tasks: List[str] = Field(default_factory=list, description="Tasks that couldn't be scheduled")
    total_scheduled_hours: float = Field(0.0, description="Total hours scheduled")
    optimization_status: str = Field("", description="OR-Tools solver status")
    solve_time_seconds: float = Field(0.0, description="Time taken to solve")
    objective_value: Optional[float] = Field(None, description="Objective function value")
    
    @property
    def utilization_rate(self) -> float:
        """Calculate utilization rate of scheduled time."""
        if not self.assignments:
            return 0.0
        return len([a for a in self.assignments if a.duration_hours > 0]) / len(self.assignments)


class ScheduleRequest(BaseModel):
    """Request model for schedule optimization API."""
    tasks: List[Task] = Field(..., description="Tasks to be scheduled")
    time_slots: List[TimeSlot] = Field(..., description="Available time slots")
    date: str = Field(..., description="Target date (YYYY-MM-DD)")
    preferences: Dict[str, Any] = Field(default_factory=dict, description="Scheduling preferences")
    
    @validator('date')
    def validate_date_format(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
            return v
        except ValueError:
            raise ValueError('Date must be in YYYY-MM-DD format')


class ScheduleResponse(BaseModel):
    """Response model for schedule optimization API."""
    result: ScheduleResult = Field(..., description="Optimization result")
    request_id: Optional[str] = Field(None, description="Request identifier")
    generated_at: datetime = Field(default_factory=datetime.now, description="Response generation time")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }