/**
 * Runner/Focus mode type definitions
 */

import type { WorkSession, SessionDecision, ContinueReason } from './work-session';
import type { Task } from './task';
import type { Goal } from './goal';
import type { Project } from './project';
import type { DailySchedule } from './api-responses';
import type { NotificationMessage, SnoozeResponse } from './notification';

/**
 * Runner session status
 */
export type RunnerSessionStatus = 'idle' | 'active' | 'paused' | 'overdue';

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
  isPaused: boolean;
  nextCandidates: TaskCandidate[];
  todaySchedule: DailySchedule | null;

  // Loading states
  isLoading: boolean;
  isStarting: boolean;
  isCheckingOut: boolean;
  isPausing: boolean;
  isResuming: boolean;

  // Actions
  startSession: (
    taskId: string,
    plannedCheckoutAt: string,
    plannedOutcome?: string
  ) => Promise<void>;
  checkout: (decision: SessionDecision, options?: CheckoutOptions) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: (extendCheckout?: boolean) => Promise<void>;

  // Refresh
  refetchSession: () => void;
  refetchSchedule: () => void;

  // Issue #228: Notification state
  currentNotification: NotificationMessage | null;
  hasNotificationPermission: boolean;
  isNotificationSubscribed: boolean;
  isWebSocketConnected: boolean;
  isNotificationSupported: boolean;
  unresponsiveSession: WorkSession | null;
  snoozeCount: number;
  maxSnoozeCount: number;

  // Issue #228: Notification actions
  requestNotificationPermission: () => Promise<boolean>;
  subscribeToNotifications: () => Promise<void>;
  dismissNotification: () => void;
  snoozeSession: () => Promise<SnoozeResponse>;
  isSnoozing: boolean;
  refetchUnresponsive: () => void;
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
 * Validates input format and handles day overflow explicitly
 */
export function calculateEndTime(startTime: string, durationHours: number): string {
  // Validate input as HH:MM (24-hour) before parsing
  const timeMatch = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (!timeMatch) {
    // If the input format is invalid, return it unchanged
    return startTime;
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  const totalMinutes = hours * 60 + minutes + durationHours * 60;
  const endTotalHours = Math.floor(totalMinutes / 60);
  const endMinutes = Math.floor(totalMinutes % 60);
  const dayOffset = Math.floor(endTotalHours / 24);
  const endHoursInDay = ((endTotalHours % 24) + 24) % 24;

  const timeString = `${endHoursInDay.toString().padStart(2, '0')}:${endMinutes
    .toString()
    .padStart(2, '0')}`;

  // If the end time is on a later day, make this explicit
  if (dayOffset > 0) {
    return `${timeString}+${dayOffset}d`;
  }

  return timeString;
}
