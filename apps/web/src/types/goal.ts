// Goal dependency type definitions
export interface GoalDependencyGoalInfo {
  id: string;
  title: string;
  project_id: string;
}

export interface GoalDependency {
  id: string;
  goal_id: string;
  depends_on_goal_id: string;
  created_at: string;
  depends_on_goal?: GoalDependencyGoalInfo;
}

export interface GoalDependencyCreate {
  goal_id: string;
  depends_on_goal_id: string;
}

// Goal type definitions for frontend
export interface Goal {
  id: string;
  title: string;
  description: string | null;
  estimate_hours: number;
  project_id: string;
  created_at: string;
  updated_at: string;
  dependencies?: GoalDependency[];
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
