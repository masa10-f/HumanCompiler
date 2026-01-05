import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { goalsApi } from '@/lib/api'
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal'
import type { SortOptions } from '@/types/sort'

/**
 * Query keys for goal caching with React Query.
 * Provides consistent cache key structure for all goal-related queries.
 */
export const goalKeys = {
  all: ['goals'] as const,
  lists: () => [...goalKeys.all, 'list'] as const,
  list: (filters: string) => [...goalKeys.lists(), { filters }] as const,
  details: () => [...goalKeys.all, 'detail'] as const,
  detail: (id: string) => [...goalKeys.details(), id] as const,
  byProject: (projectId: string) => [...goalKeys.all, 'project', projectId] as const,
}

/**
 * Fetches goals for a specific project with pagination and sorting.
 *
 * @param projectId - The project UUID to fetch goals for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 20)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with goal array
 */
export function useGoalsByProject(projectId: string, skip = 0, limit = 20, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: [...goalKeys.byProject(projectId), sortKey],
    queryFn: () => goalsApi.getByProject(projectId, skip, limit, sortOptions),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Fetches a single goal by ID.
 *
 * @param goalId - The goal UUID to fetch
 * @returns UseQueryResult with goal data
 */
export function useGoal(goalId: string) {
  return useQuery({
    queryKey: goalKeys.detail(goalId),
    queryFn: () => goalsApi.getById(goalId),
    enabled: !!goalId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Mutation hook for creating a new goal.
 * Automatically invalidates goal cache for the project on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useCreateGoal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (goalData: GoalCreate) => goalsApi.create(goalData),
    onSuccess: (newGoal: Goal) => {
      // Invalidate goals for the specific project
      queryClient.invalidateQueries({
        queryKey: goalKeys.byProject(newGoal.project_id)
      })

      // Add the new goal to cache
      queryClient.setQueryData(
        goalKeys.detail(newGoal.id),
        newGoal
      )
    },
  })
}

/**
 * Mutation hook for updating a goal.
 * Updates cache and invalidates goal lists on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useUpdateGoal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: GoalUpdate }) =>
      goalsApi.update(id, data),
    onSuccess: (updatedGoal: Goal) => {
      // Update the cached goal
      queryClient.setQueryData(
        goalKeys.detail(updatedGoal.id),
        updatedGoal
      )

      // Invalidate goals for the project to reflect changes in list view
      queryClient.invalidateQueries({
        queryKey: goalKeys.byProject(updatedGoal.project_id)
      })
    },
  })
}

/**
 * Mutation hook for deleting a goal.
 * Removes from cache and invalidates goal lists on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteGoal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (goalId: string) => goalsApi.delete(goalId),
    onSuccess: (_, goalId) => {
      // Get the goal from cache to know which project to invalidate
      const cachedGoal = queryClient.getQueryData<Goal>(goalKeys.detail(goalId))

      // Remove goal from cache
      queryClient.removeQueries({ queryKey: goalKeys.detail(goalId) })

      // Invalidate goals for the project if we know the project ID
      if (cachedGoal?.project_id) {
        queryClient.invalidateQueries({
          queryKey: goalKeys.byProject(cachedGoal.project_id)
        })
      } else {
        // Fallback: invalidate all goal lists
        queryClient.invalidateQueries({ queryKey: goalKeys.lists() })
      }
    },
  })
}
