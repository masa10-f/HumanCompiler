/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { createMockTask, createMockTasks, resetIdCounter } from './helpers/mock-factories'
import type { Task, TaskCreate, TaskUpdate } from '@/types/task'

// Mock the API
const mockGetByGoal = jest.fn<Promise<Task[]>, [string]>()
const mockGetByProject = jest.fn<Promise<Task[]>, [string]>()
const mockCreate = jest.fn<Promise<Task>, [TaskCreate]>()
const mockUpdate = jest.fn<Promise<Task>, [string, TaskUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  tasksApi: {
    getByGoal: (goalId: string) => mockGetByGoal(goalId),
    getByProject: (projectId: string) => mockGetByProject(projectId),
    create: (data: TaskCreate) => mockCreate(data),
    update: (id: string, data: TaskUpdate) => mockUpdate(id, data),
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
import { useTasks, useProjectTasks } from '../use-tasks'

describe('useTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
    mockGetByGoal.mockResolvedValue([])
  })

  describe('fetching tasks', () => {
    it('should not fetch when goalId is empty', async () => {
      const { result } = renderHook(() => useTasks(''))

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(mockGetByGoal).not.toHaveBeenCalled()
      expect(result.current.tasks).toEqual([])
    })

    it('should fetch tasks by goalId', async () => {
      const mockTasks = createMockTasks(3, { goal_id: 'goal-123' })
      mockGetByGoal.mockResolvedValue(mockTasks)

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetByGoal).toHaveBeenCalledWith('goal-123')
      expect(result.current.tasks).toEqual(mockTasks)
    })

    it('should refetch when goalId changes', async () => {
      const goal1Tasks = createMockTasks(2, { goal_id: 'goal-1' })
      const goal2Tasks = createMockTasks(4, { goal_id: 'goal-2' })

      mockGetByGoal.mockImplementation(async (goalId) => {
        if (goalId === 'goal-1') return goal1Tasks
        if (goalId === 'goal-2') return goal2Tasks
        return []
      })

      const { result, rerender } = renderHook(({ goalId }) => useTasks(goalId), {
        initialProps: { goalId: 'goal-1' },
      })

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2)
      })

      rerender({ goalId: 'goal-2' })

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(4)
      })
    })

    it('should set error on failure', async () => {
      mockGetByGoal.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBe('Network error')
    })
  })

  describe('createTask', () => {
    it('should create task with goalId', async () => {
      const newTask = createMockTask({ title: 'New Task', goal_id: 'goal-123' })
      mockCreate.mockResolvedValue(newTask)

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createTask({
          title: 'New Task',
          goal_id: 'goal-123',
          estimate_hours: 2,
        })
      })

      expect(mockCreate).toHaveBeenCalledWith({
        title: 'New Task',
        goal_id: 'goal-123',
        estimate_hours: 2,
      })
    })

    it('should add task to state', async () => {
      const newTask = createMockTask({ title: 'Added Task' })
      mockCreate.mockResolvedValue(newTask)

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createTask({
          title: 'Added Task',
          goal_id: 'goal-123',
          estimate_hours: 1,
        })
      })

      expect(result.current.tasks).toContainEqual(newTask)
    })

    it('should throw on failure', async () => {
      mockCreate.mockRejectedValue(new Error('Create failed'))

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.createTask({
            title: 'New',
            goal_id: 'goal-123',
            estimate_hours: 1,
          })
        })
      ).rejects.toThrow('Create failed')
    })
  })

  describe('updateTask', () => {
    it('should update task in state', async () => {
      const existingTask = createMockTask({ id: 'task-1', title: 'Original' })
      const updatedTask = { ...existingTask, title: 'Updated' }
      mockGetByGoal.mockResolvedValue([existingTask])
      mockUpdate.mockResolvedValue(updatedTask)

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(1)
      })

      await act(async () => {
        await result.current.updateTask('task-1', { title: 'Updated' })
      })

      expect(result.current.tasks[0].title).toBe('Updated')
    })

    it('should throw on failure', async () => {
      mockUpdate.mockRejectedValue(new Error('Update failed'))

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.updateTask('task-1', { title: 'Updated' })
        })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('deleteTask', () => {
    it('should remove task from state', async () => {
      const task1 = createMockTask({ id: 'task-1' })
      const task2 = createMockTask({ id: 'task-2' })
      mockGetByGoal.mockResolvedValue([task1, task2])
      mockDelete.mockResolvedValue(undefined)

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2)
      })

      await act(async () => {
        await result.current.deleteTask('task-1')
      })

      expect(result.current.tasks).toHaveLength(1)
      expect(result.current.tasks[0].id).toBe('task-2')
    })

    it('should throw on failure', async () => {
      mockDelete.mockRejectedValue(new Error('Delete failed'))

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.deleteTask('task-1')
        })
      ).rejects.toThrow('Delete failed')
    })
  })

  describe('refetch', () => {
    it('should refetch tasks', async () => {
      mockGetByGoal.mockResolvedValue([])

      const { result } = renderHook(() => useTasks('goal-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetByGoal).toHaveBeenCalledTimes(1)

      const newTasks = createMockTasks(3)
      mockGetByGoal.mockResolvedValue(newTasks)

      await act(async () => {
        await result.current.refetch()
      })

      expect(mockGetByGoal).toHaveBeenCalledTimes(2)
      expect(result.current.tasks).toEqual(newTasks)
    })
  })
})

describe('useProjectTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
    mockGetByProject.mockResolvedValue([])
  })

  describe('fetching tasks', () => {
    it('should not fetch when projectId is empty', async () => {
      const { result } = renderHook(() => useProjectTasks(''))

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(mockGetByProject).not.toHaveBeenCalled()
      expect(result.current.tasks).toEqual([])
    })

    it('should fetch tasks by projectId', async () => {
      const mockTasks = createMockTasks(5)
      mockGetByProject.mockResolvedValue(mockTasks)

      const { result } = renderHook(() => useProjectTasks('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(mockGetByProject).toHaveBeenCalledWith('project-123')
      expect(result.current.tasks).toEqual(mockTasks)
    })
  })

  describe('CRUD operations', () => {
    it('should create task', async () => {
      const newTask = createMockTask({ title: 'Project Task' })
      mockCreate.mockResolvedValue(newTask)

      const { result } = renderHook(() => useProjectTasks('project-123'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.createTask({
          title: 'Project Task',
          goal_id: 'goal-1',
          estimate_hours: 2,
        })
      })

      expect(result.current.tasks).toContainEqual(newTask)
    })

    it('should update task', async () => {
      const existingTask = createMockTask({ id: 'task-1', title: 'Original' })
      const updatedTask = { ...existingTask, title: 'Updated' }
      mockGetByProject.mockResolvedValue([existingTask])
      mockUpdate.mockResolvedValue(updatedTask)

      const { result } = renderHook(() => useProjectTasks('project-123'))

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(1)
      })

      await act(async () => {
        await result.current.updateTask('task-1', { title: 'Updated' })
      })

      expect(result.current.tasks[0].title).toBe('Updated')
    })

    it('should delete task', async () => {
      const task1 = createMockTask({ id: 'task-1' })
      mockGetByProject.mockResolvedValue([task1])
      mockDelete.mockResolvedValue(undefined)

      const { result } = renderHook(() => useProjectTasks('project-123'))

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(1)
      })

      await act(async () => {
        await result.current.deleteTask('task-1')
      })

      expect(result.current.tasks).toHaveLength(0)
    })
  })
})
