import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/lib/api'
import type { Log, LogCreate, LogUpdate } from '@/types/log'

// Query keys for consistent caching
export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (filters: string) => [...logKeys.lists(), { filters }] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (id: string) => [...logKeys.details(), id] as const,
  byTask: (taskId: string) => [...logKeys.all, 'task', taskId] as const,
}

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
    queryKey: ['logs', 'batch', ...taskIds.sort()],
    queryFn: async () => {
      const results: Record<string, Log[]> = {};
      
      // Fetch logs for all tasks in parallel
      const promises = taskIds.map(async (taskId) => {
        try {
          const logs = await logsApi.getByTask(taskId);
          return { taskId, logs };
        } catch (error) {
          console.error(`Failed to fetch logs for task ${taskId}:`, error);
          return { taskId, logs: [] };
        }
      });
      
      const responses = await Promise.all(promises);
      
      responses.forEach(({ taskId, logs }) => {
        results[taskId] = logs;
      });
      
      return results;
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
      queryClient.invalidateQueries({ queryKey: ['progress'] })

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
      queryClient.invalidateQueries({ queryKey: ['progress'] })
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
      queryClient.invalidateQueries({ queryKey: ['progress'] })
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