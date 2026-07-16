/**
 * @jest-environment jsdom
 */

const mockGetSession = jest.fn()
const mockRefreshSession = jest.fn()
const mockFetchWithFallback = jest.fn()

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => mockRefreshSession(),
    },
  },
}))

jest.mock('../fetch-with-fallback', () => ({
  fetchWithFallback: (...args: unknown[]) => mockFetchWithFallback(...args),
}))

jest.mock('../config', () => ({
  getApiEndpoint: jest.fn(() => ''),
  appConfig: {
    api: {
      timeout: 30000,
      retryAttempts: 0,
      retryDelay: 0,
    },
    security: {
      enforceHttps: false,
    },
  },
  safeLog: jest.fn(),
}))

jest.mock('../errors', () => {
  const actual = jest.requireActual('../errors')
  return {
    ...actual,
    logError: jest.fn(),
  }
})

import { tasksApi } from '../api'

const rawTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  title: 'Task 1',
  description: null,
  memo: null,
  estimate_hours: 2,
  due_date: null,
  status: 'pending',
  work_type: 'light_work',
  priority: 3,
  goal_id: 'goal-1',
  created_at: '2026-06-27T00:00:00Z',
  updated_at: '2026-06-27T00:00:00Z',
  dependencies: [],
  ...overrides,
})

const mockJsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: jest.fn().mockResolvedValue(data),
})

describe('tasksApi', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    })
  })

  it('normalizes string estimate_hours from task list responses', async () => {
    mockFetchWithFallback.mockResolvedValueOnce(
      mockJsonResponse([
        rawTask({ id: 'task-1', estimate_hours: '2.50' }),
        rawTask({ id: 'task-2', estimate_hours: 1.25 }),
      ])
    )

    const tasks = await tasksApi.getByGoal('goal-1')

    expect(tasks).toEqual([
      expect.objectContaining({ id: 'task-1', estimate_hours: 2.5 }),
      expect.objectContaining({ id: 'task-2', estimate_hours: 1.25 }),
    ])
  })

  it('normalizes string estimate_hours from single task responses', async () => {
    mockFetchWithFallback.mockResolvedValueOnce(
      mockJsonResponse(rawTask({ estimate_hours: '3.75' }))
    )

    const task = await tasksApi.getById('task-1')

    expect(task.estimate_hours).toBe(3.75)
  })

  it('normalizes invalid estimate_hours values to zero at the API boundary', async () => {
    mockFetchWithFallback.mockResolvedValueOnce(
      mockJsonResponse(rawTask({ estimate_hours: 'not-a-number' }))
    )

    const task = await tasksApi.update('task-1', { title: 'Updated' })

    expect(task.estimate_hours).toBe(0)
  })

  it('loads the cross-project workspace with filters in one request', async () => {
    mockFetchWithFallback.mockResolvedValueOnce(
      mockJsonResponse({
        items: [
          rawTask({
            estimate_hours: '3.50',
            remaining_estimate_hours: '2.25',
            project_id: 'project-1',
            project_title: 'Project 1',
            goal_title: 'Goal 1',
            is_blocked: false,
            blocking_task_ids: [],
            last_worked_at: null,
            planned_today: true,
            planned_this_week: true,
          }),
        ],
        total: 1,
        skip: 0,
        limit: 50,
      })
    )

    const page = await tasksApi.getWorkspace({
      status: ['pending', 'in_progress'],
      projectId: 'project-1',
      projectStatus: 'in_progress',
      plan: 'today',
      search: 'workspace',
    })

    expect(mockFetchWithFallback).toHaveBeenCalledTimes(1)
    expect(mockFetchWithFallback.mock.calls[0]?.[0]).toContain(
      '/api/tasks?status=pending&status=in_progress&project_id=project-1&project_status=in_progress&search=workspace&plan=today'
    )
    expect(page.items[0]).toEqual(
      expect.objectContaining({ estimate_hours: 3.5, remaining_estimate_hours: 2.25 })
    )
  })
})
