import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { projectsApi } from '@/lib/api'
import { ApiError, isRetryableError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { queryKeys } from '@/lib/query-keys'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'
import type { SortOptions } from '@/types/sort'
import { SortBy, SortOrder } from '@/types/sort'

/**
 * Query keys for project caching with React Query.
 * Provides consistent cache key structure for all project-related queries.
 */
export const projectKeys = queryKeys.projects

const PROJECT_PAGE_SIZE = 100
const MAX_PROJECT_PAGES = 100
const PROJECT_PAGE_RETRY_COUNT = 1
const PROJECT_PAGE_RETRY_DELAY = 300
const PROJECT_PAGINATION_ERROR_MESSAGE =
  'プロジェクト一覧を完全に取得できませんでした。再試行してください。'
// The API base service appends id ASC to every ordered query, so offset page
// boundaries remain deterministic when several projects share created_at.
const PROJECT_FETCH_SORT_OPTIONS: SortOptions = {
  sortBy: SortBy.CREATED_AT,
  sortOrder: SortOrder.ASC,
}
// Mirrors STATUS_PRIORITY in the API so client-side sorting preserves the
// workflow order previously returned by the project list endpoint.
const PROJECT_STATUS_PRIORITY: Record<Project['status'], number> = {
  pending: 1,
  in_progress: 2,
  completed: 3,
  cancelled: 4,
}
export const PROJECT_STALE_TIME = 30 * 60 * 1000
export const PROJECT_GC_TIME = 24 * 60 * 60 * 1000

async function fetchProjectPage(skip: number): Promise<Project[]> {
  let lastError: unknown

  for (let attempt = 0; attempt <= PROJECT_PAGE_RETRY_COUNT; attempt += 1) {
    try {
      return await projectsApi.getAll(
        skip,
        PROJECT_PAGE_SIZE,
        PROJECT_FETCH_SORT_OPTIONS,
      )
    } catch (error) {
      lastError = error
      const retryable =
        (error instanceof ApiError && error.statusCode === 429) ||
        (error instanceof Error && isRetryableError(error))

      if (!retryable || attempt === PROJECT_PAGE_RETRY_COUNT) {
        break
      }

      await new Promise((resolve) =>
        setTimeout(resolve, PROJECT_PAGE_RETRY_DELAY),
      )
    }
  }

  throw lastError
}

async function fetchAllProjects(): Promise<Project[]> {
  const projects: Project[] = []
  const seenProjectIds = new Set<string>()
  let skip = 0

  for (let pageIndex = 0; pageIndex < MAX_PROJECT_PAGES; pageIndex += 1) {
    const page = await fetchProjectPage(skip)
    const previousProjectCount = projects.length

    page.forEach((project) => {
      if (!seenProjectIds.has(project.id)) {
        seenProjectIds.add(project.id)
        projects.push(project)
      }
    })

    if (page.length < PROJECT_PAGE_SIZE) {
      return projects
    }

    if (projects.length === previousProjectCount) {
      const error = new Error(PROJECT_PAGINATION_ERROR_MESSAGE)
      logger.error(
        'Project pagination returned no new records',
        error,
        {
          component: 'fetchAllProjects',
          skip,
          loaded: projects.length,
        },
      )
      throw error
    }

    skip += page.length
  }

  const error = new Error(PROJECT_PAGINATION_ERROR_MESSAGE)
  logger.error(
    `Project pagination exceeded ${MAX_PROJECT_PAGES} pages`,
    error,
    {
      component: 'fetchAllProjects',
      loaded: projects.length,
    },
  )
  throw error
}

export function projectOptionsQueryOptions() {
  return {
    queryKey: projectKeys.options(),
    queryFn: fetchAllProjects,
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: PROJECT_STALE_TIME,
    gcTime: PROJECT_GC_TIME,
  }
}

function compareProjects(
  left: Project,
  right: Project,
  sortBy = SortBy.STATUS,
  sortOrder = SortOrder.ASC,
) {
  const direction = sortOrder === SortOrder.DESC ? -1 : 1

  let comparison = 0
  switch (sortBy) {
    case SortBy.TITLE:
      comparison = left.title.localeCompare(right.title, 'ja')
      break
    case SortBy.CREATED_AT:
      comparison =
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      break
    case SortBy.UPDATED_AT:
      comparison =
        new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime()
      break
    case SortBy.STATUS:
    // Projects have no priority field, so keep the workflow status order.
    case SortBy.PRIORITY:
      comparison =
        (PROJECT_STATUS_PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
        (PROJECT_STATUS_PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER)
      break
    default: {
      const exhaustive: never = sortBy
      void exhaustive
      return 0
    }
  }

  return comparison * direction
}

/**
 * Fetches the shared, complete project collection used by selectors and pages.
 * The authenticated query provider warms this cache immediately after sign-in.
 */
export function useProjectOptions(options?: { enabled?: boolean }) {
  return useQuery({
    ...projectOptionsQueryOptions(),
    enabled: options?.enabled ?? true,
  })
}

/**
 * Fetches a single project by ID.
 * Uses React Query for caching and automatic revalidation.
 *
 * @param projectId - The project UUID to fetch
 * @returns UseQueryResult with project data, loading state, and error
 */
export function useProject(projectId: string) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.getById(projectId),
    enabled: !!projectId,
    initialData: () =>
      queryClient
        .getQueryData<Project[]>(projectKeys.options())
        ?.find((project) => project.id === projectId),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(projectKeys.options())?.dataUpdatedAt,
    refetchOnMount: 'always',
    staleTime: PROJECT_STALE_TIME,
    gcTime: PROJECT_GC_TIME,
  })
}

/**
 * Selects a client-side page from the shared complete project collection.
 *
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum cached records to select (default: all)
 * @param sortOptions - Optional sorting configuration
 * @param options - Optional query controls
 * @returns UseQueryResult with project array
 */
export function useProjects(
  skip = 0,
  limit = Number.POSITIVE_INFINITY,
  sortOptions?: SortOptions,
  options?: { enabled?: boolean },
) {
  const sortBy = sortOptions?.sortBy
  const sortOrder = sortOptions?.sortOrder
  const selectProjects = useCallback(
    (projects: Project[]) =>
      [...projects]
        .sort((left, right) =>
          compareProjects(left, right, sortBy, sortOrder),
        )
        .slice(skip, skip + limit),
    [limit, skip, sortBy, sortOrder],
  )

  return useQuery({
    ...projectOptionsQueryOptions(),
    enabled: options?.enabled ?? true,
    select: selectProjects,
  })
}

/**
 * Mutation hook for creating a new project.
 * Automatically invalidates project list cache on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectData: ProjectCreate) => projectsApi.create(projectData),
    onSuccess: (newProject: Project) => {
      const cachedOptions = queryClient.getQueryData<Project[]>(
        projectKeys.options(),
      )

      queryClient.setQueryData(projectKeys.detail(newProject.id), newProject)
      if (cachedOptions) {
        queryClient.setQueryData<Project[]>(projectKeys.options(), [
          ...cachedOptions.filter((project) => project.id !== newProject.id),
          newProject,
        ])
      } else {
        void queryClient.invalidateQueries({ queryKey: projectKeys.options() })
      }
    },
  })
}

/**
 * Mutation hook for updating a project.
 * Updates cache and invalidates project lists on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProjectUpdate }) =>
      projectsApi.update(id, data),
    onSuccess: (updatedProject: Project) => {
      const cachedOptions = queryClient.getQueryData<Project[]>(
        projectKeys.options(),
      )

      queryClient.setQueryData(
        projectKeys.detail(updatedProject.id),
        updatedProject,
      )
      if (cachedOptions) {
        queryClient.setQueryData<Project[]>(
          projectKeys.options(),
          cachedOptions.map((project) =>
            project.id === updatedProject.id ? updatedProject : project,
          ),
        )
      } else {
        void queryClient.invalidateQueries({ queryKey: projectKeys.options() })
      }
    },
  })
}

/**
 * Mutation hook for deleting a project.
 * Removes from cache and invalidates project lists on success.
 * Cache invalidation is delayed to allow dialog close animation to complete,
 * preventing UI freeze from Radix UI cleanup issues.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: (_, projectId) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) })

      // Updating the observed collection can unmount the Radix dialog. Wait
      // for its close animation before doing that work and restoring styles.
      setTimeout(() => {
        const cachedOptions = queryClient.getQueryData<Project[]>(
          projectKeys.options(),
        )

        if (cachedOptions) {
          queryClient.setQueryData<Project[]>(
            projectKeys.options(),
            cachedOptions.filter((project) => project.id !== projectId),
          )
        } else {
          void queryClient.invalidateQueries({ queryKey: projectKeys.options() })
        }

        if (typeof document !== 'undefined') {
          document.body.style.pointerEvents = ''
          document.body.style.overflow = ''
        }
      }, 300)
    },
  })
}
