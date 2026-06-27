/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { createMockTask, createMockTasks, resetIdCounter } from './helpers/mock-factories'
import { renderHookWithClient } from './helpers/test-utils'
import type { Task, TaskCreate, TaskDependency, TaskUpdate } from '@/types/task'
import { SortBy, SortOrder } from '@/types/sort'
import type { SortOptions } from '@/types/sort'

// Mock the API
const mockGetByGoal = jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>()
const mockGetByProject = jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>()
const mockGetById = jest.fn<Promise<Task>, [string]>()
const mockCreate = jest.fn<Promise<Task>, [TaskCreate]>()
const mockUpdate = jest.fn<Promise<Task>, [string, TaskUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()
const mockAddDependency = jest.fn<Promise<TaskDependency>, [string, string]>()
const mockDeleteDependency = jest.fn<Promise<void>, [string, string]>()

const createPersistentQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

jest.mock('@/lib/api', () => ({
  DEFAULT_TASK_PAGE_LIMIT: 100,
  tasksApi: {
    getByGoal: (...args: [string, number?, number?, SortOptions?]) => mockGetByGoal(...args),
    getByProject: (...args: [string, number?, number?, SortOptions?]) => mockGetByProject(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: TaskCreate) => mockCreate(data),
    update: (id: string, data: TaskUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
    addDependency: (taskId: string, dependsOnTaskId: string) => mockAddDependency(taskId, dependsOnTaskId),
    deleteDependency: (taskId: string, dependencyId: string) => mockDeleteDependency(taskId, dependencyId),
  },
}))

// Import after mocks
import {
  useAllTasksByGoal,
  useTasksByGoal,
  useTasksByProject,
  useTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useAddTaskDependency,
  useDeleteTaskDependency,
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

    expect(mockGetByGoal).toHaveBeenCalledWith('goal-1', 0, 100, undefined)
    expect(result.current.data).toHaveLength(5)
  })

  it('should include sort options in query', async () => {
    const mockTasks = createMockTasks(3)
    mockGetByGoal.mockResolvedValue(mockTasks)

    const sortOptions: SortOptions = { sortBy: SortBy.PRIORITY, sortOrder: SortOrder.ASC }

    const { result } = renderHookWithClient(() => useTasksByGoal('goal-1', 0, 100, sortOptions))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByGoal).toHaveBeenCalledWith('goal-1', 0, 100, sortOptions)
  })

  it('should be disabled when goalId is falsy', async () => {
    const { result } = renderHookWithClient(() => useTasksByGoal(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetByGoal).not.toHaveBeenCalled()
  })
})

describe('useAllTasksByGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch a single page when fewer than the task page limit exist', async () => {
    const mockTasks = createMockTasks(60, { goal_id: 'goal-1' })
    mockGetByGoal.mockResolvedValueOnce(mockTasks)

    const { result } = renderHookWithClient(() => useAllTasksByGoal('goal-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByGoal).toHaveBeenCalledTimes(1)
    expect(mockGetByGoal).toHaveBeenCalledWith('goal-1', 0, 100, undefined)
    expect(result.current.data).toHaveLength(60)
  })

  it('should keep fetching pages until the final partial page', async () => {
    const firstPage = createMockTasks(100, { goal_id: 'goal-1' })
    const secondPage = createMockTasks(50, { goal_id: 'goal-1' })
    mockGetByGoal.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)

    const sortOptions: SortOptions = { sortBy: SortBy.CREATED_AT, sortOrder: SortOrder.DESC }
    const { result } = renderHookWithClient(() => useAllTasksByGoal('goal-1', sortOptions))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByGoal).toHaveBeenNthCalledWith(1, 'goal-1', 0, 100, sortOptions)
    expect(mockGetByGoal).toHaveBeenNthCalledWith(2, 'goal-1', 100, 100, sortOptions)
    expect(result.current.data).toHaveLength(150)
  })

  it('should be disabled when goalId is falsy', async () => {
    const { result } = renderHookWithClient(() => useAllTasksByGoal(''))

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

    expect(mockGetByProject).toHaveBeenCalledWith('proj-1', 0, 100, undefined)
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

  it('should invalidate project task queries', async () => {
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

    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) })
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

  it('should update cache and invalidate goal and project task queries', async () => {
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
    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) })
  })
})

describe('useDeleteTask', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    resetIdCounter()
  })

  afterEach(() => {
    jest.useRealTimers()
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

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: taskKeys.byGoal('goal-1'),
    })
  })

  it('should fallback to invalidate all goal and project task queries if goalId unknown', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteTask())

    // No pre-populated cache
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('unknown-task')
    })

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) })
  })
})

describe('useAddTaskDependency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should add dependency to task caches and invalidate task collections', async () => {
    const task = createMockTask({ id: 'task-1', goal_id: 'goal-1', dependencies: [] })
    const dependsOnTask = createMockTask({ id: 'task-2', title: 'Dependency task', status: 'pending' })
    const dependency: TaskDependency = {
      id: 'dep-1',
      task_id: 'task-1',
      depends_on_task_id: 'task-2',
      created_at: '2025-01-01T00:00:00Z',
      depends_on_task: null,
    }
    mockAddDependency.mockResolvedValue(dependency)

    const queryClient = createPersistentQueryClient()
    const { result } = renderHookWithClient(
      () => useAddTaskDependency(task, [dependsOnTask]),
      { queryClient }
    )

    queryClient.setQueryData(taskKeys.detail('task-1'), task)
    queryClient.setQueryData([...taskKeys.byGoal('goal-1'), 'page', 0, 100, 'default'], [task])
    queryClient.setQueryData([...taskKeys.byProject('project-1'), 'page', 0, 100, 'default'], [task])

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('task-2')
    })

    expect(mockAddDependency).toHaveBeenCalledWith('task-1', 'task-2')
    expect(queryClient.getQueryData<Task>(taskKeys.detail('task-1'))?.dependencies).toEqual([
      {
        ...dependency,
        depends_on_task: {
          id: 'task-2',
          title: 'Dependency task',
          status: 'pending',
        },
      },
    ])
    expect(queryClient.getQueryData<Task[]>([...taskKeys.byGoal('goal-1'), 'page', 0, 100, 'default'])?.[0].dependencies).toHaveLength(1)
    expect(queryClient.getQueryData<Task[]>([...taskKeys.byProject('project-1'), 'page', 0, 100, 'default'])?.[0].dependencies).toHaveLength(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.detail('task-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.byGoal('goal-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) })
  })
})

describe('useDeleteTaskDependency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should remove dependency from task caches and invalidate task collections', async () => {
    const dependency: TaskDependency = {
      id: 'dep-1',
      task_id: 'task-1',
      depends_on_task_id: 'task-2',
      created_at: '2025-01-01T00:00:00Z',
      depends_on_task: {
        id: 'task-2',
        title: 'Dependency task',
        status: 'pending',
      },
    }
    const task = createMockTask({ id: 'task-1', goal_id: 'goal-1', dependencies: [dependency] })
    mockDeleteDependency.mockResolvedValue(undefined)

    const queryClient = createPersistentQueryClient()
    const { result } = renderHookWithClient(
      () => useDeleteTaskDependency(task),
      { queryClient }
    )

    queryClient.setQueryData(taskKeys.detail('task-1'), task)
    queryClient.setQueryData([...taskKeys.byGoal('goal-1'), 'page', 0, 100, 'default'], [task])
    queryClient.setQueryData([...taskKeys.byProject('project-1'), 'page', 0, 100, 'default'], [task])

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('dep-1')
    })

    expect(mockDeleteDependency).toHaveBeenCalledWith('task-1', 'dep-1')
    expect(queryClient.getQueryData<Task>(taskKeys.detail('task-1'))?.dependencies).toEqual([])
    expect(queryClient.getQueryData<Task[]>([...taskKeys.byGoal('goal-1'), 'page', 0, 100, 'default'])?.[0].dependencies).toEqual([])
    expect(queryClient.getQueryData<Task[]>([...taskKeys.byProject('project-1'), 'page', 0, 100, 'default'])?.[0].dependencies).toEqual([])
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.detail('task-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.byGoal('goal-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ predicate: expect.any(Function) })
  })
})
