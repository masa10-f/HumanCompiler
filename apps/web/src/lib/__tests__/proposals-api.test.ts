// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
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

import { proposalsApi } from '../api'

function respondWith(body: unknown, status = 200) {
  mockFetchWithFallback.mockResolvedValue({
    ok: true,
    status,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(body),
  })
}

describe('proposalsApi', () => {
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
    respondWith({ items: [], total: 0 })
  })

  it('lists with every filter in a fixed order', async () => {
    await proposalsApi.list({
      status: 'decided',
      kind: 'experiment',
      limit: 50,
      offset: 50,
    })

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/proposals?status=decided&kind=experiment&limit=50&offset=50',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('omits unset filters', async () => {
    await proposalsApi.list({ status: 'pending' })

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/proposals?status=pending',
      expect.anything(),
    )
  })

  it('sends project_id between kind and limit', async () => {
    await proposalsApi.list({
      status: 'pending',
      kind: 'goal',
      project_id: 'p1',
      limit: 10,
      offset: 0,
    })

    expect(mockFetchWithFallback.mock.calls[0][0]).toBe(
      '/api/proposals?status=pending&kind=goal&project_id=p1&limit=10&offset=0',
    )
  })

  it('gets the summary', async () => {
    respondWith({ pending_count: 0, latest: [] })

    await proposalsApi.summary()

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/proposals/summary',
      expect.anything(),
    )
  })

  it('gets one proposal', async () => {
    respondWith({ id: 'a1' })

    await proposalsApi.get('a1')

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/proposals/a1',
      expect.anything(),
    )
  })

  it('accepts with a POST and the JSON body', async () => {
    const body = { payload: { title: 'Edited' }, decision_note: 'ok' }
    respondWith({ id: 'a1' })

    await proposalsApi.accept('a1', body)

    const [url, init] = mockFetchWithFallback.mock.calls[0]
    expect(url).toBe('/api/proposals/a1/accept')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(body)
  })

  it('rejects with a POST and the JSON body', async () => {
    const body = { reject_category: 'duplicate' as const, decision_note: 'seen' }
    respondWith({ id: 'a1' })

    await proposalsApi.reject('a1', body)

    const [url, init] = mockFetchWithFallback.mock.calls[0]
    expect(url).toBe('/api/proposals/a1/reject')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(body)
  })
})
