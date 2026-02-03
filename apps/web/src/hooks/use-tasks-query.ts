import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import type { Task, TaskCreate, TaskUpdate } from '@/types/task'
import type { SortOptions } from '@/types/sort'

/**
 * Query keys for task caching with React Query.
 * Provides consistent cache key structure for all task-related queries.
 */
export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: string) => [...taskKeys.lists(), { filters }] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  byGoal: (goalId: string) => [...taskKeys.all, 'goal', goalId] as const,
  byProject: (projectId: string) => [...taskKeys.all, 'project', projectId] as const,
}

/**
 * Fetches tasks for a specific goal with pagination and sorting.
 *
 * @param goalId - The goal UUID to fetch tasks for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 50)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with task array
 */
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

/**
 * Fetches tasks for a specific project with pagination and sorting.
 *
 * @param projectId - The project UUID to fetch tasks for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 50)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with task array
 */
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

/**
 * Fetches a single task by ID.
 *
 * @param taskId - The task UUID to fetch
 * @returns UseQueryResult with task data
 */
export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => tasksApi.getById(taskId),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Mutation hook for creating a new task.
 * Automatically invalidates task cache for the goal on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
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

/**
 * Mutation hook for updating a task.
 * Updates cache and invalidates task lists on success.
 * Cache invalidation is delayed to allow dialog close animation to complete,
 * preventing UI freeze from Radix UI cleanup issues.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaskUpdate }) =>
      tasksApi.update(id, data),
    onSuccess: (updatedTask: Task) => {
      // Update the cached task immediately
      queryClient.setQueryData(
        taskKeys.detail(updatedTask.id),
        updatedTask
      )

      // Delay cache invalidation to allow dialog close animation to complete
      // This prevents Radix UI dialog cleanup issues that cause UI freeze
      setTimeout(() => {
        // Force reset body styles in case Radix UI dialog cleanup failed
        if (typeof document !== 'undefined') {
          document.body.style.pointerEvents = ''
          document.body.style.overflow = ''
        }

        // Invalidate tasks for the goal to reflect changes in list view
        queryClient.invalidateQueries({
          queryKey: taskKeys.byGoal(updatedTask.goal_id)
        })

        // Invalidate task lists as well
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      }, 300)
    },
  })
}

/**
 * Mutation hook for deleting a task.
 * Removes from cache and invalidates task lists on success.
 * Cache invalidation is delayed to allow dialog close animation to complete,
 * preventing UI freeze from Radix UI cleanup issues.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => tasksApi.delete(taskId),
    onSuccess: (_, taskId) => {
      // Get the task from cache to know which goal to invalidate
      const cachedTask = queryClient.getQueryData<Task>(taskKeys.detail(taskId))
      const goalId = cachedTask?.goal_id

      // Remove task from cache immediately
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) })

      // Delay cache invalidation to allow dialog close animation to complete
      // This prevents Radix UI dialog cleanup issues that cause UI freeze
      setTimeout(() => {
        // Force reset body styles in case Radix UI dialog cleanup failed
        if (typeof document !== 'undefined') {
          document.body.style.pointerEvents = ''
          document.body.style.overflow = ''
        }

        if (goalId) {
          queryClient.invalidateQueries({
            queryKey: taskKeys.byGoal(goalId)
          })
        } else {
          // Fallback: invalidate all task lists
          queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
        }
      }, 300)
    },
  })
}
