/**
 * Reschedule types for checkout-based rescheduling (Issue #227)
 */

import type { WorkSessionWithLog } from './work-session';

/**
 * Status of a reschedule suggestion
 */
export type RescheduleSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/**
 * Trigger type for reschedule suggestion
 */
export type RescheduleTriggerType = 'checkout' | 'overdue_recovery';

/**
 * Type of change in the schedule diff
 */
export type ScheduleChangeType = 'pushed' | 'added' | 'removed' | 'reordered';

/**
 * Individual diff item in a schedule change
 */
export interface ScheduleDiffItem {
  task_id: string;
  task_title: string;
  change_type: ScheduleChangeType;
  original_slot_index: number | null;
  new_slot_index: number | null;
  reason: string;
}

/**
 * Schedule diff between original and proposed schedules
 */
export interface ScheduleDiff {
  pushed_tasks: ScheduleDiffItem[];
  added_tasks: ScheduleDiffItem[];
  removed_tasks: ScheduleDiffItem[];
  reordered_tasks: ScheduleDiffItem[];
  total_changes: number;
  has_significant_changes: boolean;
}

/**
 * Reschedule suggestion entity
 */
export interface RescheduleSuggestion {
  id: string;
  user_id: string;
  work_session_id: string;
  trigger_type: RescheduleTriggerType;
  trigger_decision: string | null;
  original_schedule_json: Record<string, unknown>;
  proposed_schedule_json: Record<string, unknown>;
  diff_json: Record<string, unknown>;
  diff?: ScheduleDiff;
  status: RescheduleSuggestionStatus;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
}

/**
 * Request model for accepting/rejecting a reschedule suggestion
 */
export interface RescheduleDecisionRequest {
  reason?: string;
}

/**
 * Reschedule decision entity (for history)
 */
export interface RescheduleDecision {
  id: string;
  suggestion_id: string;
  user_id: string;
  accepted: boolean;
  reason: string | null;
  context_json: Record<string, unknown>;
  created_at: string;
}

/**
 * Work session response with optional reschedule suggestion
 */
export interface WorkSessionWithReschedule {
  session: WorkSessionWithLog;
  reschedule_suggestion: RescheduleSuggestion | null;
}

/**
 * Labels for change types in UI
 */
export const CHANGE_TYPE_LABELS: Record<ScheduleChangeType, string> = {
  pushed: '後ろにずれた',
  added: '追加',
  removed: '延期',
  reordered: '順序変更',
};

/**
 * Colors for change types in UI (Tailwind classes)
 */
export const CHANGE_TYPE_COLORS: Record<ScheduleChangeType, { bg: string; text: string; border: string }> = {
  pushed: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  added: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  removed: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200' },
  reordered: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
};

/**
 * Status labels for UI
 */
export const SUGGESTION_STATUS_LABELS: Record<RescheduleSuggestionStatus, string> = {
  pending: '保留中',
  accepted: '採用済み',
  rejected: '不採用',
  expired: '期限切れ',
};
