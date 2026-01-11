/**
 * Work Session types for Runner/Focus mode
 */

import type { Log } from './log';
import type { Task } from './task';

/**
 * Checkout type for work sessions
 */
export type CheckoutType = 'manual' | 'scheduled' | 'overdue' | 'interrupted';

/**
 * Decision made at session checkout
 */
export type SessionDecision = 'continue' | 'switch' | 'break' | 'complete';

/**
 * Reason for continuing a session
 */
export type ContinueReason =
  | 'good_stopping_point'
  | 'waiting_for_blocker'
  | 'need_research'
  | 'in_flow_state'
  | 'unexpected_complexity'
  | 'time_constraint'
  | 'other';

/**
 * Work session entity
 */
export interface WorkSession {
  id: string;
  user_id: string;
  task_id: string;
  started_at: string;
  planned_checkout_at: string;
  ended_at: string | null;
  checkout_type: CheckoutType | null;
  decision: SessionDecision | null;
  continue_reason: ContinueReason | null;
  kpt_keep: string | null;
  kpt_problem: string | null;
  kpt_try: string | null;
  remaining_estimate_hours: number | null;
  planned_outcome: string | null;
  actual_minutes: number | null;
  created_at: string;
  updated_at: string;

  // Issue #228: Notification/escalation fields
  snooze_count?: number;
  last_snooze_at?: string | null;
  notification_5min_sent?: boolean;
  notification_checkout_sent?: boolean;
  marked_unresponsive_at?: string | null;

  // Optional task relation for unresponsive dialog
  task?: Task;
}

/**
 * Request model for starting a work session
 */
export interface WorkSessionStartRequest {
  task_id: string;
  planned_checkout_at: string;
  planned_outcome?: string;
}

/**
 * Request model for checking out a work session
 */
export interface WorkSessionCheckoutRequest {
  checkout_type?: CheckoutType;
  decision: SessionDecision;
  continue_reason?: ContinueReason;
  kpt_keep?: string;
  kpt_problem?: string;
  kpt_try?: string;
  remaining_estimate_hours?: number;
  next_task_id?: string;
}

/**
 * Request model for updating a work session's KPT fields
 */
export interface WorkSessionUpdateRequest {
  kpt_keep?: string;
  kpt_problem?: string;
  kpt_try?: string;
}

/**
 * Work session response with generated log
 */
export interface WorkSessionWithLog extends WorkSession {
  generated_log?: Log;
}

/**
 * Continue reason labels for UI display
 */
export const CONTINUE_REASON_LABELS: Record<ContinueReason, string> = {
  good_stopping_point: 'キリが良い',
  waiting_for_blocker: 'ブロッカー解消待ち',
  need_research: '調査が必要',
  in_flow_state: '集中が乗っている',
  unexpected_complexity: '想定外の難しさ',
  time_constraint: '時間の制約',
  other: 'その他',
};

/**
 * Session decision labels for UI display
 */
export const SESSION_DECISION_LABELS: Record<SessionDecision, string> = {
  continue: '継続',
  switch: '切替',
  break: '休憩',
  complete: '完了',
};

/**
 * Checkout type labels for UI display
 */
export const CHECKOUT_TYPE_LABELS: Record<CheckoutType, string> = {
  manual: '手動',
  scheduled: '予定通り',
  overdue: '超過',
  interrupted: '中断',
};
