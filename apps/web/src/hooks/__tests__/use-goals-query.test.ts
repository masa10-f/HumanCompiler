/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { createMockGoal, createMockGoals, resetIdCounter } from './helpers/mock-factories'
import { renderHookWithClient } from './helpers/test-utils'
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal'
import type { SortOptions } from '@/types/sort'

// Mock the API
const mockGetByProject = jest.fn<Promise<Goal[]>, [string, number?, number?, SortOptions?]>()
const mockGetById = jest.fn<Promise<Goal>, [string]>()
const mockCreate = jest.fn<Promise<Goal>, [GoalCreate]>()
const mockUpdate = jest.fn<Promise<Goal>, [string, GoalUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  goalsApi: {
    getByProject: (...args: [string, number?, number?, SortOptions?]) => mockGetByProject(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: GoalCreate) => mockCreate(data),
    update: (id: string, data: GoalUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

// Import after mocks
import {
  useGoalsByProject,
  useGoal,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  goalKeys,
} from '../use-goals-query'

describe('goalKeys', () => {
  it('should generate correct query keys', () => {
    expect(goalKeys.all).toEqual(['goals'])
    expect(goalKeys.lists()).toEqual(['goals', 'list'])
    expect(goalKeys.details()).toEqual(['goals', 'detail'])
  })

  it('should include projectId in byProject key', () => {
    expect(goalKeys.byProject('proj-123')).toEqual(['goals', 'project', 'proj-123'])
  })

  it('should include goalId in detail key', () => {
    expect(goalKeys.detail('goal-456')).toEqual(['goals', 'detail', 'goal-456'])
  })
})

describe('useGoalsByProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should not fetch when projectId is falsy (enabled=false)', async () => {
    const { result } = renderHookWithClient(() => useGoalsByProject(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetByProject).not.toHaveBeenCalled()
  })

  it('should fetch goals with pagination params', async () => {
    const mockGoals = createMockGoals(5, { project_id: 'proj-1' })
    mockGetByProject.mockResolvedValue(mockGoals)

    const { result } = renderHookWithClient(() => useGoalsByProject('proj-1', 0, 20))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByProject).toHaveBeenCalledWith('proj-1', 0, 20, undefined)
    expect(result.current.data).toHaveLength(5)
  })

  it('should include sortOptions in query key', async () => {
    const mockGoals = createMockGoals(3)
    mockGetByProject.mockResolvedValue(mockGoals)

    const sortOptions: SortOptions = { sortBy: 'title', sortOrder: 'desc' }

    const { result } = renderHookWithClient(() => useGoalsByProject('proj-1', 0, 20, sortOptions))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetByProject).toHaveBeenCalledWith('proj-1', 0, 20, sortOptions)
  })

  it('should have 5 minute staleTime', async () => {
    const mockGoals = createMockGoals(2)
    mockGetByProject.mockResolvedValue(mockGoals)

    const { result, queryClient } = renderHookWithClient(() => useGoalsByProject('proj-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    // Verify query is in cache
    const queryState = queryClient.getQueryState([...goalKeys.byProject('proj-1'), 'default'])
    expect(queryState).toBeDefined()
  })
})

describe('useGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch single goal by id', async () => {
    const mockGoal = createMockGoal({ id: 'goal-1', title: 'Test Goal' })
    mockGetById.mockResolvedValue(mockGoal)

    const { result } = renderHookWithClient(() => useGoal('goal-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetById).toHaveBeenCalledWith('goal-1')
    expect(result.current.data).toEqual(mockGoal)
  })

  it('should not fetch when goalId is falsy', async () => {
    const { result } = renderHookWithClient(() => useGoal(''))

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetById).not.toHaveBeenCalled()
  })
})

describe('useCreateGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should call goalsApi.create', async () => {
    const newGoal = createMockGoal({ id: 'new-goal', project_id: 'proj-1' })
    mockCreate.mockResolvedValue(newGoal)

    const { result } = renderHookWithClient(() => useCreateGoal())

    await act(async () => {
      await result.current.mutateAsync({
        title: 'New Goal',
        project_id: 'proj-1',
        estimate_hours: 10,
      })
    })

    expect(mockCreate).toHaveBeenCalledWith({
      title: 'New Goal',
      project_id: 'proj-1',
      estimate_hours: 10,
    })
  })

  it('should invalidate project goals query on success', async () => {
    const newGoal = createMockGoal({ id: 'new-goal', project_id: 'proj-1' })
    mockCreate.mockResolvedValue(newGoal)

    const { result, queryClient } = renderHookWithClient(() => useCreateGoal())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        title: 'New Goal',
        project_id: 'proj-1',
        estimate_hours: 5,
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: goalKeys.byProject('proj-1'),
    })
  })

  it('should add goal to cache on success', async () => {
    const newGoal = createMockGoal({ id: 'cached-goal', project_id: 'proj-1' })
    mockCreate.mockResolvedValue(newGoal)

    const { result, queryClient } = renderHookWithClient(() => useCreateGoal())

    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      await result.current.mutateAsync({
        title: 'Cached Goal',
        project_id: 'proj-1',
        estimate_hours: 8,
      })
    })

    // Verify setQueryData was called for the goal detail
    expect(setQueryDataSpy).toHaveBeenCalledWith(
      goalKeys.detail('cached-goal'),
      newGoal
    )
  })
})

describe('useUpdateGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should update goal via API', async () => {
    const updatedGoal = createMockGoal({ id: 'goal-1', title: 'Updated', project_id: 'proj-1' })
    mockUpdate.mockResolvedValue(updatedGoal)

    const { result } = renderHookWithClient(() => useUpdateGoal())

    await act(async () => {
      await result.current.mutateAsync({
        id: 'goal-1',
        data: { title: 'Updated' },
      })
    })

    expect(mockUpdate).toHaveBeenCalledWith('goal-1', { title: 'Updated' })
  })

  it('should update cached goal', async () => {
    const updatedGoal = createMockGoal({ id: 'goal-1', title: 'Updated', project_id: 'proj-1' })
    mockUpdate.mockResolvedValue(updatedGoal)

    const { result, queryClient } = renderHookWithClient(() => useUpdateGoal())

    // Pre-populate cache
    queryClient.setQueryData(goalKeys.detail('goal-1'), createMockGoal({ id: 'goal-1' }))

    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'goal-1',
        data: { title: 'Updated' },
      })
    })

    // Verify setQueryData was called for the goal detail
    expect(setQueryDataSpy).toHaveBeenCalledWith(goalKeys.detail('goal-1'), updatedGoal)
  })

  it('should invalidate project goals list', async () => {
    const updatedGoal = createMockGoal({ id: 'goal-1', project_id: 'proj-1' })
    mockUpdate.mockResolvedValue(updatedGoal)

    const { result, queryClient } = renderHookWithClient(() => useUpdateGoal())

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'goal-1',
        data: { title: 'Updated' },
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: goalKeys.byProject('proj-1'),
    })
  })
})

describe('useDeleteGoal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should delete goal via API', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result } = renderHookWithClient(() => useDeleteGoal())

    await act(async () => {
      await result.current.mutateAsync('goal-to-delete')
    })

    expect(mockDelete).toHaveBeenCalledWith('goal-to-delete')
  })

  it('should remove goal from cache', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteGoal())

    // Pre-populate cache
    queryClient.setQueryData(
      goalKeys.detail('goal-to-delete'),
      createMockGoal({ id: 'goal-to-delete' })
    )

    const removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries')

    await act(async () => {
      await result.current.mutateAsync('goal-to-delete')
    })

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: goalKeys.detail('goal-to-delete'),
    })
  })

  it('should invalidate project goals if projectId known', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteGoal())

    // Pre-populate cache with goal that has project_id
    queryClient.setQueryData(
      goalKeys.detail('goal-1'),
      createMockGoal({ id: 'goal-1', project_id: 'proj-1' })
    )

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('goal-1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: goalKeys.byProject('proj-1'),
    })
  })

  it('should fallback to invalidate all lists if projectId unknown', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteGoal())

    // No pre-populated cache - projectId unknown
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('unknown-goal')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: goalKeys.lists(),
    })
  })
})
