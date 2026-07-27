/**
 * @jest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react'
import { createMockProject } from './helpers/mock-factories'
import {
  createTestQueryClient,
  renderHookWithClient,
} from './helpers/test-utils'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'
import { SortBy, SortOrder } from '@/types/sort'

const mockGetAll = jest.fn<Promise<Project[]>, [number?, number?]>()
const mockGetById = jest.fn<Promise<Project>, [string]>()
const mockCreate = jest.fn<Promise<Project>, [ProjectCreate]>()
const mockUpdate = jest.fn<Promise<Project>, [string, ProjectUpdate]>()
const mockDelete = jest.fn<Promise<void>, [string]>()

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: (...args: [number?, number?]) => mockGetAll(...args),
    getById: (id: string) => mockGetById(id),
    create: (data: ProjectCreate) => mockCreate(data),
    update: (id: string, data: ProjectUpdate) => mockUpdate(id, data),
    delete: (id: string) => mockDelete(id),
  },
}))

import {
  projectKeys,
  useCreateProject,
  useDeleteProject,
  useProject,
  useProjectOptions,
  useProjects,
  useUpdateProject,
} from '../use-project-query'

function createProjectTestClient() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryDefaults(projectKeys.all, { gcTime: Infinity })
  return queryClient
}

describe('project query cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses one canonical collection key', () => {
    expect(projectKeys.options()).toEqual(['projects', 'options'])
    expect(projectKeys.detail('project-1')).toEqual([
      'projects',
      'detail',
      'project-1',
    ])
  })

  it('fetches the shared project options once with the API limit', async () => {
    const projects = [createMockProject({ id: 'project-1' })]
    mockGetAll.mockResolvedValue(projects)
    const queryClient = createProjectTestClient()

    const options = renderHookWithClient(() => useProjectOptions(), {
      queryClient,
    })
    const list = renderHookWithClient(() => useProjects(), { queryClient })

    await waitFor(() => {
      expect(options.result.current.data).toEqual(projects)
      expect(list.result.current.data).toEqual(projects)
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(mockGetAll).toHaveBeenCalledWith(0, 100)
  })

  it('does not fetch when disabled', () => {
    const { result } = renderHookWithClient(() =>
      useProjectOptions({ enabled: false }),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it.each([
    [SortBy.TITLE, SortOrder.ASC, ['second', 'first']],
    [SortBy.TITLE, SortOrder.DESC, ['first', 'second']],
    [SortBy.CREATED_AT, SortOrder.ASC, ['second', 'first']],
    [SortBy.CREATED_AT, SortOrder.DESC, ['first', 'second']],
    [SortBy.UPDATED_AT, SortOrder.ASC, ['first', 'second']],
    [SortBy.UPDATED_AT, SortOrder.DESC, ['second', 'first']],
    [SortBy.STATUS, SortOrder.ASC, ['first', 'second']],
    [SortBy.STATUS, SortOrder.DESC, ['second', 'first']],
  ])('sorts by %s %s without another request', async (sortBy, sortOrder, ids) => {
    const first = createMockProject({
      id: 'first',
      title: 'B',
      status: 'pending',
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    })
    const second = createMockProject({
      id: 'second',
      title: 'A',
      status: 'completed',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    })
    mockGetAll.mockResolvedValue([first, second])

    const { result } = renderHookWithClient(() =>
      useProjects({ sortBy, sortOrder }),
    )

    await waitFor(() => {
      expect(result.current.data?.map((project) => project.id)).toEqual(ids)
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  it('renders fresh cached list data without a detail request', () => {
    const cached = createMockProject({
      id: 'project-1',
      title: 'Cached',
    })
    const queryClient = createProjectTestClient()
    queryClient.setQueryData(projectKeys.options(), [cached], {
      updatedAt: Date.now(),
    })

    const { result } = renderHookWithClient(
      () => useProject('project-1'),
      { queryClient },
    )

    expect(result.current.data).toEqual(cached)
    expect(result.current.isLoading).toBe(false)
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('adds a created project to the shared cache', async () => {
    const existing = createMockProject({ id: 'existing' })
    const created = createMockProject({ id: 'created' })
    const queryClient = createProjectTestClient()
    queryClient.setQueryData(projectKeys.options(), [existing])
    mockCreate.mockResolvedValue(created)

    const { result } = renderHookWithClient(() => useCreateProject(), {
      queryClient,
    })
    await act(async () => {
      await result.current.mutateAsync({
        title: created.title,
        status: created.status,
      })
    })

    expect(queryClient.getQueryData(projectKeys.options())).toEqual([
      existing,
      created,
    ])
    expect(queryClient.getQueryData(projectKeys.detail(created.id))).toEqual(
      created,
    )
  })

  it('invalidates the collection after a cold-cache create', async () => {
    const created = createMockProject({ id: 'created' })
    const queryClient = createProjectTestClient()
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
    mockCreate.mockResolvedValue(created)

    const { result } = renderHookWithClient(() => useCreateProject(), {
      queryClient,
    })
    await act(async () => {
      await result.current.mutateAsync({
        title: created.title,
        status: created.status,
      })
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectKeys.options(),
    })
  })

  it('updates the detail and shared collection caches', async () => {
    const original = createMockProject({ id: 'project-1', title: 'Before' })
    const updated = { ...original, title: 'After' }
    const queryClient = createProjectTestClient()
    queryClient.setQueryData(projectKeys.options(), [original])
    mockUpdate.mockResolvedValue(updated)

    const { result } = renderHookWithClient(() => useUpdateProject(), {
      queryClient,
    })
    await act(async () => {
      await result.current.mutateAsync({
        id: original.id,
        data: { title: updated.title },
      })
    })

    expect(queryClient.getQueryData(projectKeys.options())).toEqual([updated])
    expect(queryClient.getQueryData(projectKeys.detail(original.id))).toEqual(
      updated,
    )
  })

  it('removes a deleted project after the dialog close delay', async () => {
    jest.useFakeTimers()
    const project = createMockProject({ id: 'project-1' })
    const queryClient = createProjectTestClient()
    queryClient.setQueryData(projectKeys.options(), [project])
    queryClient.setQueryData(projectKeys.detail(project.id), project)
    mockDelete.mockResolvedValue(undefined)

    const { result } = renderHookWithClient(() => useDeleteProject(), {
      queryClient,
    })
    await act(async () => {
      await result.current.mutateAsync(project.id)
    })
    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(queryClient.getQueryData(projectKeys.options())).toEqual([])
    expect(queryClient.getQueryData(projectKeys.detail(project.id))).toBeUndefined()
  })
})
