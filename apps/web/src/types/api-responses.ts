// API response type definitions

export interface TestAIIntegrationResponse {
  success: boolean;
  message: string;
  assistant_id?: string;
  error?: string;
}

export interface SaveDailyScheduleResponse {
  success: boolean;
  schedule_id: string;
  message: string;
}

export interface DailySchedule {
  id: string;
  user_id: string;
  date: string;
  plan_json: {
    success: boolean;
    assignments: Array<{
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
    }>;
    unscheduled_tasks: Array<{
      id: string;
      title: string;
      estimate_hours: number;
      priority: number;
      kind: string;
      due_date?: string;
      goal_id?: string;
      project_id?: string;
    }>;
    total_scheduled_hours: number;
    optimization_status: string;
    solve_time_seconds: number;
    objective_value?: number;
    generated_at: string;
  };
  created_at: string;
  updated_at: string;
}

export interface TestSchedulerResponse {
  success: boolean;
  message: string;
  test_result?: {
    assignments_count: number;
    unscheduled_count: number;
    total_hours: number;
    status: string;
  };
  error?: string;
}
