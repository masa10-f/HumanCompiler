// AI Planning type definitions for frontend

export interface WeeklyPlanRequest {
  week_start_date: string;
  capacity_hours: number;
  project_filter?: string[];
  selected_recurring_task_ids?: string[];
  project_allocations?: Record<string, number>;
  preferences?: Record<string, unknown>;
  user_prompt?: string;
}

export interface TaskPlan {
  task_id: string;
  task_title: string;
  estimated_hours: number;
  priority: number;
  rationale: string;
}

export interface WeeklyPlanResponse {
  success: boolean;
  week_start_date: string;
  total_planned_hours: number;
  task_plans: TaskPlan[];
  recommendations: string[];
  insights: string[];
  project_allocations?: ProjectAllocation[];
  constraint_analysis?: Record<string, any>;
  solver_metrics?: Record<string, any>;
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
  kind: 'study' | 'focused_work' | 'light_work';
  capacity_hours?: number;
}

export interface TaskSource {
  type: 'all_tasks' | 'project' | 'weekly_schedule';
  project_id?: string;
  weekly_schedule_date?: string;
}

export interface ScheduleRequest {
  date: string;
  time_slots: TimeSlot[];
  task_source?: TaskSource;
  // Legacy fields for backward compatibility
  project_id?: string;
  use_weekly_schedule?: boolean;
  preferences?: Record<string, unknown>;
}

export interface TaskAssignment {
  task_id: string;
  task_title: string;
  goal_id: string;
  project_id: string;
  slot_index: number;
  start_time: string;
  duration_hours: number;
  slot_start: string;
  slot_end: string;
  slot_kind: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  estimate_hours: number;
  priority: number;
  kind: string;
  due_date?: string;
  goal_id?: string;
  project_id?: string;
}

export interface ScheduleResult {
  success: boolean;
  assignments: TaskAssignment[];
  unscheduled_tasks: TaskInfo[];
  total_scheduled_hours: number;
  optimization_status: string;
  solve_time_seconds: number;
  objective_value?: number;
}

// Weekly Schedule Storage types
export interface WeeklyScheduleData {
  success: boolean;
  selected_tasks: TaskPlan[];
  total_allocated_hours: number;
  project_allocations: ProjectAllocation[];
  optimization_insights: string[];
  constraint_analysis: Record<string, any>;
  solver_metrics: Record<string, any>;
  generated_at: string;
}

export interface ProjectAllocation {
  project_id: string;
  project_title: string;
  target_hours: number;
  max_hours: number;
  priority_weight: number;
}

export interface SavedWeeklySchedule {
  id: string;
  user_id: string;
  week_start_date: string;
  schedule_json: WeeklyScheduleData;
  created_at: string;
  updated_at: string;
}

export interface WeeklyScheduleOption {
  week_start_date: string;
  task_count: number;
  title: string;
}
