// Task type definitions for frontend
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
  depends_on_task?: Task | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  estimate_hours: number;
  due_date: string | null;
  status: TaskStatus;
  goal_id: string;
  created_at: string;
  updated_at: string;
  dependencies?: TaskDependency[];
}

export interface TaskCreate {
  title: string;
  description?: string;
  estimate_hours: number;
  due_date?: string;
  goal_id: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  estimate_hours?: number;
  due_date?: string;
  status?: TaskStatus;
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string | null;
  estimate_hours: number;
  due_date: string | null;
  status: TaskStatus;
  goal_id: string;
  created_at: string;
  updated_at: string;
}

export interface TasksApiResponse {
  data: Task[];
  total: number;
}

export interface TaskFormData {
  title: string;
  description: string;
  estimate_hours: number;
  due_date: string;
}

// Status display helpers
export const taskStatusLabels: Record<TaskStatus, string> = {
  pending: '未着手',
  in_progress: '進行中',
  completed: '完了',
  cancelled: 'キャンセル',
};

export const taskStatusColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};
