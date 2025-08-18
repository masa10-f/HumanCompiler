// Optimization API types for Hybrid GPT-5 + OR-Tools Pipeline

export interface TimeSlotConfig {
  start: string; // HH:MM format
  end: string; // HH:MM format
  kind: 'light_work' | 'focused_work' | 'study';
  capacity_hours?: number;
}

export interface WeeklyConstraints {
  total_capacity_hours: number;
  daily_max_hours: number;
  deep_work_blocks: number;
  meeting_buffer_hours: number;
}

export interface OptimizationRequest {
  week_start_date: string; // YYYY-MM-DD format
  constraints: WeeklyConstraints;
  project_filter?: string[];
  selected_recurring_task_ids: string[];
  daily_time_slots: TimeSlotConfig[];
  enable_caching?: boolean;
  optimization_timeout_seconds?: number;
  fallback_on_failure?: boolean;
  preferences?: Record<string, any>;
  user_prompt?: string;
}

export interface SelectedTask {
  task_id: string;
  task_title: string;
  estimated_hours: number;
  priority: number;
  rationale: string;
}

export interface ProjectAllocation {
  project_id: string;
  project_title: string;
  target_hours: number;
  max_hours: number;
  priority_weight: number;
}

export interface WeeklyTaskSolverResponse {
  success: boolean;
  selected_tasks: SelectedTask[];
  total_allocated_hours: number;
  project_allocations: ProjectAllocation[];
  insights: string[];
  analysis: Record<string, any>;
  generated_at: string;
}

export interface TaskAssignment {
  task_id: string;
  slot_index: number;
  start_time: string; // HH:MM format
  duration_hours: number;
}

export interface DailyOptimizationResult {
  date: string; // YYYY-MM-DD
  total_scheduled_hours: number;
  assignments: TaskAssignment[];
  unscheduled_tasks: string[];
  optimization_status: string;
  solve_time_seconds: number;
}

export interface PipelineStageResult {
  stage: string;
  success: boolean;
  duration_seconds: number;
  errors: string[];
  warnings: string[];
}

export interface OptimizationResponse {
  success: boolean;
  status: 'success' | 'partial_success' | 'failed' | 'in_progress';
  week_start_date: string;
  weekly_solver_response?: WeeklyTaskSolverResponse;
  daily_optimizations: DailyOptimizationResult[];
  pipeline_metrics: Record<string, any>;
  stage_results: PipelineStageResult[];
  total_optimized_hours: number;
  capacity_utilization: number;
  consistency_score: number;
  optimization_insights: string[];
  performance_analysis: Record<string, any>;
  generated_at: string;
}

export interface OptimizationStatus {
  week_start_date: string;
  optimization_available: boolean;
  last_updated: string;
  selected_tasks_count: number;
  total_allocated_hours: number;
  project_allocations: ProjectAllocation[];
  optimization_insights: string[];
  solver_metrics: Record<string, any>;
  generated_at?: string;
}

export interface OptimizationCacheResponse {
  status: string;
  message: string;
  week_start_date: string;
}

export interface OptimizationTestResponse {
  status: 'success' | 'error';
  message: string;
  components?: Record<string, string>;
  features?: Record<string, string>;
  error_type?: string;
}

// UI State Management types
export interface OptimizationUIState {
  isExecuting: boolean;
  currentStage: 'initialization' | 'task_selection' | 'time_optimization' | 'result_integration' | 'completed' | null;
  progress: number; // 0-100
  constraints: WeeklyConstraints;
  timeSlots: TimeSlotConfig[];
  results: OptimizationResponse | null;
  history: OptimizationResponse[];
  error: string | null;
}

// Preset configurations
export interface OptimizationPreset {
  name: string;
  description: string;
  constraints: WeeklyConstraints;
  timeSlots: TimeSlotConfig[];
}

export const DEFAULT_OPTIMIZATION_PRESETS: OptimizationPreset[] = [
  {
    name: '標準40h/週',
    description: '一般的な働き方向けの標準設定',
    constraints: {
      total_capacity_hours: 40,
      daily_max_hours: 8,
      deep_work_blocks: 2,
      meeting_buffer_hours: 4,
    },
    timeSlots: [
      { start: '09:00', end: '12:00', kind: 'focused_work', capacity_hours: 3.0 },
      { start: '14:00', end: '17:00', kind: 'light_work', capacity_hours: 3.0 },
      { start: '19:00', end: '21:00', kind: 'study', capacity_hours: 2.0 },
    ],
  },
  {
    name: '集中60h/週',
    description: 'プロジェクト集中期間向けの高密度設定',
    constraints: {
      total_capacity_hours: 60,
      daily_max_hours: 10,
      deep_work_blocks: 4,
      meeting_buffer_hours: 6,
    },
    timeSlots: [
      { start: '08:00', end: '12:00', kind: 'focused_work', capacity_hours: 4.0 },
      { start: '13:00', end: '17:00', kind: 'focused_work', capacity_hours: 4.0 },
      { start: '19:00', end: '22:00', kind: 'study', capacity_hours: 3.0 },
    ],
  },
  {
    name: '軽量20h/週',
    description: 'パートタイム・副業向けの軽量設定',
    constraints: {
      total_capacity_hours: 20,
      daily_max_hours: 4,
      deep_work_blocks: 1,
      meeting_buffer_hours: 2,
    },
    timeSlots: [
      { start: '19:00', end: '22:00', kind: 'light_work', capacity_hours: 3.0 },
      { start: '10:00', end: '12:00', kind: 'study', capacity_hours: 2.0 },
    ],
  },
];
