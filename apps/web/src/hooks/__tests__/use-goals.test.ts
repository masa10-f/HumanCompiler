/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { createMockGoal, createMockGoals, resetIdCounter } from './helpers/mock-factories'
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal'

// Mock the API
const mockGetByProject = jest.fn<Promise<Goal[]>, [string]>()
const mockCreate = jest.fn<Promise<Goal>, [GoalCreate]>()
const mockUpdate = jest.fn<Promise<Goal>, [string, GoalUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  goalsApi: {
    getByProject: (projectId: string) => mockGetByProject(projectId),
    create: (data: GoalCreate) => mockCreate(data),
    update: (id: string, data: GoalUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

// Import after mocks
import { useGoals } from '../use-goals'

describe('useGoals', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
    mockGetByProject.mockResolvedValue([])
  })

  describe('fetching goals', () => {
    it('should not fetch when projectId is empty', async () => {
      const { result } = renderHook(() => useGoals(''))

      // Wait for any potential async operations to complete
      await act(async () => {
        await Promise.resolve()
      })

      expect(mockGetByProject).not.toHaveBeenCalled()
      expect(result.current.goals).toEqual([])
    })

    it('should fetch goals by projectId', async () => {
      const mockGoals = createMockGoals(3, { project_id: 'project-123' })
      mockGetByProject.mockResolvedValue(mockGoals)

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetByProject).toHaveBeenCalledWith('project-123')
      expect(result.current.goals).toEqual(mockGoals)
    })

    it('should refetch when projectId changes', async () => {
      const project1Goals = createMockGoals(2, { project_id: 'project-1' })
      const project2Goals = createMockGoals(3, { project_id: 'project-2' })

      mockGetByProject.mockImplementation(async (projectId) => {
        if (projectId === 'project-1') return project1Goals
        if (projectId === 'project-2') return project2Goals
        return []
      })

      const { result, rerender } = renderHook(({ projectId }) => useGoals(projectId), {
        initialProps: { projectId: 'project-1' },
      })

      await waitFor(() => {
        expect(result.current.goals).toHaveLength(2)
      })

      rerender({ projectId: 'project-2' })

      await waitFor(() => {
        expect(result.current.goals).toHaveLength(3)
      })

      expect(mockGetByProject).toHaveBeenCalledWith('project-2')
    })

    it('should set error on failure', async () => {
      mockGetByProject.mockRejectedValue(new Error('Failed to fetch'))

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBe('Failed to fetch')
    })
  })

  describe('createGoal', () => {
    it('should create goal via API', async () => {
      const newGoal = createMockGoal({ title: 'New Goal', project_id: 'project-123' })
      mockCreate.mockResolvedValue(newGoal)

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createGoal({
          title: 'New Goal',
          project_id: 'project-123',
          estimate_hours: 10,
        })
      })

      expect(mockCreate).toHaveBeenCalledWith({
        title: 'New Goal',
        project_id: 'project-123',
        estimate_hours: 10,
      })
    })

    it('should add goal to state', async () => {
      const newGoal = createMockGoal({ title: 'Added Goal' })
      mockCreate.mockResolvedValue(newGoal)

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createGoal({
          title: 'Added Goal',
          project_id: 'project-123',
          estimate_hours: 5,
        })
      })

      expect(result.current.goals).toContainEqual(newGoal)
    })

    it('should throw on failure', async () => {
      mockCreate.mockRejectedValue(new Error('Create failed'))

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.createGoal({
            title: 'New',
            project_id: 'project-123',
            estimate_hours: 1,
          })
        })
      ).rejects.toThrow('Create failed')
    })
  })

  describe('updateGoal', () => {
    it('should update goal in state', async () => {
      const existingGoal = createMockGoal({ id: 'goal-1', title: 'Original' })
      const updatedGoal = { ...existingGoal, title: 'Updated' }
      mockGetByProject.mockResolvedValue([existingGoal])
      mockUpdate.mockResolvedValue(updatedGoal)

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.goals).toHaveLength(1)
      })

      await act(async () => {
        await result.current.updateGoal('goal-1', { title: 'Updated' })
      })

      expect(result.current.goals[0].title).toBe('Updated')
    })

    it('should throw on failure', async () => {
      mockUpdate.mockRejectedValue(new Error('Update failed'))

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.updateGoal('goal-1', { title: 'Updated' })
        })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('deleteGoal', () => {
    it('should remove goal from state', async () => {
      const goal1 = createMockGoal({ id: 'goal-1' })
      const goal2 = createMockGoal({ id: 'goal-2' })
      mockGetByProject.mockResolvedValue([goal1, goal2])
      mockDelete.mockResolvedValue(undefined)

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.goals).toHaveLength(2)
      })

      await act(async () => {
        await result.current.deleteGoal('goal-1')
      })

      expect(result.current.goals).toHaveLength(1)
      expect(result.current.goals[0].id).toBe('goal-2')
    })

    it('should throw on failure', async () => {
      mockDelete.mockRejectedValue(new Error('Delete failed'))

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.deleteGoal('goal-1')
        })
      ).rejects.toThrow('Delete failed')
    })
  })

  describe('refetch', () => {
    it('should refetch goals', async () => {
      mockGetByProject.mockResolvedValue([])

      const { result } = renderHook(() => useGoals('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetByProject).toHaveBeenCalledTimes(1)

      const newGoals = createMockGoals(2)
      mockGetByProject.mockResolvedValue(newGoals)

      await act(async () => {
        await result.current.refetch()
      })

      expect(mockGetByProject).toHaveBeenCalledTimes(2)
      expect(result.current.goals).toEqual(newGoals)
    })
  })
})
