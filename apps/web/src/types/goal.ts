// Goal type definitions for frontend
export interface Goal {
  id: string;
  title: string;
  description: string | null;
  estimate_hours: number;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface GoalCreate {
  title: string;
  description?: string;
  estimate_hours: number;
  project_id: string;
}

export interface GoalUpdate {
  title?: string;
  description?: string;
  estimate_hours?: number;
}

export interface GoalResponse {
  id: string;
  title: string;
  description: string | null;
  estimate_hours: number;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface GoalsApiResponse {
  data: Goal[];
  total: number;
}

export interface GoalFormData {
  title: string;
  description: string;
  estimate_hours: number;
}