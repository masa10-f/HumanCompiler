/**
 * @jest-environment jsdom
 */

import type {
  TriageApplyRequest,
  TriageCapacitySettingsUpdate,
  TriageItemOverrideRequest,
  TriageRun,
} from '@/types/triage'

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

import { triageApi } from '../api'

describe('triageApi', () => {
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

  const mockJsonResponse = (data: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(data),
  })

  it('updates capacity settings through the triage settings endpoint', async () => {
    const request: TriageCapacitySettingsUpdate = {
      weekly_capacity_hours: 35,
      meeting_buffer_hours: 5,
      project_allocations: {
        '11111111-1111-4111-8111-111111111111': 70,
      },
      inbox_allocation_percent: 30,
      work_type_caps: {
        focused_work: 20,
      },
      cadence_days: 7,
      auto_generate_enabled: true,
      use_ai_rank_adjustment: false,
    }

    mockFetchWithFallback.mockResolvedValueOnce(
      mockJsonResponse({
        ...request,
        id: 'settings-1',
        user_id: 'user-1',
        last_auto_triage_at: null,
        created_at: '2026-06-21T00:00:00Z',
        updated_at: '2026-06-21T00:00:00Z',
      })
    )

    await triageApi.updateSettings(request)

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/triage/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(request),
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })

  it('creates runs, overrides items, and applies selected cancellations', async () => {
    const run: Partial<TriageRun> = {
      id: 'run-1',
      status: 'ready',
      items: [],
    }
    mockFetchWithFallback
      .mockResolvedValueOnce(mockJsonResponse(run))
      .mockResolvedValueOnce(mockJsonResponse(run))
      .mockResolvedValueOnce(mockJsonResponse({ cancelled_task_ids: ['task-1'], cancelled_quick_task_ids: [] }))

    await triageApi.createRun({ use_ai_rank_adjustment: true })

    const overrideRequest: TriageItemOverrideRequest = {
      user_override: 'cancel',
    }
    await triageApi.overrideItem('run-1', 'item-1', overrideRequest)

    const applyRequest: TriageApplyRequest = {
      item_ids: ['item-1'],
    }
    await triageApi.applyRun('run-1', applyRequest)

    expect(mockFetchWithFallback).toHaveBeenNthCalledWith(
      1,
      '/api/triage/runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ use_ai_rank_adjustment: true }),
      })
    )
    expect(mockFetchWithFallback).toHaveBeenNthCalledWith(
      2,
      '/api/triage/runs/run-1/items/item-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(overrideRequest),
      })
    )
    expect(mockFetchWithFallback).toHaveBeenNthCalledWith(
      3,
      '/api/triage/runs/run-1/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(applyRequest),
      })
    )
  })

  it('creates a manual run without requiring a request body', async () => {
    const run: Partial<TriageRun> = {
      id: 'run-1',
      source: 'manual',
      status: 'ready',
      items: [],
    }
    mockFetchWithFallback.mockResolvedValueOnce(mockJsonResponse(run))

    await triageApi.createRun()

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/triage/runs',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(mockFetchWithFallback.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })
})
