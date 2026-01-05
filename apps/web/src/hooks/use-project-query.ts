import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'
import type { SortOptions } from '@/types/sort'

/**
 * Query keys for project caching with React Query.
 * Provides consistent cache key structure for all project-related queries.
 */
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: string) => [...projectKeys.lists(), { filters }] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
}

/**
 * Fetches a single project by ID.
 * Uses React Query for caching and automatic revalidation.
 *
 * @param projectId - The project UUID to fetch
 * @returns UseQueryResult with project data, loading state, and error
 */
export function useProject(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.getById(projectId),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
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
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: projectKeys.list(`skip-${skip}-limit-${limit}-${sortKey}`),
    queryFn: () => projectsApi.getAll(skip, limit, sortOptions),
    staleTime: 2 * 60 * 1000, // 2 minutes for list view
    gcTime: 5 * 60 * 1000, // 5 minutes
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
      // Invalidate and refetch project lists
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })

      // Optionally add the new project to cache
      queryClient.setQueryData(
        projectKeys.detail(newProject.id),
        newProject
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
      // Update the cached project
      queryClient.setQueryData(
        projectKeys.detail(updatedProject.id),
        updatedProject
      )

      // Invalidate project lists to show updated data
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

/**
 * Mutation hook for deleting a project.
 * Removes from cache and invalidates project lists on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: (_, projectId) => {
      // Remove project from cache
      queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) })

      // Invalidate project lists
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}
