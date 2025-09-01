import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import type { Task, TaskCreate, TaskUpdate } from '@/types/task'
import type { SortOptions } from '@/types/sort'

// Query keys for consistent caching
export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: string) => [...taskKeys.lists(), { filters }] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  byGoal: (goalId: string) => [...taskKeys.all, 'goal', goalId] as const,
  byProject: (projectId: string) => [...taskKeys.all, 'project', projectId] as const,
}

// Hook for fetching tasks by goal
export function useTasksByGoal(goalId: string, skip = 0, limit = 50, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: [...taskKeys.byGoal(goalId), sortKey],
    queryFn: () => tasksApi.getByGoal(goalId, skip, limit, sortOptions),
    enabled: !!goalId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for fetching tasks by project
export function useTasksByProject(projectId: string, skip = 0, limit = 50, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: [...taskKeys.byProject(projectId), sortKey],
    queryFn: () => tasksApi.getByProject(projectId, skip, limit, sortOptions),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for fetching a single task
export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => tasksApi.getById(taskId),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for creating a task
export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskData: TaskCreate) => tasksApi.create(taskData),
    onSuccess: (newTask: Task) => {
      // Invalidate tasks for the specific goal
      queryClient.invalidateQueries({
        queryKey: taskKeys.byGoal(newTask.goal_id)
      })

      // Invalidate tasks for the project if we have project_id
      // Note: We need to get the goal to know the project_id
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })

      // Add the new task to cache
      queryClient.setQueryData(
        taskKeys.detail(newTask.id),
        newTask
      )
    },
  })
}

// Hook for updating a task
export function useUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaskUpdate }) =>
      tasksApi.update(id, data),
    onSuccess: (updatedTask: Task) => {
      // Update the cached task
      queryClient.setQueryData(
        taskKeys.detail(updatedTask.id),
        updatedTask
      )

      // Invalidate tasks for the goal to reflect changes in list view
      queryClient.invalidateQueries({
        queryKey: taskKeys.byGoal(updatedTask.goal_id)
      })

      // Invalidate task lists as well
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// Hook for deleting a task
export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => tasksApi.delete(taskId),
    onSuccess: (_, taskId) => {
      // Get the task from cache to know which goal to invalidate
      const cachedTask = queryClient.getQueryData<Task>(taskKeys.detail(taskId))

      // Remove task from cache
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) })

      // Invalidate tasks for the goal if we know the goal ID
      if (cachedTask?.goal_id) {
        queryClient.invalidateQueries({
          queryKey: taskKeys.byGoal(cachedTask.goal_id)
        })
      } else {
        // Fallback: invalidate all task lists
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      }
    },
  })
}
