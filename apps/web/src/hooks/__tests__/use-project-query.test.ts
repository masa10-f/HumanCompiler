/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { createMockProject, createMockProjects, resetIdCounter } from './helpers/mock-factories'
import {
  createTestQueryClient,
  renderHookWithClient,
} from './helpers/test-utils'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'
import type { SortOptions } from '@/types/sort'
import { ApiError } from '@/lib/errors'

// Mock the API
const mockGetAll = jest.fn<Promise<Project[]>, [number?, number?, SortOptions?]>()
const mockGetById = jest.fn<Promise<Project>, [string]>()
const mockCreate = jest.fn<Promise<Project>, [ProjectCreate]>()
const mockUpdate = jest.fn<Promise<Project>, [string, ProjectUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()
const mockLoggerError = jest.fn()
const mockLoggerWarn = jest.fn()

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: (...args: [number?, number?, SortOptions?]) => mockGetAll(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: ProjectCreate) => mockCreate(data),
    update: (id: string, data: ProjectUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}))

// Import after mocks
import {
  useProject,
  useProjectOptions,
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  projectKeys,
} from '../use-project-query'

describe('projectKeys', () => {
  it('should generate correct keys for all', () => {
    expect(projectKeys.all).toEqual(['projects'])
  })

  it('should generate a shared options key', () => {
    expect(projectKeys.options()).toEqual(['projects', 'options'])
  })

  it('should generate correct keys for details', () => {
    expect(projectKeys.details()).toEqual(['projects', 'detail'])
  })

  it('should generate correct keys for detail', () => {
    expect(projectKeys.detail('proj-1')).toEqual(['projects', 'detail', 'proj-1'])
  })
})

describe('useProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch single project', async () => {
    const mockProject = createMockProject({ id: 'proj-1', title: 'Test Project' })
    mockGetById.mockResolvedValue(mockProject)

    const { result } = renderHookWithClient(() => useProject('proj-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetById).toHaveBeenCalledWith('proj-1')
    expect(result.current.data).toEqual(mockProject)
  })

  it('should not fetch when projectId is falsy', async () => {
    const { result } = renderHookWithClient(() => useProject(''))

    // Query should be disabled
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('should store project detail in the cache', async () => {
    const mockProject = createMockProject()
    mockGetById.mockResolvedValue(mockProject)

    const { result, queryClient } = renderHookWithClient(() => useProject('proj-1'))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    // Check that the query has the expected stale time by checking the query cache
    const queryState = queryClient.getQueryState(projectKeys.detail('proj-1'))
    expect(queryState).toBeDefined()
  })

  it('should render cached project options while revalidating detail', async () => {
    const cachedProject = createMockProject({ id: 'proj-1' })
    const refreshedProject = createMockProject({
      id: 'proj-1',
      title: 'Refreshed project',
    })
    mockGetById.mockResolvedValue(refreshedProject)
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(projectKeys.options(), [cachedProject], {
      updatedAt: Date.now(),
    })

    const { result } = renderHookWithClient(() => useProject('proj-1'), {
      queryClient,
    })

    expect(result.current.data).toEqual(cachedProject)
    expect(result.current.isLoading).toBe(false)
    await waitFor(() => {
      expect(mockGetById).toHaveBeenCalledWith('proj-1')
      expect(result.current.data).toEqual(refreshedProject)
    })
  })
})

describe('shared project collection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should fetch project options in API-sized pages', async () => {
    const mockProjects = createMockProjects(5)
    mockGetAll.mockResolvedValue(mockProjects)

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledWith(0, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(result.current.data).toHaveLength(5)
  })

  it('should continue fetching when a project page is full', async () => {
    const firstPage = createMockProjects(100)
    const lastPage = createMockProjects(1)
    mockGetAll
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage)

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenNthCalledWith(1, 0, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(mockGetAll).toHaveBeenNthCalledWith(2, 100, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(result.current.data).toHaveLength(101)
  })

  it('warns when pagination pages partially overlap', async () => {
    const firstPage = createMockProjects(100)
    const finalProject = createMockProject({ id: 'final-project' })
    mockGetAll
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([firstPage[99], finalProject])

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(101)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Project pagination window shifted; collection may be incomplete',
      {
        skip: 100,
        pageSize: 2,
        loaded: 101,
      },
      { component: 'fetchAllProjects' },
    )
  })

  it('should retry only the failed project page once', async () => {
    const mockProjects = createMockProjects(3)
    mockGetAll
      .mockRejectedValueOnce(new TypeError('temporary fetch failure'))
      .mockResolvedValueOnce(mockProjects)

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledTimes(2)
    expect(mockGetAll).toHaveBeenNthCalledWith(1, 0, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(mockGetAll).toHaveBeenNthCalledWith(2, 0, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(result.current.data).toEqual(mockProjects)
  })

  it('should not retry a non-retryable project page error', async () => {
    mockGetAll.mockRejectedValue(new ApiError(401, 'Unauthorized'))

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  it('should retry a temporary service-unavailable project page error', async () => {
    const mockProjects = createMockProjects(2)
    mockGetAll
      .mockRejectedValueOnce(new ApiError(503, 'Service unavailable'))
      .mockResolvedValueOnce(mockProjects)

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledTimes(2)
    expect(result.current.data).toEqual(mockProjects)
  })

  it('should fail visibly when a full page repeats without new records', async () => {
    const repeatedPage = createMockProjects(100)
    mockGetAll.mockResolvedValue(repeatedPage)

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toEqual(
      new Error(
        'プロジェクト一覧を完全に取得できませんでした。再試行してください。',
      ),
    )
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Project pagination returned no new records',
      new Error(
        'プロジェクト一覧を完全に取得できませんでした。再試行してください。',
      ),
      {
        component: 'fetchAllProjects',
        skip: 100,
        loaded: 100,
      },
    )
    expect(mockGetAll).toHaveBeenCalledTimes(2)
  })

  it('should fail visibly when the page safety limit is reached', async () => {
    mockGetAll.mockImplementation(async (skip = 0) =>
      Array.from({ length: 100 }, (_, index) =>
        createMockProject({ id: `project-${skip + index}` }),
      ),
    )

    const { result } = renderHookWithClient(() => useProjectOptions())

    await waitFor(
      () => {
        expect(result.current.isError).toBe(true)
      },
      { timeout: 10000 },
    )

    expect(result.current.error).toEqual(
      new Error(
        'プロジェクト一覧を完全に取得できませんでした。再試行してください。',
      ),
    )
    expect(mockGetAll).toHaveBeenCalledTimes(100)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Project pagination exceeded 100 pages',
      new Error(
        'プロジェクト一覧を完全に取得できませんでした。再試行してください。',
      ),
      {
        component: 'fetchAllProjects',
        loaded: 10000,
      },
    )
  })

  it('should deduplicate option and list observers', async () => {
    mockGetAll.mockResolvedValue(createMockProjects(3))

    const { result } = renderHookWithClient(() => ({
      options: useProjectOptions(),
      list: useProjects(0, 20),
    }))

    await waitFor(() => {
      expect(result.current.options.isSuccess).toBe(true)
      expect(result.current.list.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  it('should sort the shared collection without another API request', async () => {
    const mockProjects = [
      createMockProject({ title: 'Zulu' }),
      createMockProject({ title: 'Alpha' }),
    ]
    mockGetAll.mockResolvedValue(mockProjects)

    const sortOptions: SortOptions = { sortBy: 'title', sortOrder: 'asc' }
    const { result } = renderHookWithClient(() => useProjects(0, 20, sortOptions))

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetAll).toHaveBeenCalledWith(0, 100, {
      sortBy: 'created_at',
      sortOrder: 'asc',
    })
    expect(result.current.data?.map((project) => project.title)).toEqual([
      'Alpha',
      'Zulu',
    ])
  })

  it('preserves selected data identity when sort options are inline', async () => {
    mockGetAll.mockResolvedValue(createMockProjects(3))

    const { result, rerender } = renderHookWithClient(() =>
      useProjects(0, 20, { sortBy: 'title', sortOrder: 'asc' }),
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const firstData = result.current.data

    rerender()

    expect(result.current.data).toBe(firstData)
  })

  it('sorts an unknown runtime status after known statuses', async () => {
    const unknownStatusProject = createMockProject({
      id: 'unknown',
      status: 'pending',
    })
    ;(unknownStatusProject as Project & { status: string }).status = 'unknown'
    mockGetAll.mockResolvedValue([
      unknownStatusProject,
      createMockProject({ id: 'pending', status: 'pending' }),
    ])

    const { result } = renderHookWithClient(() =>
      useProjects(0, 20, { sortBy: 'status', sortOrder: 'asc' }),
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.map((project) => project.id)).toEqual([
      'pending',
      'unknown',
    ])
  })

  it('should preserve the workflow status order', async () => {
    mockGetAll.mockResolvedValue([
      createMockProject({ id: 'cancelled', status: 'cancelled' }),
      createMockProject({ id: 'completed', status: 'completed' }),
      createMockProject({ id: 'in-progress', status: 'in_progress' }),
      createMockProject({ id: 'pending', status: 'pending' }),
    ])

    const { result } = renderHookWithClient(() =>
      useProjects(0, 20, { sortBy: 'status', sortOrder: 'asc' }),
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.map((project) => project.status)).toEqual([
      'pending',
      'in_progress',
      'completed',
      'cancelled',
    ])
  })

  it('should fall back to status order for priority sorting', async () => {
    mockGetAll.mockResolvedValue([
      createMockProject({ id: 'completed', status: 'completed' }),
      createMockProject({ id: 'pending', status: 'pending' }),
    ])

    const { result } = renderHookWithClient(() =>
      useProjects(0, 20, { sortBy: 'priority', sortOrder: 'asc' }),
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.map((project) => project.status)).toEqual([
      'pending',
      'completed',
    ])
  })

  it('should not fetch the shared collection when disabled', () => {
    const { result } = renderHookWithClient(() =>
      useProjects(0, 20, undefined, { enabled: false }),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('selects the complete cached collection by default', async () => {
    mockGetAll.mockResolvedValue(createMockProjects(25))

    const { result } = renderHookWithClient(() => useProjects())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(25)
  })
})

describe('useCreateProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should create a project and update the shared collection', async () => {
    const newProject = createMockProject({ id: 'new-proj', title: 'New Project' })
    mockCreate.mockResolvedValue(newProject)

    const { result, queryClient } = renderHookWithClient(() => useCreateProject())
    queryClient.setQueryDefaults(projectKeys.options(), { gcTime: Infinity })
    queryClient.setQueryDefaults(projectKeys.details(), { gcTime: Infinity })
    queryClient.setQueryData(projectKeys.options(), [])

    await act(async () => {
      await result.current.mutateAsync({
        title: 'New Project',
        status: 'pending',
      })
    })

    expect(mockCreate).toHaveBeenCalledWith({
      title: 'New Project',
      status: 'pending',
    })

    expect(queryClient.getQueryData(projectKeys.options())).toEqual([newProject])
    expect(queryClient.getQueryData(projectKeys.detail('new-proj'))).toEqual(newProject)
  })

  it('should call API with correct data', async () => {
    const newProject = createMockProject({ id: 'cached-proj', title: 'Cached Project' })
    mockCreate.mockResolvedValue(newProject)

    const { result } = renderHookWithClient(() => useCreateProject())

    await act(async () => {
      await result.current.mutateAsync({
        title: 'Cached Project',
        status: 'pending',
      })
    })

    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Cached Project',
      status: 'pending',
    })
  })

  it('should not materialize a truncated collection after a cold-cache create', async () => {
    const newProject = createMockProject({ id: 'recovered-project' })
    mockCreate.mockResolvedValue(newProject)

    const { result, queryClient } = renderHookWithClient(() => useCreateProject())
    queryClient.setQueryDefaults(projectKeys.options(), { gcTime: Infinity })
    queryClient.setQueryDefaults(projectKeys.details(), { gcTime: Infinity })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        title: newProject.title,
        status: 'pending',
      })
    })

    expect(queryClient.getQueryData(projectKeys.options())).toBeUndefined()
    expect(queryClient.getQueryData(projectKeys.detail(newProject.id))).toEqual(
      newProject,
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.options(),
    })
  })
})

describe('useUpdateProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should update detail and shared collection caches', async () => {
    const updatedProject = createMockProject({ id: 'proj-1', title: 'Updated' })
    mockUpdate.mockResolvedValue(updatedProject)

    const { result, queryClient } = renderHookWithClient(() => useUpdateProject())

    // Pre-populate cache
    queryClient.setQueryDefaults(projectKeys.options(), { gcTime: Infinity })
    queryClient.setQueryDefaults(projectKeys.details(), { gcTime: Infinity })
    queryClient.setQueryData(projectKeys.detail('proj-1'), createMockProject({ id: 'proj-1' }))
    queryClient.setQueryData(
      projectKeys.options(),
      [createMockProject({ id: 'proj-1', title: 'Original' })],
    )

    await act(async () => {
      await result.current.mutateAsync({
        id: 'proj-1',
        data: { title: 'Updated' },
      })
    })

    expect(mockUpdate).toHaveBeenCalledWith('proj-1', { title: 'Updated' })

    expect(queryClient.getQueryData(projectKeys.detail('proj-1'))).toEqual(updatedProject)
    expect(queryClient.getQueryData(projectKeys.options())).toEqual([updatedProject])
  })

  it('should not materialize a partial collection after a cold-cache update', async () => {
    const updatedProject = createMockProject({ id: 'proj-1', title: 'Updated' })
    mockUpdate.mockResolvedValue(updatedProject)

    const { result, queryClient } = renderHookWithClient(() => useUpdateProject())
    queryClient.setQueryDefaults(projectKeys.details(), { gcTime: Infinity })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({
        id: 'proj-1',
        data: { title: 'Updated' },
      })
    })

    expect(queryClient.getQueryData(projectKeys.options())).toBeUndefined()
    expect(queryClient.getQueryData(projectKeys.detail('proj-1'))).toEqual(
      updatedProject,
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.options(),
    })
  })
})

describe('useDeleteProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should remove a project from detail and shared collection caches', async () => {
    jest.useFakeTimers()
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteProject())

    // Pre-populate cache
    queryClient.setQueryDefaults(projectKeys.options(), { gcTime: Infinity })
    queryClient.setQueryData(projectKeys.detail('proj-to-delete'), createMockProject())
    queryClient.setQueryData(
      projectKeys.options(),
      [createMockProject({ id: 'proj-to-delete' })],
    )

    const removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries')

    await act(async () => {
      await result.current.mutateAsync('proj-to-delete')
    })

    expect(mockDelete).toHaveBeenCalledWith('proj-to-delete')

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.detail('proj-to-delete'),
    })
    expect(queryClient.getQueryData(projectKeys.options())).toHaveLength(1)

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(queryClient.getQueryData(projectKeys.options())).toEqual([])
    jest.useRealTimers()
  })

  it('should not materialize an empty collection after a cold-cache delete', async () => {
    jest.useFakeTimers()
    mockDelete.mockResolvedValue(undefined)

    const { result, queryClient } = renderHookWithClient(() => useDeleteProject())
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync('proj-to-delete')
    })

    expect(queryClient.getQueryData(projectKeys.options())).toBeUndefined()
    expect(invalidateSpy).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.options(),
    })
    jest.useRealTimers()
  })
})
