import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { useProject } from '@/hooks/use-project-query'
import { useGoalsByProject } from '@/hooks/use-goals-query'
import { progressApi } from '@/lib/api'
import type { Project } from '@/types/project'
import type { Goal } from '@/types/goal'
import type { ProjectProgress } from '@/types/progress'

export interface ProjectPageState {
  // Authentication
  user: ReturnType<typeof useAuth>['user']
  authLoading: boolean

  // Project data
  project: Project | undefined
  projectLoading: boolean
  projectError: Error | null
  refetchProject: ReturnType<typeof useProject>['refetch']

  // Goals data
  goals: Goal[]
  goalsLoading: boolean
  goalsError: Error | null
  refetchGoals: ReturnType<typeof useGoalsByProject>['refetch']

  // Progress data
  projectProgress: ProjectProgress | undefined

  // Navigation
  router: ReturnType<typeof useRouter>

  // Computed states
  isInitializing: boolean
  shouldRedirect: boolean
}

export function useProjectPageState(projectId: string): ProjectPageState {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch: refetchProject,
  } = useProject(projectId)

  const {
    data: goals = [],
    isLoading: goalsLoading,
    error: goalsError,
    refetch: refetchGoals,
  } = useGoalsByProject(projectId)

  const { data: projectProgress } = useQuery({
    queryKey: ['progress', 'project', projectId],
    queryFn: () => progressApi.getProject(projectId),
    enabled: !!project,
  })

  const isInitializing = authLoading || !user
  const shouldRedirect = !authLoading && !user

  return {
    user,
    authLoading,
    project,
    projectLoading,
    projectError: projectError as Error | null,
    refetchProject,
    goals,
    goalsLoading,
    goalsError: goalsError as Error | null,
    refetchGoals,
    projectProgress,
    router,
    isInitializing,
    shouldRedirect,
  }
}
