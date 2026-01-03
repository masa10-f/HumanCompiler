/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { createMockLog, createMockLogs, resetIdCounter } from './helpers/mock-factories'
import { renderHookWithClient } from './helpers/test-utils'
import type { Log, LogCreate, LogUpdate } from '@/types/log'

// Mock the API
const mockGetByTask = jest.fn<Promise<Log[]>, [string, number?, number?]>()
const mockGetBatch = jest.fn<Promise<Record<string, Log[]>>, [string[]]>()
const mockGetById = jest.fn<Promise<Log>, [string]>()
const mockCreate = jest.fn<Promise<Log>, [LogCreate]>()
const mockUpdate = jest.fn<Promise<Log>, [string, LogUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  logsApi: {
    getByTask: (...args: [string, number?, number?]) => mockGetByTask(...args),
    getBatch: (taskIds: string[]) => mockGetBatch(taskIds),
    getById: (id: string) => mockGetById(id),
    create: (data: LogCreate) => mockCreate(data),
    update: (id: string, data: LogUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

// Mock query-keys
jest.mock('@/lib/query-keys', () => ({
  queryKeys: {
    logs: {
      all: ['logs'],
      lists: () => ['logs', 'list'],
      list: (filters: string) => ['logs', 'list', { filters }],
      details: () => ['logs', 'detail'],
      detail: (id: string) => ['logs', 'detail', id],
      byTask: (taskId: string) => ['logs', 'task', taskId],
      batch: (taskIds: string[]) => ['logs', 'batch', ...taskIds.sort()],
    },
    progress: {
      all: ['progress'],
    },
  },
}))

// Import after mocks
import {
  useLogsByTask,
  useBatchLogsQuery,
  useLog,
  useCreateLog,
  useUpdateLog,
  useDeleteLog,
  useTaskActualMinutes,
  logKeys,
} from '../use-logs-query'

describe('logKeys', () => {
  it('should have correct structure', () => {
    expect(logKeys.all).toEqual(['logs'])
    expect(logKeys.byTask('task-1')).toEqual(['logs', 'task', 'task-1'])
    expect(logKeys.detail('log-1')).toEqual(['logs', 'detail', 'log-1'])
  })
})

describe('useLogsByTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch logs for task', async () => {
    const mockLogs = createMockLogs(5, { task_id: 'task-1' })
    mockGetByTask.mockResolvedValue(mockLogs)

    const { result } = renderHookWithClient(() => useLogsByTask('task-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByTask).toHaveBeenCalledWith('task-1', 0, 50)
    expect(result.current.data).toHaveLength(5)
  })

  it('should support pagination', async () => {
    const mockLogs = createMockLogs(10)
    mockGetByTask.mockResolvedValue(mockLogs)

    const { result } = renderHookWithClient(() => useLogsByTask('task-1', 10, 20))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByTask).toHaveBeenCalledWith('task-1', 10, 20)
  })

  it('should be disabled when taskId is falsy', async () => {
    const { result } = renderHookWithClient(() => useLogsByTask(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetByTask).not.toHaveBeenCalled()
  })
})

describe('useBatchLogsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch logs for multiple tasks', async () => {
    const batchResult: Record<string, Log[]> = {
      'task-1': createMockLogs(2, { task_id: 'task-1' }),
      'task-2': createMockLogs(3, { task_id: 'task-2' }),
    }
    mockGetBatch.mockResolvedValue(batchResult)

    const { result } = renderHookWithClient(() => useBatchLogsQuery(['task-1', 'task-2']))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetBatch).toHaveBeenCalledWith(['task-1', 'task-2'])
    expect(result.current.data).toEqual(batchResult)
  })

  it('should be disabled when taskIds is empty', async () => {
    const { result } = renderHookWithClient(() => useBatchLogsQuery([]))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetBatch).not.toHaveBeenCalled()
  })
})

describe('useLog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch single log', async () => {
    const mockLog = createMockLog({ id: 'log-1', actual_minutes: 60 })
    mockGetById.mockResolvedValue(mockLog)

    const { result } = renderHookWithClient(() => useLog('log-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetById).toHaveBeenCalledWith('log-1')
    expect(result.current.data).toEqual(mockLog)
  })

  it('should not fetch when logId is falsy', async () => {
    const { result } = renderHookWithClient(() => useLog(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetById).not.toHaveBeenCalled()
  })
})

describe('useCreateLog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should invalidate task logs on success', async () => {
    const newLog = createMockLog({ id: 'new-log', task_id: 'task-1' })
    mockCreate.mockResolvedValue(newLog)

    const { result, queryClient } = renderHookWithClient(() => useCreateLog())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        task_id: 'task-1',
        actual_minutes: 30,
      })
    })

    expect(mockCreate).toHaveBeenCalledWith({
      task_id: 'task-1',
      actual_minutes: 30,
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: logKeys.byTask('task-1'),
    })
  })

  it('should invalidate progress queries', async () => {
    const newLog = createMockLog({ id: 'new-log', task_id: 'task-1' })
    mockCreate.mockResolvedValue(newLog)

    const { result, queryClient } = renderHookWithClient(() => useCreateLog())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        task_id: 'task-1',
        actual_minutes: 45,
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['progress'] })
  })

  it('should add log to cache', async () => {
    const newLog = createMockLog({ id: 'cached-log', task_id: 'task-1' })
    mockCreate.mockResolvedValue(newLog)

    const { result, queryClient } = renderHookWithClient(() => useCreateLog())

    await act(async () => {
      await result.current.mutateAsync({
        task_id: 'task-1',
        actual_minutes: 15,
      })
    })

    const cachedLog = queryClient.getQueryData(logKeys.detail('cached-log'))
    expect(cachedLog).toEqual(newLog)
  })
})

describe('useUpdateLog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should update cache', async () => {
    const updatedLog = createMockLog({ id: 'log-1', task_id: 'task-1', actual_minutes: 90 })
    mockUpdate.mockResolvedValue(updatedLog)

    const { result, queryClient } = renderHookWithClient(() => useUpdateLog())

    // Pre-populate cache
    queryClient.setQueryData(
      logKeys.detail('log-1'),
      createMockLog({ id: 'log-1', task_id: 'task-1', actual_minutes: 30 })
    )

    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'log-1',
        data: { actual_minutes: 90 },
      })
    })

    // Verify setQueryData was called for the log detail
    expect(setQueryDataSpy).toHaveBeenCalledWith(logKeys.detail('log-1'), updatedLog)
  })

  it('should invalidate progress queries', async () => {
    const updatedLog = createMockLog({ id: 'log-1', task_id: 'task-1' })
    mockUpdate.mockResolvedValue(updatedLog)

    const { result, queryClient } = renderHookWithClient(() => useUpdateLog())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'log-1',
        data: { actual_minutes: 60 },
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['progress'] })
  })
})

describe('useDeleteLog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should invalidate progress queries on delete', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteLog())

    // Pre-populate cache
    queryClient.setQueryData(
      logKeys.detail('log-to-delete'),
      createMockLog({ id: 'log-to-delete', task_id: 'task-1' })
    )

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('log-to-delete')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['progress'] })
  })

  it('should invalidate task logs if task_id known', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteLog())

    queryClient.setQueryData(
      logKeys.detail('log-1'),
      createMockLog({ id: 'log-1', task_id: 'task-1' })
    )

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('log-1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: logKeys.byTask('task-1'),
    })
  })

  it('should fallback to invalidate all lists if task_id unknown', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteLog())

    // No pre-populated cache
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('unknown-log')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: logKeys.lists(),
    })
  })
})

describe('useTaskActualMinutes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should calculate total minutes from logs', async () => {
    const mockLogs = [
      createMockLog({ actual_minutes: 30 }),
      createMockLog({ actual_minutes: 45 }),
      createMockLog({ actual_minutes: 15 }),
    ]
    mockGetByTask.mockResolvedValue(mockLogs)

    const { result } = renderHookWithClient(() => useTaskActualMinutes('task-1'))

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(3)
    })

    expect(result.current.totalMinutes).toBe(90)
  })

  it('should convert to hours correctly', async () => {
    const mockLogs = [
      createMockLog({ actual_minutes: 60 }),
      createMockLog({ actual_minutes: 30 }),
    ]
    mockGetByTask.mockResolvedValue(mockLogs)

    const { result } = renderHookWithClient(() => useTaskActualMinutes('task-1'))

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(2)
    })

    expect(result.current.totalMinutes).toBe(90)
    expect(result.current.totalHours).toBe(1.5)
  })

  it('should return empty array when no logs', async () => {
    mockGetByTask.mockResolvedValue([])

    const { result } = renderHookWithClient(() => useTaskActualMinutes('task-1'))

    await waitFor(() => {
      expect(result.current.totalMinutes).toBe(0)
    })

    expect(result.current.logs).toEqual([])
    expect(result.current.totalHours).toBe(0)
  })
})
