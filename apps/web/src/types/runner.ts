/**
 * Runner/Focus mode type definitions
 */

import type { WorkSession, SessionDecision, ContinueReason } from './work-session';
import type { Task } from './task';
import type { Goal } from './goal';
import type { Project } from './project';
import type { DailySchedule } from './api-responses';

/**
 * Runner session status
 */
export type RunnerSessionStatus = 'idle' | 'active' | 'overdue';

/**
 * Task candidate from today's schedule
 */
export interface TaskCandidate {
  task_id: string;
  task_title: string;
  goal_id: string;
  project_id: string;
  scheduled_start: string;
  scheduled_end: string;
  duration_hours: number;
  slot_kind: string;
}

/**
 * Current session with task, goal, and project details
 */
export interface CurrentSessionDetails {
  session: WorkSession;
  task: Task;
  goal: Goal | null;
  project: Project | null;
}

/**
 * Options for checkout action
 */
export interface CheckoutOptions {
  checkout_type?: 'manual' | 'scheduled' | 'overdue' | 'interrupted';
  continue_reason?: ContinueReason;
  kpt_keep?: string;
  kpt_problem?: string;
  kpt_try?: string;
  remaining_estimate_hours?: number;
  next_task_id?: string;
}

/**
 * useRunner hook return type
 */
export interface UseRunnerReturn {
  // State
  session: WorkSession | null;
  sessionDetails: CurrentSessionDetails | null;
  sessionStatus: RunnerSessionStatus;
  remainingSeconds: number;
  isOverdue: boolean;
  nextCandidates: TaskCandidate[];
  todaySchedule: DailySchedule | null;

  // Loading states
  isLoading: boolean;
  isStarting: boolean;
  isCheckingOut: boolean;

  // Actions
  startSession: (
    taskId: string,
    plannedCheckoutAt: string,
    plannedOutcome?: string
  ) => Promise<void>;
  checkout: (decision: SessionDecision, options?: CheckoutOptions) => Promise<void>;

  // Refresh
  refetchSession: () => void;
  refetchSchedule: () => void;
}

/**
 * Format seconds to HH:MM:SS display string
 */
export function formatDuration(seconds: number): string {
  const absSeconds = Math.abs(seconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const secs = absSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const prefix = seconds < 0 ? '+' : '';

  return `${prefix}${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/**
 * Calculate end time from start time and duration
 */
export function calculateEndTime(startTime: string, durationHours: number): string {
  const timeParts = startTime.split(':').map(Number);
  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;
  const totalMinutes = hours * 60 + minutes + durationHours * 60;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = Math.floor(totalMinutes % 60);
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
}
