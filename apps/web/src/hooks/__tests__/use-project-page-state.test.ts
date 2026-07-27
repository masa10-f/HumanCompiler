/**
 * @jest-environment jsdom
 */
import { waitFor } from '@testing-library/react'
import { createMockProject, createMockGoals, resetIdCounter } from './helpers/mock-factories'
import { renderHookWithClient } from './helpers/test-utils'
import type { Project } from '@/types/project'
import type { Goal } from '@/types/goal'
import type { ProjectProgress } from '@/types/progress'

// Mock next/navigation
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

// Mock useAuth
const mockUseAuth = jest.fn()
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Mock API functions
const mockGetById = jest.fn<Promise<Project>, [string]>()
const mockGetByProject = jest.fn<Promise<Goal[]>, [string, number?, number?]>()
const mockGetProgress = jest.fn<Promise<ProjectProgress>, [string]>()

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getById: (id: string) => mockGetById(id),
  },
  goalsApi: {
    getByProject: (id: string, skip?: number, limit?: number) => mockGetByProject(id, skip, limit),
  },
  progressApi: {
    getProject: (id: string) => mockGetProgress(id),
  },
}))

// Import after mocks
import { useProjectPageState } from '../use-project-page-state'

describe('useProjectPageState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
    mockPush.mockClear()
  })

  describe('authentication', () => {
    it('should return isInitializing true when auth is loading', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: true,
      })

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.isInitializing).toBe(true)
      expect(result.current.authLoading).toBe(true)
    })

    it('should return shouldRedirect true when not authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
      })

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.shouldRedirect).toBe(true)
      expect(result.current.isInitializing).toBe(true)
    })

    it('should return user data when authenticated', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' }
      mockUseAuth.mockReturnValue({
        user: mockUser,
        loading: false,
      })

      const mockProject = createMockProject({ id: 'proj-1' })
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.user).toEqual(mockUser)
      expect(result.current.shouldRedirect).toBe(false)
      expect(result.current.isInitializing).toBe(false)
    })
  })

  describe('project data', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-123' },
        loading: false,
      })
    })

    it('should fetch project by ID', async () => {
      const mockProject = createMockProject({ id: 'proj-1', title: 'Test Project' })
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.project).toEqual(mockProject)
      })

      expect(mockGetById).toHaveBeenCalledWith('proj-1')
    })

    it('should handle project loading state', () => {
      mockGetById.mockImplementation(() => new Promise(() => {})) // Never resolves
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.projectLoading).toBe(true)
    })

    it('should handle project error state', async () => {
      const error = new Error('Project not found')
      mockGetById.mockRejectedValue(error)
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.projectError).toBeTruthy()
      })

      expect(result.current.projectError?.message).toBe('Project not found')
    })

    it('should provide refetch function', async () => {
      const mockProject = createMockProject({ id: 'proj-1' })
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.project).toBeDefined()
      })

      expect(typeof result.current.refetchProject).toBe('function')
    })
  })

  describe('goals data', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-123' },
        loading: false,
      })
    })

    it('should fetch goals by project ID', async () => {
      const mockProject = createMockProject({ id: 'proj-1' })
      const mockGoals = createMockGoals(3, { project_id: 'proj-1' })
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue(mockGoals)

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.goals).toHaveLength(3)
      })
    })

    it('should handle goals loading state', () => {
      mockGetById.mockResolvedValue(createMockProject({ id: 'proj-1' }))
      mockGetByProject.mockImplementation(() => new Promise(() => {})) // Never resolves

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.goalsLoading).toBe(true)
    })

    it('should handle goals error state', async () => {
      const mockProject = createMockProject({ id: 'proj-1' })
      const error = new Error('Failed to fetch goals')
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockRejectedValue(error)

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.goalsError).toBeTruthy()
      })

      expect(result.current.goalsError?.message).toBe('Failed to fetch goals')
    })

    it('should return empty array when no goals', async () => {
      const mockProject = createMockProject({ id: 'proj-1' })
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.projectLoading).toBe(false)
      })

      expect(result.current.goals).toEqual([])
    })
  })

  describe('progress data', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-123' },
        loading: false,
      })
    })

    it('should fetch progress when project is available', async () => {
      const mockProject = createMockProject({ id: 'proj-1' })
      const mockProgress: ProjectProgress = {
        project_id: 'proj-1',
        title: 'Test Project',
        estimate_hours: 100,
        actual_minutes: 3000,
        progress_percentage: 50,
        goals: [],
      }
      mockGetById.mockResolvedValue(mockProject)
      mockGetByProject.mockResolvedValue([])
      mockGetProgress.mockResolvedValue(mockProgress)

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      await waitFor(() => {
        expect(result.current.projectProgress).toEqual(mockProgress)
      })

      expect(mockGetProgress).toHaveBeenCalledWith('proj-1')
    })

    it('should not fetch progress when project is loading', async () => {
      mockGetById.mockImplementation(() => new Promise(() => {})) // Never resolves
      mockGetByProject.mockResolvedValue([])

      renderHookWithClient(() => useProjectPageState('proj-1'))

      // Wait a bit to ensure no calls are made
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockGetProgress).not.toHaveBeenCalled()
    })
  })

  describe('router', () => {
    it('should provide router instance', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-123' },
        loading: false,
      })
      mockGetById.mockResolvedValue(createMockProject({ id: 'proj-1' }))
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHookWithClient(() => useProjectPageState('proj-1'))

      expect(result.current.router).toBeDefined()
      expect(typeof result.current.router.push).toBe('function')
    })
  })
})
