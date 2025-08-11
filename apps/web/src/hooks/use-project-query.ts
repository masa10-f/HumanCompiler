import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'

// Query keys for consistent caching
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: string) => [...projectKeys.lists(), { filters }] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
}

// Hook for fetching a single project
export function useProject(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.getById(projectId),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// Hook for fetching all projects
export function useProjects(skip = 0, limit = 20) {
  return useQuery({
    queryKey: projectKeys.list(`skip-${skip}-limit-${limit}`),
    queryFn: () => projectsApi.getAll(skip, limit),
    staleTime: 2 * 60 * 1000, // 2 minutes for list view
    gcTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Hook for creating a project
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

// Hook for updating a project
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

// Hook for deleting a project
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
