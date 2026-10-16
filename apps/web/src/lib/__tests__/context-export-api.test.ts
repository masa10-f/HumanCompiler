// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

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

import { buildContextExportQuery, contextExportApi } from '../api'
import { DEFAULT_CONTEXT_EXPORT_OPTIONS } from '@/types/context-export'

describe('contextExportApi', () => {
  const exportResponse = {
    filename: 'Project_context_20260928.md',
    markdown: '# AIコンテキスト: Project\n',
    generated_at: '2026-09-28T03:00:00+00:00',
  }

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
    mockFetchWithFallback.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(exportResponse),
    })
  })

  it('requests a project export with the default options', async () => {
    const result = await contextExportApi.get(
      'project',
      'project-1',
      DEFAULT_CONTEXT_EXPORT_OPTIONS,
    )

    expect(result).toEqual(exportResponse)
    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/context-export/projects/project-1?include_completed=true&include_work_sessions=true&include_daily_plans=true',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('requests a goal export with toggles and a period', async () => {
    await contextExportApi.get('goal', 'goal-1', {
      includeCompleted: false,
      includeWorkSessions: true,
      includeDailyPlans: false,
      periodDays: 30,
    })

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/context-export/goals/goal-1?include_completed=false&include_work_sessions=true&include_daily_plans=false&period_days=30',
      expect.anything(),
    )
  })

  it('omits the period when exporting all history', () => {
    expect(buildContextExportQuery(DEFAULT_CONTEXT_EXPORT_OPTIONS)).not.toContain(
      'period_days',
    )
  })
})
