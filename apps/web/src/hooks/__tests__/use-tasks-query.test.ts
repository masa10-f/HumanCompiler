/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { createMockTask, createMockTasks, resetIdCounter } from './helpers/mock-factories'
import { renderHookWithClient } from './helpers/test-utils'
import type { Task, TaskCreate, TaskUpdate } from '@/types/task'
import type { SortOptions } from '@/types/sort'

// Mock the API
const mockGetByGoal = jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>()
const mockGetByProject = jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>()
const mockGetById = jest.fn<Promise<Task>, [string]>()
const mockCreate = jest.fn<Promise<Task>, [TaskCreate]>()
const mockUpdate = jest.fn<Promise<Task>, [string, TaskUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  tasksApi: {
    getByGoal: (...args: [string, number?, number?, SortOptions?]) => mockGetByGoal(...args),
    getByProject: (...args: [string, number?, number?, SortOptions?]) => mockGetByProject(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: TaskCreate) => mockCreate(data),
    update: (id: string, data: TaskUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

// Import after mocks
import {
  useTasksByGoal,
  useTasksByProject,
  useTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  taskKeys,
} from '../use-tasks-query'

describe('taskKeys', () => {
  it('should generate correct query keys for byGoal', () => {
    expect(taskKeys.byGoal('goal-123')).toEqual(['tasks', 'goal', 'goal-123'])
  })

  it('should generate correct query keys for byProject', () => {
    expect(taskKeys.byProject('proj-456')).toEqual(['tasks', 'project', 'proj-456'])
  })

  it('should generate correct keys for details', () => {
    expect(taskKeys.all).toEqual(['tasks'])
    expect(taskKeys.lists()).toEqual(['tasks', 'list'])
    expect(taskKeys.details()).toEqual(['tasks', 'detail'])
    expect(taskKeys.detail('task-1')).toEqual(['tasks', 'detail', 'task-1'])
  })
})

describe('useTasksByGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch tasks by goalId', async () => {
    const mockTasks = createMockTasks(5, { goal_id: 'goal-1' })
    mockGetByGoal.mockResolvedValue(mockTasks)

    const { result } = renderHookWithClient(() => useTasksByGoal('goal-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByGoal).toHaveBeenCalledWith('goal-1', 0, 50, undefined)
    expect(result.current.data).toHaveLength(5)
  })

  it('should include sort options in query', async () => {
    const mockTasks = createMockTasks(3)
    mockGetByGoal.mockResolvedValue(mockTasks)

    const sortOptions: SortOptions = { sortBy: 'priority', sortOrder: 'asc' }

    const { result } = renderHookWithClient(() => useTasksByGoal('goal-1', 0, 50, sortOptions))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByGoal).toHaveBeenCalledWith('goal-1', 0, 50, sortOptions)
  })

  it('should be disabled when goalId is falsy', async () => {
    const { result } = renderHookWithClient(() => useTasksByGoal(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetByGoal).not.toHaveBeenCalled()
  })
})

describe('useTasksByProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch tasks by projectId', async () => {
    const mockTasks = createMockTasks(8)
    mockGetByProject.mockResolvedValue(mockTasks)

    const { result } = renderHookWithClient(() => useTasksByProject('proj-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByProject).toHaveBeenCalledWith('proj-1', 0, 50, undefined)
    expect(result.current.data).toHaveLength(8)
  })

  it('should be disabled when projectId is falsy', async () => {
    const { result } = renderHookWithClient(() => useTasksByProject(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetByProject).not.toHaveBeenCalled()
  })
})

describe('useTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch single task', async () => {
    const mockTask = createMockTask({ id: 'task-1', title: 'Test Task' })
    mockGetById.mockResolvedValue(mockTask)

    const { result } = renderHookWithClient(() => useTask('task-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetById).toHaveBeenCalledWith('task-1')
    expect(result.current.data).toEqual(mockTask)
  })

  it('should not fetch when taskId is falsy', async () => {
    const { result } = renderHookWithClient(() => useTask(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetById).not.toHaveBeenCalled()
  })
})

describe('useCreateTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should invalidate goal tasks on success', async () => {
    const newTask = createMockTask({ id: 'new-task', goal_id: 'goal-1' })
    mockCreate.mockResolvedValue(newTask)

    const { result, queryClient } = renderHookWithClient(() => useCreateTask())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        title: 'New Task',
        goal_id: 'goal-1',
        estimate_hours: 2,
      })
    })

    expect(mockCreate).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.byGoal('goal-1'),
    })
  })

  it('should invalidate task lists', async () => {
    const newTask = createMockTask({ id: 'new-task', goal_id: 'goal-1' })
    mockCreate.mockResolvedValue(newTask)

    const { result, queryClient } = renderHookWithClient(() => useCreateTask())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        title: 'New Task',
        goal_id: 'goal-1',
        estimate_hours: 2,
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.lists() })
  })

  it('should add task to cache', async () => {
    const newTask = createMockTask({ id: 'cached-task', goal_id: 'goal-1' })
    mockCreate.mockResolvedValue(newTask)

    const { result, queryClient } = renderHookWithClient(() => useCreateTask())

    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      await result.current.mutateAsync({
        title: 'Cached Task',
        goal_id: 'goal-1',
        estimate_hours: 1,
      })
    })

    // Verify setQueryData was called for the task detail
    expect(setQueryDataSpy).toHaveBeenCalledWith(
      taskKeys.detail('cached-task'),
      newTask
    )
  })
})

describe('useUpdateTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should update cache and invalidate lists', async () => {
    const updatedTask = createMockTask({ id: 'task-1', title: 'Updated', goal_id: 'goal-1' })
    mockUpdate.mockResolvedValue(updatedTask)

    const { result, queryClient } = renderHookWithClient(() => useUpdateTask())

    // Pre-populate cache
    queryClient.setQueryData(
      taskKeys.detail('task-1'),
      createMockTask({ id: 'task-1', goal_id: 'goal-1' })
    )

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'task-1',
        data: { title: 'Updated' },
      })
    })

    expect(mockUpdate).toHaveBeenCalledWith('task-1', { title: 'Updated' })

    // Verify setQueryData was called for the task detail
    expect(setQueryDataSpy).toHaveBeenCalledWith(taskKeys.detail('task-1'), updatedTask)

    // Check invalidations
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.byGoal('goal-1'),
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.lists() })
  })
})

describe('useDeleteTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should remove from cache', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteTask())

    queryClient.setQueryData(
      taskKeys.detail('task-to-delete'),
      createMockTask({ id: 'task-to-delete' })
    )

    const removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries')

    await act(async () => {
      await result.current.mutateAsync('task-to-delete')
    })

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('task-to-delete'),
    })
  })

  it('should invalidate goal tasks if goalId known', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteTask())

    // Pre-populate cache with task that has goal_id
    queryClient.setQueryData(
      taskKeys.detail('task-1'),
      createMockTask({ id: 'task-1', goal_id: 'goal-1' })
    )

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('task-1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.byGoal('goal-1'),
    })
  })

  it('should fallback to invalidate all lists if goalId unknown', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteTask())

    // No pre-populated cache
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('unknown-task')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.lists(),
    })
  })
})
