/**
 * React Query hooks for Work Sessions (Runner/Focus mode)
 *
 * Provides hooks for:
 * - Getting current active session
 * - Starting a new session
 * - Checking out (ending) a session
 * - Getting session history
 * - Getting sessions by task
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workSessionsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  WorkSession,
  WorkSessionStartRequest,
  WorkSessionCheckoutRequest,
  WorkSessionUpdateRequest,
  WorkSessionWithLog,
} from '@/types/work-session';

/**
 * Hook for getting the current active session.
 * Polls every 60 seconds to detect overdue sessions.
 */
export function useCurrentWorkSession() {
  return useQuery({
    queryKey: queryKeys.workSessions.current(),
    queryFn: () => workSessionsApi.getCurrent(),
    refetchInterval: 60 * 1000, // Poll every minute for overdue detection
    staleTime: 30 * 1000, // Consider data stale after 30 seconds
  });
}

/**
 * Hook for getting session history.
 *
 * @param skip - Pagination offset
 * @param limit - Maximum results
 */
export function useWorkSessionHistory(skip = 0, limit = 20) {
  return useQuery({
    queryKey: queryKeys.workSessions.history(skip, limit),
    queryFn: () => workSessionsApi.getHistory(skip, limit),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for getting sessions by task.
 *
 * @param taskId - The task ID
 * @param skip - Pagination offset
 * @param limit - Maximum results
 */
export function useWorkSessionsByTask(taskId: string, skip = 0, limit = 20) {
  return useQuery({
    queryKey: queryKeys.workSessions.byTask(taskId, skip, limit),
    queryFn: () => workSessionsApi.getByTask(taskId, skip, limit),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for starting a new work session.
 * Invalidates current session and history queries on success.
 */
export function useStartWorkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: WorkSessionStartRequest) => workSessionsApi.start(data),
    onSuccess: (_result, data) => {
      // Invalidate session queries
      queryClient.invalidateQueries({ queryKey: queryKeys.workSessions.current() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'history',
      });
      // Invalidate byTask cache for the started task
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'task' && query.queryKey[2] === data.task_id,
      });
    },
  });
}

/**
 * Hook for checking out (ending) the current session.
 * Invalidates session, log, and progress queries on success.
 */
export function useCheckoutWorkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: WorkSessionCheckoutRequest) => workSessionsApi.checkout(data),
    onSuccess: (result: WorkSessionWithLog) => {
      // Invalidate session queries
      queryClient.invalidateQueries({ queryKey: queryKeys.workSessions.current() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'history',
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'task' && query.queryKey[2] === result.task_id,
      });

      // Invalidate log and progress queries (log was auto-created)
      if (result.generated_log) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.logs.byTask(result.task_id),
        });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.all });
    },
  });
}

/**
 * Hook for updating a work session's KPT fields.
 * Invalidates session history and byTask queries on success.
 */
export function useUpdateWorkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: WorkSessionUpdateRequest }) =>
      workSessionsApi.update(sessionId, data),
    onSuccess: (result: WorkSession) => {
      // Invalidate session history queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'history',
      });
      // Invalidate byTask cache for the updated session's task
      queryClient.invalidateQueries({
        queryKey: queryKeys.workSessions.all,
        predicate: (query) => query.queryKey[1] === 'task' && query.queryKey[2] === result.task_id,
      });
    },
  });
}

/**
 * Helper function to check if a session is overdue.
 *
 * @param session - The work session to check
 * @returns Object with isOverdue boolean and minutes overdue
 */
export function getSessionOverdueStatus(session: WorkSession | null | undefined) {
  if (!session || session.ended_at) {
    return { isOverdue: false, minutesOverdue: 0 };
  }

  const plannedCheckout = new Date(session.planned_checkout_at);
  const now = new Date();
  const diffMs = now.getTime() - plannedCheckout.getTime();
  const minutesOverdue = Math.floor(diffMs / (1000 * 60));

  return {
    isOverdue: minutesOverdue > 0,
    minutesOverdue: Math.max(0, minutesOverdue),
  };
}

/**
 * Helper function to calculate remaining time until checkout.
 *
 * @param session - The work session
 * @returns Object with remaining time info
 */
export function getSessionRemainingTime(session: WorkSession | null | undefined) {
  if (!session || session.ended_at) {
    return { hasSession: false, minutesRemaining: 0, isOverdue: false };
  }

  const plannedCheckout = new Date(session.planned_checkout_at);
  const now = new Date();
  const diffMs = plannedCheckout.getTime() - now.getTime();
  const minutesRemaining = Math.floor(diffMs / (1000 * 60));

  return {
    hasSession: true,
    minutesRemaining: Math.max(0, minutesRemaining),
    isOverdue: minutesRemaining < 0,
  };
}
