/**
 * React Query hooks for Reschedule Suggestions (Issue #227)
 *
 * Provides hooks for:
 * - Getting pending reschedule suggestions
 * - Getting a specific suggestion
 * - Accepting a suggestion
 * - Rejecting a suggestion
 * - Getting decision history
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rescheduleApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/**
 * Hook for getting pending reschedule suggestions.
 */
export function usePendingRescheduleSuggestions() {
  return useQuery({
    queryKey: queryKeys.reschedule.suggestions(),
    queryFn: () => rescheduleApi.getPendingSuggestions(),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for getting a specific reschedule suggestion.
 *
 * @param suggestionId - The suggestion ID
 */
export function useRescheduleSuggestion(suggestionId: string | null) {
  return useQuery({
    queryKey: queryKeys.reschedule.suggestion(suggestionId ?? ''),
    queryFn: () => rescheduleApi.getSuggestion(suggestionId!),
    enabled: !!suggestionId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook for accepting a reschedule suggestion.
 * Invalidates suggestions and schedule queries on success.
 */
export function useAcceptRescheduleSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ suggestionId, reason }: { suggestionId: string; reason?: string }) =>
      rescheduleApi.acceptSuggestion(suggestionId, reason),
    onSuccess: (result) => {
      // Invalidate suggestions list
      queryClient.invalidateQueries({ queryKey: queryKeys.reschedule.suggestions() });
      // Invalidate the specific suggestion
      queryClient.invalidateQueries({
        queryKey: queryKeys.reschedule.suggestion(result.id),
      });
      // Invalidate schedule to reflect the changes
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
    },
  });
}

/**
 * Hook for rejecting a reschedule suggestion.
 * Invalidates suggestions queries on success.
 */
export function useRejectRescheduleSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ suggestionId, reason }: { suggestionId: string; reason?: string }) =>
      rescheduleApi.rejectSuggestion(suggestionId, reason),
    onSuccess: (result) => {
      // Invalidate suggestions list
      queryClient.invalidateQueries({ queryKey: queryKeys.reschedule.suggestions() });
      // Invalidate the specific suggestion
      queryClient.invalidateQueries({
        queryKey: queryKeys.reschedule.suggestion(result.id),
      });
    },
  });
}

/**
 * Hook for getting reschedule decision history.
 *
 * @param limit - Maximum results (default: 50)
 */
export function useRescheduleDecisionHistory(limit = 50) {
  return useQuery({
    queryKey: queryKeys.reschedule.decisions(limit),
    queryFn: () => rescheduleApi.getDecisionHistory(limit),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Combined hook for reschedule suggestion management.
 * Provides all reschedule-related state and actions.
 */
export function useReschedule() {
  const pendingSuggestions = usePendingRescheduleSuggestions();
  const acceptMutation = useAcceptRescheduleSuggestion();
  const rejectMutation = useRejectRescheduleSuggestion();

  return {
    // State
    suggestions: pendingSuggestions.data ?? [],
    isLoading: pendingSuggestions.isLoading,
    error: pendingSuggestions.error,

    // Actions
    acceptSuggestion: (suggestionId: string, reason?: string) =>
      acceptMutation.mutateAsync({ suggestionId, reason }),
    rejectSuggestion: (suggestionId: string, reason?: string) =>
      rejectMutation.mutateAsync({ suggestionId, reason }),

    // Mutation states
    isAccepting: acceptMutation.isPending,
    isRejecting: rejectMutation.isPending,
    acceptError: acceptMutation.error,
    rejectError: rejectMutation.error,

    // Refetch
    refetch: pendingSuggestions.refetch,
  };
}
