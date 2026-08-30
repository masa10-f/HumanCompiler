export type RecentDashboardItemKind = 'task' | 'goal';

export interface RecentDashboardItem {
  kind: RecentDashboardItemKind;
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  project_id: string;
  project_title: string;
  goal_id: string;
  goal_title: string;
  updated_at: string;
}
