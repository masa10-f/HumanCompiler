/**
 * Runner/Focus mode hook
 *
 * Combines work session management with schedule data
 * to provide a complete Runner experience.
 *
 * Issue #228: Added notification integration for checkout reminders.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCurrentWorkSession,
  useStartWorkSession,
  useCheckoutWorkSession,
  usePauseWorkSession,
  useResumeWorkSession,
  getSessionOverdueStatus,
  isSessionPaused,
} from './use-work-sessions';
import { useCountdown } from './use-countdown';
import { useNotifications } from './use-notifications';
import { schedulingApi, tasksApi, goalsApi, projectsApi, workSessionsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { SessionDecision } from '@/types/work-session';
import type { RescheduleSuggestion, WorkSessionWithReschedule } from '@/types/reschedule';
import type {
  UseRunnerReturn,
  TaskCandidate,
  CurrentSessionDetails,
  RunnerSessionStatus,
  CheckoutOptions,
} from '@/types/runner';

/**
 * Get today's date in YYYY-MM-DD format (JST)
 *
 * Computes JST based on UTC to avoid dependence on the local system timezone.
 */
function getJSTDateString(): string {
  const now = new Date();
  // Convert current local time to UTC milliseconds
  const utcMillis = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  // JST is UTC+9
  const jstMillis = utcMillis + 9 * 60 * 60 * 1000;
  const jstTime = new Date(jstMillis);
  const datePart = jstTime.toISOString().split('T')[0];
  return datePart ?? now.toISOString().slice(0, 10);
}

/**
 * Hook for Runner/Focus mode functionality
 *
 * Provides:
 * - Current session state with task details
 * - Real-time countdown timer
 * - Today's schedule for task selection
 * - Session start/checkout actions
 */
export function useRunner(): UseRunnerReturn {
  const queryClient = useQueryClient();

  // Get current session (60s polling)
  const {
    data: session,
    isLoading: sessionLoading,
    refetch: refetchSession,
  } = useCurrentWorkSession();

  // Get today's schedule
  const today = getJSTDateString();
  const {
    data: todaySchedule,
    isLoading: scheduleLoading,
    refetch: refetchSchedule,
  } = useQuery({
    queryKey: queryKeys.schedule.daily(today),
    queryFn: () => schedulingApi.getByDate(today),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry if schedule doesn't exist
  });

  // Get session details (task, goal, project)
  const { data: sessionDetails, isLoading: detailsLoading } = useQuery({
    queryKey: ['runner', 'sessionDetails', session?.task_id],
    queryFn: async (): Promise<CurrentSessionDetails | null> => {
      if (!session) return null;

      try {
        const task = await tasksApi.getById(session.task_id);
        let goal = null;
        let project = null;

        if (task.goal_id) {
          try {
            goal = await goalsApi.getById(task.goal_id);
            if (goal?.project_id) {
              project = await projectsApi.getById(goal.project_id);
            }
          } catch {
            // Goal or project not found, continue without
          }
        }

        return { session, task, goal, project };
      } catch {
        return null;
      }
    },
    enabled: !!session?.task_id,
    staleTime: 60 * 1000, // 1 minute
  });

  // Mutations
  const startMutation = useStartWorkSession();
  const checkoutMutation = useCheckoutWorkSession();
  const pauseMutation = usePauseWorkSession();
  const resumeMutation = useResumeWorkSession();

  // Issue #228: Notification integration
  const {
    currentNotification,
    hasPermission: hasNotificationPermission,
    isSubscribed: isNotificationSubscribed,
    isConnected: isWebSocketConnected,
    isSupported: isNotificationSupported,
    requestPermission: requestNotificationPermission,
    subscribe: subscribeToNotifications,
    dismissNotification,
    snooze,
    isSnoozing,
  } = useNotifications();

  // Wrap snooze to refetch session after success (Issue #244 fix)
  const snoozeSession = async () => {
    const result = await snooze();
    // Refetch session to update snooze_count in UI
    await refetchSession();
    return result;
  };

  // Issue #228: Check for unresponsive session on mount
  const {
    data: unresponsiveSession,
    refetch: refetchUnresponsive,
  } = useQuery({
    queryKey: queryKeys.workSessions.unresponsive(),
    queryFn: () => workSessionsApi.getUnresponsive(),
    enabled: !session, // Only check when no active session
    staleTime: 0,
    retry: false,
  });

  // Check if session is paused
  const isPaused = isSessionPaused(session);

  // Countdown timer (pass paused_at to freeze countdown when paused)
  const countdown = useCountdown(
    session?.planned_checkout_at,
    session?.started_at,
    session?.paused_at
  );

  // Calculate session status
  const overdueStatus = getSessionOverdueStatus(session);
  const sessionStatus: RunnerSessionStatus = !session
    ? 'idle'
    : isPaused
      ? 'paused'
      : overdueStatus.isOverdue
        ? 'overdue'
        : 'active';

  // Extract next task candidates from today's schedule
  const nextCandidates: TaskCandidate[] = (() => {
    if (!todaySchedule?.plan_json?.assignments) return [];

    const now = new Date();
    const currentTaskId = session?.task_id;

    // Filter and map assignments to candidates
    return todaySchedule.plan_json.assignments
      .filter((assignment) => {
        // Exclude current task
        if (assignment.task_id === currentTaskId) return false;

        // Only include future tasks (or use all if no session)
        if (session) {
          // Validate time format HH:MM before parsing
          const timeMatch = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(assignment.start_time);
          if (!timeMatch) {
            // Invalid format - include task by default
            return true;
          }
          const hours = Number(timeMatch[1]);
          const minutes = Number(timeMatch[2]);
          const assignmentTime = new Date();
          assignmentTime.setHours(hours, minutes, 0, 0);
          return assignmentTime >= now;
        }
        return true;
      })
      .slice(0, 3) // Max 3 candidates
      .map((assignment) => ({
        task_id: assignment.task_id,
        task_title: assignment.task_title,
        goal_id: assignment.goal_id,
        project_id: assignment.project_id,
        scheduled_start: assignment.start_time,
        scheduled_end: assignment.slot_end,
        duration_hours: assignment.duration_hours,
        slot_kind: assignment.slot_kind,
      }));
  })();

  // Actions
  const startSession = async (
    taskId: string,
    plannedCheckoutAt: string,
    plannedOutcome?: string
  ): Promise<void> => {
    await startMutation.mutateAsync({
      task_id: taskId,
      planned_checkout_at: plannedCheckoutAt,
      planned_outcome: plannedOutcome,
    });
  };

  const checkout = async (
    decision: SessionDecision,
    options?: CheckoutOptions
  ): Promise<RescheduleSuggestion | null> => {
    const result = await checkoutMutation.mutateAsync({
      decision,
      checkout_type: options?.checkout_type,
      continue_reason: options?.continue_reason,
      kpt_keep: options?.kpt_keep,
      kpt_problem: options?.kpt_problem,
      kpt_try: options?.kpt_try,
      remaining_estimate_hours: options?.remaining_estimate_hours,
      next_task_id: options?.next_task_id,
    });

    // Invalidate related queries
    queryClient.invalidateQueries({ queryKey: ['runner'] });

    // Return reschedule suggestion if present (Issue #227)
    return result.reschedule_suggestion ?? null;
  };

  const pauseSession = async (): Promise<void> => {
    await pauseMutation.mutateAsync();
    queryClient.invalidateQueries({ queryKey: ['runner'] });
  };

  const resumeSession = async (extendCheckout: boolean = true): Promise<void> => {
    await resumeMutation.mutateAsync({ extend_checkout: extendCheckout });
    queryClient.invalidateQueries({ queryKey: ['runner'] });
  };

  return {
    // State
    session: session ?? null,
    sessionDetails: sessionDetails ?? null,
    sessionStatus,
    remainingSeconds: countdown.seconds,
    isOverdue: countdown.isOverdue,
    isPaused,
    nextCandidates,
    todaySchedule: todaySchedule ?? null,

    // Loading states
    isLoading: sessionLoading || scheduleLoading || detailsLoading,
    isStarting: startMutation.isPending,
    isCheckingOut: checkoutMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,

    // Actions
    startSession,
    checkout,
    pauseSession,
    resumeSession,

    // Refresh
    refetchSession,
    refetchSchedule,

    // Issue #228: Notification state
    currentNotification: currentNotification ?? null,
    hasNotificationPermission,
    isNotificationSubscribed,
    isWebSocketConnected,
    isNotificationSupported,
    unresponsiveSession: unresponsiveSession ?? null,
    snoozeCount: session?.snooze_count ?? 0,
    maxSnoozeCount: 2,

    // Issue #228: Notification actions
    requestNotificationPermission,
    subscribeToNotifications,
    dismissNotification,
    snoozeSession,
    isSnoozing,
    refetchUnresponsive,
  };
}
