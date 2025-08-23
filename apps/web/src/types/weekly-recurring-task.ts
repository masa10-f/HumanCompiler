// Weekly Recurring Task type definitions

export type TaskCategory =
  | 'WORK'
  | 'STUDY'
  | 'PERSONAL'
  | 'HEALTH'
  | 'OTHER';

export interface WeeklyRecurringTask {
  id: string;
  title: string;
  description?: string;
  estimate_hours: number;
  category: TaskCategory;
  is_active: boolean;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WeeklyRecurringTaskCreate {
  title: string;
  description?: string;
  estimate_hours: number;
  category?: TaskCategory;
  is_active?: boolean;
}

export interface WeeklyRecurringTaskUpdate {
  title?: string;
  description?: string;
  estimate_hours?: number;
  category?: TaskCategory;
  is_active?: boolean;
}
