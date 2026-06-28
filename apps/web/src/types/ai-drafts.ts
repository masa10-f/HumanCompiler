import type { Goal } from './goal';
import type { Task, WorkType } from './task';

export type GoalTaskDraftMode = 'project_goals' | 'goal_tasks' | 'split_task';
export type OriginalTaskAction = 'keep' | 'cancel';

export interface DraftChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DraftTaskDependency {
  task_client_id: string;
  depends_on_client_id: string;
  rationale?: string | null;
}

export interface DraftTask {
  client_id: string;
  goal_client_id?: string | null;
  goal_id?: string | null;
  source_task_id?: string | null;
  title: string;
  description?: string | null;
  estimate_hours: number;
  due_date?: string | null;
  work_type: WorkType;
  priority: number;
  rationale?: string | null;
  confidence: number;
}

export interface DraftGoal {
  client_id: string;
  title: string;
  description?: string | null;
  estimate_hours: number;
  rationale?: string | null;
  confidence: number;
  tasks: DraftTask[];
}

export interface GoalTaskDraftPayload {
  assistant_message: string;
  goals: DraftGoal[];
  tasks: DraftTask[];
  dependencies: DraftTaskDependency[];
  warnings: string[];
}

export interface GoalTaskDraftRequest {
  project_id: string;
  mode: GoalTaskDraftMode;
  user_message: string;
  goal_id?: string;
  task_id?: string;
  conversation?: DraftChatMessage[];
  current_draft?: GoalTaskDraftPayload | null;
}

export interface GoalTaskDraftResponse extends GoalTaskDraftPayload {
  success: boolean;
  mode: GoalTaskDraftMode;
  model?: string | null;
  generated_at: string;
}

export interface GoalTaskDraftApplyRequest {
  project_id: string;
  mode: GoalTaskDraftMode;
  goal_id?: string;
  task_id?: string;
  goals: DraftGoal[];
  tasks: DraftTask[];
  dependencies: DraftTaskDependency[];
  selected_goal_client_ids: string[];
  selected_task_client_ids: string[];
  original_task_action?: OriginalTaskAction;
}

export interface GoalTaskDraftApplyResponse {
  success: boolean;
  created_goals: Goal[];
  created_tasks: Task[];
  created_dependencies: Array<{
    id: string;
    task_id: string;
    depends_on_task_id: string;
    created_at: string;
  }>;
  updated_original_task_id?: string | null;
  warnings: string[];
}
