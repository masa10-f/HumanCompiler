export interface Log {
  id: string;
  task_id: string;
  actual_minutes: number;
  comment?: string;
  created_at: string;
}

export interface LogCreate {
  task_id: string;
  actual_minutes: number;
  comment?: string;
}

export interface LogUpdate {
  actual_minutes?: number;
  comment?: string;
}