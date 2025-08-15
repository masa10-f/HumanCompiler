export interface TaskProgress {
  task_id: string;
  title: string;
  estimate_hours: number;
  actual_minutes: number;
  progress_percentage: number;
  status: string;
}

export interface GoalProgress {
  goal_id: string;
  title: string;
  estimate_hours: number;
  actual_minutes: number;
  progress_percentage: number;
  tasks: TaskProgress[];
}

export interface ProjectProgress {
  project_id: string;
  title: string;
  estimate_hours: number;
  actual_minutes: number;
  progress_percentage: number;
  goals: GoalProgress[];
}
