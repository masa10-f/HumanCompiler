// AI Planning type definitions for frontend

export interface WeeklyPlanRequest {
  week_start_date: string;
  capacity_hours: number;
  project_filter?: string[];
  preferences?: Record<string, any>;
}

export interface TaskPlan {
  task_id: string;
  task_title: string;
  estimated_hours: number;
  priority: number;
  suggested_day: string;
  suggested_time_slot: string;
  rationale: string;
}

export interface WeeklyPlanResponse {
  success: boolean;
  week_start_date: string;
  total_planned_hours: number;
  task_plans: TaskPlan[];
  recommendations: string[];
  insights: string[];
  generated_at: string;
}

export interface WorkloadAnalysis {
  success: boolean;
  analysis: {
    total_estimated_hours: number;
    total_tasks: number;
    overdue_tasks: number;
    urgent_tasks: number;
    projects_involved: number;
    project_distribution: Record<string, number>;
  };
  recommendations: string[];
  generated_at: string;
}

export interface TaskPrioritySuggestion {
  task_id: string;
  task_title: string;
  current_estimate_hours: number;
  due_date?: string;
  priority_score: number;
  suggested_priority: number;
  reasoning: string[];
}

export interface PrioritySuggestions {
  success: boolean;
  total_tasks_analyzed: number;
  priority_suggestions: TaskPrioritySuggestion[];
  methodology: {
    factors: string[];
    priority_scale: string;
  };
  generated_at: string;
}

// Schedule optimization types
export interface TimeSlot {
  start: string;
  end: string;
  kind: 'study' | 'deep' | 'light' | 'meeting';
  capacity_hours?: number;
}

export interface ScheduleRequest {
  date: string;
  time_slots: TimeSlot[];
  project_id?: string;
  goal_id?: string;
  preferences?: Record<string, any>;
}

export interface TaskAssignment {
  task_id: string;
  slot_index: number;
  start_time: string;
  duration_hours: number;
}

export interface ScheduleResult {
  success: boolean;
  assignments: TaskAssignment[];
  unscheduled_tasks: string[];
  total_scheduled_hours: number;
  optimization_status: string;
  solve_time_seconds: number;
  objective_value?: number;
}