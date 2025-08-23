// Weekly report types for frontend
export interface TaskProgressSummary {
  task_id: string;
  task_title: string;
  project_title: string;
  goal_title: string;
  estimated_hours: number;
  actual_minutes: number;
  completion_percentage: number;
  status: string;
  work_logs: string[];
}

export interface ProjectProgressSummary {
  project_id: string;
  project_title: string;
  total_estimated_hours: number;
  total_actual_minutes: number;
  total_tasks: number;
  completed_tasks: number;
  completion_percentage: number;
  tasks: TaskProgressSummary[];
}

export interface WeeklyWorkSummary {
  total_actual_minutes: number;
  total_estimated_hours: number;
  total_tasks_worked: number;
  total_completed_tasks: number;
  overall_completion_percentage: number;
  daily_breakdown: Record<string, number>;
  project_breakdown: Record<string, number>;
}

export interface WeeklyReportRequest {
  week_start_date: string;
  project_ids?: string[];
}

export interface WeeklyReportResponse {
  week_start_date: string;
  week_end_date: string;
  work_summary: WeeklyWorkSummary;
  project_summaries: ProjectProgressSummary[];
  markdown_report: string;
  generated_at: string;
}
