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

import { agentTokensApi } from '../api'

function respondWith(body: unknown, status = 200) {
  mockFetchWithFallback.mockResolvedValue({
    ok: true,
    status,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(body),
  })
}

describe('agentTokensApi', () => {
  const catalog = {
    scopes: [{ scope: 'tasks:read', description: 'Read tasks', broad: false }],
    presets: [
      {
        key: 'read_only',
        label: 'Read only',
        description: 'Read everything',
        scopes: ['tasks:read'],
      },
    ],
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
    respondWith(catalog)
  })

  it('gets the scope catalog as returned by the API', async () => {
    const result = await agentTokensApi.getScopes()

    expect(result).toEqual(catalog)
    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/user/agent-tokens/scopes',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('rejects the legacy array response from the scope endpoint', async () => {
    respondWith([{ scope: 'tasks:read', description: 'Read tasks' }])

    await expect(agentTokensApi.getScopes()).rejects.toThrow(
      'Unexpected scope catalog response',
    )
  })

  it('rejects a catalog without presets', async () => {
    respondWith({ scopes: [] })

    await expect(agentTokensApi.getScopes()).rejects.toThrow(
      'Unexpected scope catalog response',
    )
  })

  it('lists the tokens', async () => {
    respondWith([])

    await agentTokensApi.getAll()

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/user/agent-tokens',
      expect.anything(),
    )
  })

  it('gets audit logs with a limit', async () => {
    respondWith([])

    await agentTokensApi.getAuditLogs('t1', 20)

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/user/agent-tokens/t1/audit-logs?limit=20',
      expect.anything(),
    )
  })

  it('creates a token with a POST body', async () => {
    const data = { name: 'Agent', description: 'Notes', scopes: ['tasks:read'] }
    respondWith({ id: 't1', ...data })

    await agentTokensApi.create(data)

    const [url, init] = mockFetchWithFallback.mock.calls[0]
    expect(url).toBe('/api/user/agent-tokens')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(data)
  })

  it('revokes a token with a DELETE', async () => {
    mockFetchWithFallback.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: jest.fn(),
    })

    await agentTokensApi.revoke('t1')

    expect(mockFetchWithFallback).toHaveBeenCalledWith(
      '/api/user/agent-tokens/t1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
