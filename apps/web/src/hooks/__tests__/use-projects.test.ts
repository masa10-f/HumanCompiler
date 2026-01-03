/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { createMockProject, createMockProjects, resetIdCounter } from './helpers/mock-factories'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'

// Mock the API
const mockGetAll = jest.fn<Promise<Project[]>, []>()
const mockCreate = jest.fn<Promise<Project>, [ProjectCreate]>()
const mockUpdate = jest.fn<Promise<Project>, [string, ProjectUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: () => mockGetAll(),
    create: (data: ProjectCreate) => mockCreate(data),
    update: (id: string, data: ProjectUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

// Mock logger
jest.mock('@/lib/logger', () => ({
  log: {
    component: jest.fn(),
    error: jest.fn(),
    userAction: jest.fn(),
  },
}))

// Import after mocks
import { useProjects } from '../use-projects'

describe('useProjects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
    mockGetAll.mockResolvedValue([])
  })

  describe('fetching projects', () => {
    it('should fetch projects on mount', async () => {
      const mockProjects = createMockProjects(3)
      mockGetAll.mockResolvedValue(mockProjects)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetAll).toHaveBeenCalled()
      expect(result.current.projects).toEqual(mockProjects)
    })

    it('should set loading during fetch', async () => {
      let resolveGetAll: (value: Project[]) => void
      mockGetAll.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetAll = resolve
          })
      )

      const { result } = renderHook(() => useProjects())

      // Initially loading
      expect(result.current.loading).toBe(true)

      await act(async () => {
        resolveGetAll!([])
      })

      expect(result.current.loading).toBe(false)
    })

    it('should update projects on success', async () => {
      const mockProjects = [createMockProject({ title: 'Test Project' })]
      mockGetAll.mockResolvedValue(mockProjects)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(1)
      })

      expect(result.current.projects[0].title).toBe('Test Project')
    })

    it('should set error on failure', async () => {
      mockGetAll.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBe('Network error')
    })
  })

  describe('createProject', () => {
    it('should create project via API', async () => {
      const newProject = createMockProject({ title: 'New Project' })
      mockCreate.mockResolvedValue(newProject)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createProject({
          title: 'New Project',
          status: 'pending',
        })
      })

      expect(mockCreate).toHaveBeenCalledWith({
        title: 'New Project',
        status: 'pending',
      })
    })

    it('should add new project to state', async () => {
      const newProject = createMockProject({ title: 'Added Project' })
      mockCreate.mockResolvedValue(newProject)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createProject({
          title: 'Added Project',
          status: 'pending',
        })
      })

      expect(result.current.projects).toContainEqual(newProject)
    })

    it('should clear error before operation', async () => {
      mockGetAll.mockRejectedValueOnce(new Error('Initial error'))
      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.error).toBe('Initial error')
      })

      const newProject = createMockProject()
      mockCreate.mockResolvedValue(newProject)

      await act(async () => {
        await result.current.createProject({
          title: 'New',
          status: 'pending',
        })
      })

      expect(result.current.error).toBeNull()
    })

    it('should throw on failure', async () => {
      mockCreate.mockRejectedValue(new Error('Create failed'))

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.createProject({
            title: 'New',
            status: 'pending',
          })
        })
      ).rejects.toThrow('Create failed')
    })
  })

  describe('updateProject', () => {
    it('should update project via API', async () => {
      const existingProject = createMockProject({ id: 'proj-1', title: 'Original' })
      const updatedProject = { ...existingProject, title: 'Updated' }
      mockGetAll.mockResolvedValue([existingProject])
      mockUpdate.mockResolvedValue(updatedProject)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(1)
      })

      await act(async () => {
        await result.current.updateProject('proj-1', { title: 'Updated' })
      })

      expect(mockUpdate).toHaveBeenCalledWith('proj-1', { title: 'Updated' })
    })

    it('should update project in state', async () => {
      const existingProject = createMockProject({ id: 'proj-1', title: 'Original' })
      const updatedProject = { ...existingProject, title: 'Updated' }
      mockGetAll.mockResolvedValue([existingProject])
      mockUpdate.mockResolvedValue(updatedProject)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(1)
      })

      await act(async () => {
        await result.current.updateProject('proj-1', { title: 'Updated' })
      })

      expect(result.current.projects[0].title).toBe('Updated')
    })

    it('should throw on failure', async () => {
      mockUpdate.mockRejectedValue(new Error('Update failed'))

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.updateProject('proj-1', { title: 'Updated' })
        })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('deleteProject', () => {
    it('should delete project via API', async () => {
      const existingProject = createMockProject({ id: 'proj-1' })
      mockGetAll.mockResolvedValue([existingProject])
      mockDelete.mockResolvedValue(undefined)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(1)
      })

      await act(async () => {
        await result.current.deleteProject('proj-1')
      })

      expect(mockDelete).toHaveBeenCalledWith('proj-1')
    })

    it('should remove project from state', async () => {
      const project1 = createMockProject({ id: 'proj-1' })
      const project2 = createMockProject({ id: 'proj-2' })
      mockGetAll.mockResolvedValue([project1, project2])
      mockDelete.mockResolvedValue(undefined)

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(2)
      })

      await act(async () => {
        await result.current.deleteProject('proj-1')
      })

      expect(result.current.projects).toHaveLength(1)
      expect(result.current.projects[0].id).toBe('proj-2')
    })

    it('should throw on failure', async () => {
      mockDelete.mockRejectedValue(new Error('Delete failed'))

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.deleteProject('proj-1')
        })
      ).rejects.toThrow('Delete failed')
    })
  })

  describe('refetch', () => {
    it('should refetch all projects', async () => {
      mockGetAll.mockResolvedValue([])

      const { result } = renderHook(() => useProjects())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetAll).toHaveBeenCalledTimes(1)

      const newProjects = createMockProjects(2)
      mockGetAll.mockResolvedValue(newProjects)

      await act(async () => {
        await result.current.refetch()
      })

      expect(mockGetAll).toHaveBeenCalledTimes(2)
      expect(result.current.projects).toEqual(newProjects)
    })
  })
})
