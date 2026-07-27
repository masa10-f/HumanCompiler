import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
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
export const PROJECT_STALE_TIME = 30 * 60 * 1000
export const PROJECT_GC_TIME = 24 * 60 * 60 * 1000

async function fetchAllProjects(): Promise<Project[]> {
  const projects: Project[] = []
  let skip = 0

  while (true) {
    const page = await projectsApi.getAll(skip, PROJECT_PAGE_SIZE)
    projects.push(...page)

    if (page.length < PROJECT_PAGE_SIZE) {
      return projects
    }

    skip += page.length
  }
}

export function projectOptionsQueryOptions() {
  return {
    queryKey: projectKeys.options(),
    queryFn: fetchAllProjects,
    staleTime: PROJECT_STALE_TIME,
    gcTime: PROJECT_GC_TIME,
  }
}

function compareProjects(
  left: Project,
  right: Project,
  sortOptions?: SortOptions,
) {
  const sortBy = sortOptions?.sortBy ?? SortBy.STATUS
  const direction = sortOptions?.sortOrder === SortOrder.DESC ? -1 : 1

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
    default:
      comparison = left.status.localeCompare(right.status)
      break
  }

  return comparison * direction
}

function updateProjectOptions(
  projects: Project[] | undefined,
  updater: (projects: Project[]) => Project[],
) {
  return projects ? updater(projects) : undefined
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
    staleTime: PROJECT_STALE_TIME,
    gcTime: PROJECT_GC_TIME,
  })
}

/**
 * Fetches all projects with pagination and sorting.
 *
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 20)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with project array
 */
export function useProjects(skip = 0, limit = 20, sortOptions?: SortOptions) {
  return useQuery({
    ...projectOptionsQueryOptions(),
    select: (projects) =>
      [...projects]
        .sort((left, right) => compareProjects(left, right, sortOptions))
        .slice(skip, skip + limit),
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
      queryClient.setQueryData(projectKeys.detail(newProject.id), newProject)
      queryClient.setQueryData<Project[]>(
        projectKeys.options(),
        (projects) =>
          updateProjectOptions(projects, (current) => [
            ...current.filter((project) => project.id !== newProject.id),
            newProject,
          ]),
      )
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
      queryClient.setQueryData(projectKeys.detail(updatedProject.id), updatedProject)
      queryClient.setQueryData<Project[]>(
        projectKeys.options(),
        (projects) =>
          updateProjectOptions(projects, (current) =>
            current.map((project) =>
              project.id === updatedProject.id ? updatedProject : project,
            ),
          ),
      )
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
      queryClient.setQueryData<Project[]>(
        projectKeys.options(),
        (projects) =>
          updateProjectOptions(projects, (current) =>
            current.filter((project) => project.id !== projectId),
          ),
      )

      setTimeout(() => {
        if (typeof document !== 'undefined') {
          document.body.style.pointerEvents = ''
          document.body.style.overflow = ''
        }
      }, 300)
    },
  })
}
