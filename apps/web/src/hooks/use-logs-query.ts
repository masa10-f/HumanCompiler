import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/lib/api'
import type { Log, LogCreate, LogUpdate } from '@/types/log'
import { queryKeys } from '@/lib/query-keys'

// Re-export log keys for backward compatibility
export const logKeys = queryKeys.logs

// Hook for fetching logs by task
export function useLogsByTask(taskId: string, skip = 0, limit = 50) {
  return useQuery({
    queryKey: logKeys.byTask(taskId),
    queryFn: () => logsApi.getByTask(taskId, skip, limit),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for batch fetching logs for multiple tasks
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

// Hook for fetching a single log
export function useLog(logId: string) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => logsApi.getById(logId),
    enabled: !!logId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for creating a log
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

// Hook for updating a log
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

// Hook for deleting a log
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

// Helper hook to calculate total actual minutes for a task
export function useTaskActualMinutes(taskId: string) {
  const { data: logs = [] } = useLogsByTask(taskId)

  const totalMinutes = logs.reduce((sum, log) => sum + log.actual_minutes, 0)

  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    logs
  }
}
