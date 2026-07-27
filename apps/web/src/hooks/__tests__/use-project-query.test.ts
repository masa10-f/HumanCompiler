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

// Mock the API
const mockGetAll = jest.fn<Promise<Project[]>, [number?, number?, SortOptions?]>()
const mockGetById = jest.fn<Promise<Project>, [string]>()
const mockCreate = jest.fn<Promise<Project>, [ProjectCreate]>()
const mockUpdate = jest.fn<Promise<Project>, [string, ProjectUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: (...args: [number?, number?, SortOptions?]) => mockGetAll(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: ProjectCreate) => mockCreate(data),
    update: (id: string, data: ProjectUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
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

  it('should generate correct keys for lists', () => {
    expect(projectKeys.lists()).toEqual(['projects', 'list'])
  })

  it('should generate a shared options key', () => {
    expect(projectKeys.options()).toEqual(['projects', 'options'])
  })

  it('should generate correct keys for list with filters', () => {
    expect(projectKeys.list('filter-1')).toEqual(['projects', 'list', { filters: 'filter-1' }])
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

  it('should render cached project options without fetching detail again', async () => {
    const cachedProject = createMockProject({ id: 'proj-1' })
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(projectKeys.options(), [cachedProject], {
      updatedAt: Date.now(),
    })

    const { result } = renderHookWithClient(() => useProject('proj-1'), {
      queryClient,
    })

    expect(result.current.data).toEqual(cachedProject)
    expect(result.current.isLoading).toBe(false)
    expect(mockGetById).not.toHaveBeenCalled()
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

    expect(mockGetAll).toHaveBeenCalledWith(0, 100)
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

    expect(mockGetAll).toHaveBeenNthCalledWith(1, 0, 100)
    expect(mockGetAll).toHaveBeenNthCalledWith(2, 100, 100)
    expect(result.current.data).toHaveLength(101)
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

    expect(mockGetAll).toHaveBeenCalledWith(0, 100)
    expect(result.current.data?.map((project) => project.title)).toEqual([
      'Alpha',
      'Zulu',
    ])
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
})

describe('useDeleteProject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  it('should remove a project from detail and shared collection caches', async () => {
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
    expect(queryClient.getQueryData(projectKeys.options())).toEqual([])
  })
})
