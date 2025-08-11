import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { goalsApi } from '@/lib/api'
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal'

// Query keys for consistent caching
export const goalKeys = {
  all: ['goals'] as const,
  lists: () => [...goalKeys.all, 'list'] as const,
  list: (filters: string) => [...goalKeys.lists(), { filters }] as const,
  details: () => [...goalKeys.all, 'detail'] as const,
  detail: (id: string) => [...goalKeys.details(), id] as const,
  byProject: (projectId: string) => [...goalKeys.all, 'project', projectId] as const,
}

// Hook for fetching goals by project
export function useGoalsByProject(projectId: string, skip = 0, limit = 20) {
  return useQuery({
    queryKey: goalKeys.byProject(projectId),
    queryFn: () => goalsApi.getByProject(projectId, skip, limit),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for fetching a single goal
export function useGoal(goalId: string) {
  return useQuery({
    queryKey: goalKeys.detail(goalId),
    queryFn: () => goalsApi.getById(goalId),
    enabled: !!goalId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for creating a goal
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

// Hook for updating a goal
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

// Hook for deleting a goal
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
