"""
Core scheduling optimization using OR-Tools CP-SAT solver.
"""

import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple

from ortools.sat.python import cp_model

from .models import Task, TimeSlot, ScheduleResult, TaskAssignment, TaskKind, SlotKind


class TaskScheduler:
    """Task scheduler using OR-Tools CP-SAT constraint solver."""
    
    def __init__(self, tasks: List[Task], time_slots: List[TimeSlot], target_date: str):
        self.tasks = tasks
        self.time_slots = time_slots
        self.target_date = datetime.strptime(target_date, "%Y-%m-%d")
        
        # Convert to working units (15-minute intervals)
        self.time_unit_minutes = 15
        self.slots_data = self._prepare_time_slots()
        self.tasks_data = self._prepare_tasks()
        
    def _prepare_time_slots(self) -> List[Dict]:
        """Convert time slots to solver-friendly format."""
        slots_data = []
        for i, slot in enumerate(self.time_slots):
            start_minutes = slot.start.hour * 60 + slot.start.minute
            end_minutes = slot.end.hour * 60 + slot.end.minute
            duration_units = (end_minutes - start_minutes) // self.time_unit_minutes
            
            slots_data.append({
                'index': i,
                'start_units': start_minutes // self.time_unit_minutes,
                'duration_units': duration_units,
                'kind': slot.kind,
                'capacity_hours': slot.capacity_hours or slot.duration_hours,
            })
        return slots_data
    
    def _prepare_tasks(self) -> List[Dict]:
        """Convert tasks to solver-friendly format."""
        tasks_data = []
        for i, task in enumerate(self.tasks):
            duration_units = max(1, int(task.estimate_hours * 60 / self.time_unit_minutes))
            
            # Calculate due date penalty
            due_penalty = 0
            if task.due_date:
                days_until_due = (task.due_date.date() - self.target_date.date()).days
                if days_until_due < 0:
                    due_penalty = abs(days_until_due) * 100  # High penalty for overdue
                elif days_until_due == 0:
                    due_penalty = 50  # Medium penalty for due today
            
            tasks_data.append({
                'index': i,
                'id': task.id,
                'title': task.title,
                'duration_units': duration_units,
                'priority': task.priority,
                'kind': task.kind,
                'due_penalty': due_penalty,
            })
        return tasks_data
    
    def _calculate_preference_score(self, task_kind: TaskKind, slot_kind: SlotKind) -> int:
        """Calculate preference score for task-slot compatibility."""
        # Perfect matches
        if task_kind == TaskKind.DEEP and slot_kind == SlotKind.DEEP:
            return 0
        if task_kind == TaskKind.STUDY and slot_kind == SlotKind.STUDY:
            return 0
        if task_kind == TaskKind.MEETING and slot_kind == SlotKind.MEETING:
            return 0
        
        # Good matches
        if task_kind == TaskKind.LIGHT and slot_kind in [SlotKind.LIGHT, SlotKind.DEEP]:
            return 1
        if task_kind == TaskKind.STUDY and slot_kind == SlotKind.DEEP:
            return 2
        if task_kind == TaskKind.DEEP and slot_kind == SlotKind.STUDY:
            return 3
        
        # Poor matches
        if task_kind == TaskKind.DEEP and slot_kind in [SlotKind.LIGHT, SlotKind.MEETING]:
            return 5
        if task_kind == TaskKind.STUDY and slot_kind in [SlotKind.LIGHT, SlotKind.MEETING]:
            return 4
        
        # Default
        return 3
    
    def solve(self) -> ScheduleResult:
        """Solve the task scheduling optimization problem."""
        start_time = time.time()
        
        # Create CP model
        model = cp_model.CpModel()
        
        # Decision variables: x[i][s] = 1 if task i is assigned to slot s
        x = {}
        for task_data in self.tasks_data:
            task_idx = task_data['index']
            x[task_idx] = {}
            for slot_data in self.slots_data:
                slot_idx = slot_data['index']
                x[task_idx][slot_idx] = model.NewBoolVar(f'x_t{task_idx}_s{slot_idx}')
        
        # Constraint 1: Each task assigned to exactly one slot
        for task_data in self.tasks_data:
            task_idx = task_data['index']
            model.Add(sum(x[task_idx][slot_idx] for slot_idx in range(len(self.slots_data))) == 1)
        
        # Constraint 2: Slot capacity constraints
        for slot_data in self.slots_data:
            slot_idx = slot_data['index']
            total_units = sum(
                x[task_data['index']][slot_idx] * task_data['duration_units']
                for task_data in self.tasks_data
            )
            model.Add(total_units <= slot_data['duration_units'])
        
        # Objective: Minimize penalty score
        penalty_terms = []
        
        # Due date penalties
        for task_data in self.tasks_data:
            task_idx = task_data['index']
            if task_data['due_penalty'] > 0:
                for slot_idx in range(len(self.slots_data)):
                    penalty_terms.append(
                        x[task_idx][slot_idx] * task_data['due_penalty']
                    )
        
        # Priority penalties (higher priority = lower penalty)
        for task_data in self.tasks_data:
            task_idx = task_data['index']
            priority_penalty = task_data['priority'] * 10  # Scale priority
            for slot_idx in range(len(self.slots_data)):
                penalty_terms.append(
                    x[task_idx][slot_idx] * priority_penalty
                )
        
        # Preference penalties (task-slot compatibility)
        for task_data in self.tasks_data:
            task_idx = task_data['index']
            for slot_data in self.slots_data:
                slot_idx = slot_data['index']
                pref_penalty = self._calculate_preference_score(
                    task_data['kind'], slot_data['kind']
                )
                penalty_terms.append(
                    x[task_idx][slot_idx] * pref_penalty
                )
        
        # Set objective
        if penalty_terms:
            model.Minimize(sum(penalty_terms))
        
        # Solve the model
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 30.0  # 30 second timeout
        status = solver.Solve(model)
        
        solve_time = time.time() - start_time
        
        # Process results
        return self._process_solution(solver, status, x, solve_time)
    
    def _process_solution(
        self, 
        solver: cp_model.CpSolver, 
        status: cp_model.CpSolverStatus,
        x: Dict,
        solve_time: float
    ) -> ScheduleResult:
        """Process the solver solution into ScheduleResult."""
        
        status_map = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE", 
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.UNKNOWN: "UNKNOWN",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
        }
        
        status_str = status_map.get(status, "UNKNOWN")
        success = status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
        assignments = []
        unscheduled_tasks = []
        total_hours = 0.0
        
        if success:
            for task_data in self.tasks_data:
                task_idx = task_data['index']
                task_assigned = False
                
                for slot_data in self.slots_data:
                    slot_idx = slot_data['index']
                    if solver.Value(x[task_idx][slot_idx]) == 1:
                        # Calculate actual start time within slot
                        slot = self.time_slots[slot_idx]
                        duration_hours = task_data['duration_units'] * self.time_unit_minutes / 60.0
                        
                        assignment = TaskAssignment(
                            task_id=task_data['id'],
                            slot_index=slot_idx,
                            start_time=slot.start,
                            duration_hours=duration_hours
                        )
                        assignments.append(assignment)
                        total_hours += duration_hours
                        task_assigned = True
                        break
                
                if not task_assigned:
                    unscheduled_tasks.append(task_data['id'])
        else:
            # All tasks unscheduled if no solution found
            unscheduled_tasks = [task_data['id'] for task_data in self.tasks_data]
        
        objective_value = solver.ObjectiveValue() if success else None
        
        return ScheduleResult(
            success=success,
            assignments=assignments,
            unscheduled_tasks=unscheduled_tasks,
            total_scheduled_hours=total_hours,
            optimization_status=status_str,
            solve_time_seconds=solve_time,
            objective_value=objective_value
        )


def optimize_schedule(
    tasks: List[Task], 
    time_slots: List[TimeSlot], 
    date: str
) -> ScheduleResult:
    """
    Optimize task scheduling for a given date.
    
    Args:
        tasks: List of tasks to schedule
        time_slots: Available time slots
        date: Target date in YYYY-MM-DD format
        
    Returns:
        ScheduleResult with optimization results
    """
    if not tasks:
        return ScheduleResult(
            success=True,
            assignments=[],
            unscheduled_tasks=[],
            total_scheduled_hours=0.0,
            optimization_status="NO_TASKS",
            solve_time_seconds=0.0
        )
    
    if not time_slots:
        return ScheduleResult(
            success=False,
            assignments=[],
            unscheduled_tasks=[task.id for task in tasks],
            total_scheduled_hours=0.0,
            optimization_status="NO_SLOTS",
            solve_time_seconds=0.0
        )
    
    scheduler = TaskScheduler(tasks, time_slots, date)
    return scheduler.solve()