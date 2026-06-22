import type { TaskStatus, WorkType } from './task';

export type TriageRunSource = 'manual' | 'scheduled';
export type TriageRunStatus = 'ready' | 'applied' | 'partially_applied';
export type TriageRecommendation = 'keep' | 'cancel';
export type TriageTaskType = 'task' | 'quick_task';

export interface TriageCapacitySettings {
  id: string;
  user_id: string;
  weekly_capacity_hours: number;
  meeting_buffer_hours: number;
  project_allocations: Record<string, number>;
  inbox_allocation_percent: number;
  work_type_caps: Record<string, number>;
  cadence_days: number;
  auto_generate_enabled: boolean;
  use_ai_rank_adjustment: boolean;
  last_auto_triage_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TriageCapacitySettingsUpdate {
  weekly_capacity_hours: number;
  meeting_buffer_hours: number;
  project_allocations: Record<string, number>;
  inbox_allocation_percent: number;
  work_type_caps: Record<string, number>;
  cadence_days: number;
  auto_generate_enabled: boolean;
  use_ai_rank_adjustment: boolean;
}

export interface TriageItem {
  id: string;
  run_id: string;
  task_id: string | null;
  quick_task_id: string | null;
  item_type: TriageTaskType;
  title: string;
  description: string | null;
  project_id: string | null;
  project_title: string | null;
  goal_id: string | null;
  goal_title: string | null;
  status_at_generation: TaskStatus;
  priority: number;
  work_type: WorkType;
  estimate_hours: number;
  remaining_hours: number;
  due_date: string | null;
  bucket_key: string;
  bucket_title: string;
  deterministic_score: number;
  ai_score_delta: number;
  ai_reason: string | null;
  final_score: number;
  reason_codes: string[];
  task_snapshot: Record<string, unknown>;
  recommendation: TriageRecommendation;
  user_override: TriageRecommendation | null;
  applied_action: TriageRecommendation | null;
  applied_at: string | null;
  apply_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TriageRun {
  id: string;
  user_id: string;
  source: TriageRunSource;
  status: TriageRunStatus;
  summary: {
    weekly_capacity_hours?: number;
    meeting_buffer_hours?: number;
    effective_capacity_hours?: number;
    total_remaining_hours?: number;
    kept_hours?: number;
    cancel_candidate_hours?: number;
    overflow_hours?: number;
    total_items?: number;
    keep_items?: number;
    cancel_candidate_items?: number;
    buckets?: Record<string, {
      title: string;
      total_hours: number;
      kept_hours: number;
      cancel_hours: number;
      total_items: number;
      cancel_items: number;
    }>;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
  items: TriageItem[];
}

export interface TriageRunCreateRequest {
  use_ai_rank_adjustment?: boolean | null;
}

export interface TriageItemOverrideRequest {
  user_override: TriageRecommendation | null;
}

export interface TriageApplyRequest {
  item_ids?: string[] | null;
}

export interface TriageApplyResponse {
  success: boolean;
  run_id: string;
  applied_count: number;
  skipped_count: number;
  failed_count: number;
  errors: string[];
}
