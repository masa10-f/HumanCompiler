// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */

import {
  fetchWithFallback,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
} from '../fetch-with-fallback'
import { NetworkError } from '../errors'

const mockGetFallbackApiEndpoint = jest.fn(() => '')

jest.mock('../config', () => ({
  getApiEndpoint: jest.fn(() => 'https://preview-api.example'),
  getFallbackApiEndpoint: () => mockGetFallbackApiEndpoint(),
  appConfig: { api: { timeout: 5000, retryAttempts: 3, retryDelay: 0 } },
  safeLog: jest.fn(),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

// jsdom has no Response, so tests use the parts of it fetchWithFallback reads.
const reply = (status: number) =>
  ({ ok: status >= 200 && status < 300, status, statusText: '' }) as Response

describe('fetchWithFallback', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockGetFallbackApiEndpoint.mockReturnValue('')
    resetCircuitBreaker()
  })

  it('returns the primary server error when there is no fallback', async () => {
    mockFetch.mockResolvedValue(reply(500))

    const response = await fetchWithFallback('/api/items')

    expect(response.status).toBe(500)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    for (const [url] of mockFetch.mock.calls) {
      expect(url).toBe('https://preview-api.example/api/items')
    }
  })

  it('backs off between retries after a server error', async () => {
    jest.useFakeTimers()
    try {
      mockFetch.mockResolvedValue(reply(500))

      const pending = fetchWithFallback('/api/items', { retryDelay: 1000 })

      await jest.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(999)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      await jest.advanceTimersByTimeAsync(2000)
      expect(mockFetch).toHaveBeenCalledTimes(3)
      // No wait after the last attempt.
      expect((await pending).status).toBe(500)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not open the circuit breaker on client errors', async () => {
    mockFetch.mockResolvedValue(reply(404))

    for (let i = 0; i < 4; i++) {
      expect((await fetchWithFallback('/api/items')).status).toBe(404)
    }

    expect(getCircuitBreakerStatus()).toMatchObject({ state: 'closed', failureCount: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('keeps trying the primary while the breaker is open if there is no fallback', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 0; i < 3; i++) {
      await expect(fetchWithFallback('/api/items')).rejects.toBeInstanceOf(NetworkError)
    }
    expect(getCircuitBreakerStatus().state).toBe('open')

    mockFetch.mockReset()
    mockFetch.mockResolvedValue(reply(200))

    expect((await fetchWithFallback('/api/items')).status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://preview-api.example/api/items',
      expect.any(Object),
    )
  })

  it('still switches to a configured fallback after primary server errors', async () => {
    mockGetFallbackApiEndpoint.mockReturnValue('https://fallback-api.example')
    mockFetch.mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(200))

    const response = await fetchWithFallback('/api/items')

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://fallback-api.example/api/items',
      expect.any(Object),
    )
  })
})
