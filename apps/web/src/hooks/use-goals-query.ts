import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useCallback } from 'react'
import { goalsApi } from '@/lib/api'
import { logger } from '@/lib/logger'
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
  projects: () => [...goalKeys.all, 'project'] as const,
  byProject: (projectId: string) => [...goalKeys.projects(), projectId] as const,
  projectList: (
    projectId: string,
    skip: number,
    limit: number,
    sortKey: string,
  ) => [...goalKeys.byProject(projectId), { skip, limit, sort: sortKey }] as const,
}

export const GOAL_STALE_TIME = 10 * 60 * 1000
export const GOAL_GC_TIME = 24 * 60 * 60 * 1000

function goalsByProjectQueryOptions(
  projectId: string,
  skip = 0,
  limit = 20,
  sortOptions?: SortOptions,
) {
  const sortKey = sortOptions
    ? `${sortOptions.sortBy}-${sortOptions.sortOrder}`
    : 'default'

  return {
    queryKey: goalKeys.projectList(projectId, skip, limit, sortKey),
    queryFn: async () => {
      const goals = await goalsApi.getByProject(
        projectId,
        skip,
        limit,
        sortOptions,
      )

      if (goals.length === limit) {
        logger.warn(
          'Goal list may be truncated',
          { projectId, skip, limit },
          { component: 'goalsByProjectQueryOptions' },
        )
      }

      return goals
    },
    staleTime: GOAL_STALE_TIME,
    gcTime: GOAL_GC_TIME,
  }
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
  return useQuery({
    ...goalsByProjectQueryOptions(projectId, skip, limit, sortOptions),
    enabled: !!projectId,
  })
}

/**
 * Shares per-project goal queries between workspace and picker screens.
 * Successful projects remain usable even if one project request fails.
 */
export function useGoalsByProjects(
  projectIds: string[],
  options?: { enabled?: boolean; skip?: number; limit?: number },
) {
  const enabled = options?.enabled ?? true
  const skip = options?.skip ?? 0
  const limit = options?.limit ?? 100
  const uniqueProjectIds = [...new Set(projectIds)]
  const combine = useCallback(
    (results: ReturnType<typeof useGoalsByProject>[]) => ({
      data: results.flatMap((result) => result.data ?? []),
      isLoading: results.some((result) => result.isLoading),
      isFetching: results.some((result) => result.isFetching),
      error: results.find((result) => result.error)?.error ?? null,
    }),
    [],
  )

  return useQueries({
    queries: uniqueProjectIds.map((projectId) => ({
      ...goalsByProjectQueryOptions(projectId, skip, limit),
      enabled: enabled && Boolean(projectId),
    })),
    combine,
  })
}

/**
 * Fetches a single goal by ID.
 *
 * @param goalId - The goal UUID to fetch
 * @returns UseQueryResult with goal data
 */
export function useGoal(goalId: string) {
  const queryClient = useQueryClient()
  let didLookUpCachedGoal = false
  let cachedGoalEntry: [QueryKey, Goal[] | undefined] | undefined
  const findCachedGoalEntry = () => {
    if (!didLookUpCachedGoal) {
      cachedGoalEntry = queryClient
        .getQueriesData<Goal[]>({ queryKey: goalKeys.projects() })
        .find(([, goals]) => goals?.some((goal) => goal.id === goalId))
      didLookUpCachedGoal = true
    }

    return cachedGoalEntry
  }

  return useQuery({
    queryKey: goalKeys.detail(goalId),
    queryFn: () => goalsApi.getById(goalId),
    enabled: !!goalId,
    initialData: () =>
      findCachedGoalEntry()?.[1]?.find((goal) => goal.id === goalId),
    initialDataUpdatedAt: () => {
      const queryKey = findCachedGoalEntry()?.[0]
      return queryKey
        ? queryClient.getQueryState(queryKey)?.dataUpdatedAt
        : undefined
    },
    refetchOnMount: 'always',
    staleTime: GOAL_STALE_TIME,
    gcTime: GOAL_GC_TIME,
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
 * Cache invalidation is delayed to allow dialog close animation to complete,
 * preventing UI freeze from Radix UI cleanup issues.
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
      const projectId = cachedGoal?.project_id

      // Remove goal from cache immediately
      queryClient.removeQueries({ queryKey: goalKeys.detail(goalId) })

      // Delay cache invalidation to allow dialog close animation to complete
      // This prevents Radix UI dialog cleanup issues that cause UI freeze
      setTimeout(() => {
        // Force reset body styles in case Radix UI dialog cleanup failed
        if (typeof document !== 'undefined') {
          document.body.style.pointerEvents = ''
          document.body.style.overflow = ''
        }

        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: goalKeys.byProject(projectId)
          })
        } else {
          // Fallback: invalidate every per-project goal collection
          queryClient.invalidateQueries({ queryKey: goalKeys.projects() })
        }
      }, 300)
    },
  })
}
