import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/lib/api'
import type { Log, LogCreate, LogUpdate } from '@/types/log'
import { queryKeys } from '@/lib/query-keys'

/**
 * Query keys for log caching with React Query.
 * Re-exported from centralized query keys for backward compatibility.
 */
export const logKeys = queryKeys.logs

/**
 * Fetches logs for a specific task with pagination.
 *
 * @param taskId - The task UUID to fetch logs for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 50)
 * @returns UseQueryResult with log array
 */
export function useLogsByTask(taskId: string, skip = 0, limit = 50) {
  return useQuery({
    queryKey: logKeys.byTask(taskId),
    queryFn: () => logsApi.getByTask(taskId, skip, limit),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Batch fetches logs for multiple tasks efficiently.
 * Uses the batch API endpoint for optimized fetching.
 *
 * @param taskIds - Array of task UUIDs to fetch logs for
 * @returns UseQueryResult with logs grouped by task
 */
export function useBatchLogsQuery(taskIds: string[]) {
  return useQuery({
    queryKey: queryKeys.logs.batch(taskIds),
    queryFn: async () => {
      // Use the new batch API endpoint for efficient fetching
      return await logsApi.getBatch(taskIds);
    },
    enabled: taskIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Fetches a single log by ID.
 *
 * @param logId - The log UUID to fetch
 * @returns UseQueryResult with log data
 */
export function useLog(logId: string) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => logsApi.getById(logId),
    enabled: !!logId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Mutation hook for creating a new log.
 * Automatically invalidates log and progress cache on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useCreateLog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (logData: LogCreate) => logsApi.create(logData),
    onSuccess: (newLog: Log) => {
      // Invalidate logs for the specific task
      queryClient.invalidateQueries({
        queryKey: logKeys.byTask(newLog.task_id)
      })

      // Invalidate progress data as it depends on logs
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.all })

      // Add the new log to cache
      queryClient.setQueryData(
        logKeys.detail(newLog.id),
        newLog
      )
    },
  })
}

/**
 * Mutation hook for updating a log.
 * Updates cache and invalidates log and progress data on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useUpdateLog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LogUpdate }) =>
      logsApi.update(id, data),
    onSuccess: (updatedLog: Log) => {
      // Update the cached log
      queryClient.setQueryData(
        logKeys.detail(updatedLog.id),
        updatedLog
      )

      // Invalidate logs for the task to reflect changes in list view
      queryClient.invalidateQueries({
        queryKey: logKeys.byTask(updatedLog.task_id)
      })

      // Invalidate progress data as it depends on logs
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.all })
    },
  })
}

/**
 * Mutation hook for deleting a log.
 * Removes from cache and invalidates log and progress data on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteLog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (logId: string) => logsApi.delete(logId),
    onSuccess: (_, logId) => {
      // Get the log from cache to know which task to invalidate
      const cachedLog = queryClient.getQueryData<Log>(logKeys.detail(logId))

      // Remove log from cache
      queryClient.removeQueries({ queryKey: logKeys.detail(logId) })

      // Invalidate logs for the task if we know the task ID
      if (cachedLog?.task_id) {
        queryClient.invalidateQueries({
          queryKey: logKeys.byTask(cachedLog.task_id)
        })
      } else {
        // Fallback: invalidate all log lists
        queryClient.invalidateQueries({ queryKey: logKeys.lists() })
      }

      // Invalidate progress data as it depends on logs
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.all })
    },
  })
}

/**
 * Helper hook to calculate total actual minutes for a task.
 * Aggregates time from all logs associated with the task.
 *
 * @param taskId - The task UUID to calculate time for
 * @returns Object with totalMinutes, totalHours, and logs array
 */
export function useTaskActualMinutes(taskId: string) {
  const { data: logs = [] } = useLogsByTask(taskId)

  const totalMinutes = logs.reduce((sum, log) => sum + log.actual_minutes, 0)

  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    logs
  }
}
