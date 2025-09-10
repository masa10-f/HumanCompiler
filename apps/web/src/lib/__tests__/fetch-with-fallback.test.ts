/**
 * Tests for fetch with fallback functionality
 */

import { fetchWithFallback, getCircuitBreakerStatus, resetCircuitBreaker } from '../fetch-with-fallback';
import { NetworkError } from '../errors';

// Mock the config module
jest.mock('../config', () => ({
  getApiEndpoint: jest.fn(() => 'https://primary-api.com'),
  getFallbackApiEndpoint: jest.fn(() => 'https://fallback-api.com'),
  appConfig: {
    api: {
      timeout: 5000,
      retryAttempts: 2,
      retryDelay: 100,
    },
  },
  safeLog: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

describe('fetchWithFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCircuitBreaker();
    (fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should make successful request to primary endpoint', async () => {
      const mockResponse = new Response('{"success": true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      const response = await fetchWithFallback('/test-endpoint');

      expect(fetch).toHaveBeenCalledWith(
        'https://primary-api.com/test-endpoint',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      expect(response).toBe(mockResponse);
    });

    it('should handle relative URLs correctly', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getApiEndpoint } = require('../config');
      getApiEndpoint.mockReturnValueOnce(''); // Empty string for relative URL

      const mockResponse = new Response('{"success": true}', { status: 200 });
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      await fetchWithFallback('/test-endpoint');

      expect(fetch).toHaveBeenCalledWith(
        '/test-endpoint',
        expect.any(Object)
      );
    });
  });

  describe('primary endpoint failures', () => {
    it('should fallback to secondary endpoint on DNS error', async () => {
      // Primary endpoint fails with DNS error
      (fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Failed to fetch: net::ERR_NAME_NOT_RESOLVED'))
        .mockResolvedValueOnce(new Response('{"success": true}', { status: 200 }));

      const response = await fetchWithFallback('/test-endpoint');

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(1, 'https://primary-api.com/test-endpoint', expect.any(Object));
      expect(fetch).toHaveBeenNthCalledWith(2, 'https://fallback-api.com/test-endpoint', expect.any(Object));
      expect(response.status).toBe(200);
    });

    it('should retry primary endpoint before fallback', async () => {
      // Primary endpoint fails twice, then fallback succeeds
      (fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new Response('{"success": true}', { status: 200 }));

      const response = await fetchWithFallback('/test-endpoint');

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(response.status).toBe(200);
    });

    it('should not retry on 4xx client errors', async () => {
      const errorResponse = new Response('{"error": "Bad Request"}', { status: 400 });
      (fetch as jest.Mock).mockResolvedValueOnce(errorResponse);

      const response = await fetchWithFallback('/test-endpoint');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(400);
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit breaker after multiple failures', async () => {
      // Simulate multiple failures to open circuit breaker
      const error = new TypeError('Failed to fetch: net::ERR_NAME_NOT_RESOLVED');
      (fetch as jest.Mock).mockRejectedValue(error);

      // First request - should try primary and fallback
      try {
        await fetchWithFallback('/test-endpoint');
      } catch (e) {
        // Expected to fail
      }

      // Check circuit breaker status
      const status = getCircuitBreakerStatus();
      expect(status.failureCount).toBeGreaterThan(0);
    });

    it('should reset circuit breaker on successful request', async () => {
      // First fail to increment failure count
      (fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Network error'))
        .mockResolvedValueOnce(new Response('{"success": true}', { status: 200 }));

      await fetchWithFallback('/test-endpoint');

      const status = getCircuitBreakerStatus();
      expect(status.failureCount).toBe(0);
      expect(status.state).toBe('closed');
    });
  });

  describe('error handling', () => {
    it('should throw NetworkError when all endpoints fail', async () => {
      const error = new TypeError('Failed to fetch');
      (fetch as jest.Mock).mockRejectedValue(error);

      await expect(fetchWithFallback('/test-endpoint')).rejects.toThrow(NetworkError);
    });

    it('should include context in error', async () => {
      const error = new TypeError('Failed to fetch');
      (fetch as jest.Mock).mockRejectedValue(error);

      try {
        await fetchWithFallback('/test-endpoint');
      } catch (e) {
        expect(e).toBeInstanceOf(NetworkError);
        expect((e as NetworkError).context).toBeDefined();
        expect((e as NetworkError).context.primaryUrl).toContain('primary-api.com');
        expect((e as NetworkError).context.fallbackUrl).toContain('fallback-api.com');
      }
    });
  });

  describe('options handling', () => {
    it('should respect enableFallback option', async () => {
      const error = new TypeError('Failed to fetch');
      (fetch as jest.Mock).mockRejectedValue(error);

      await expect(
        fetchWithFallback('/test-endpoint', { enableFallback: false })
      ).rejects.toThrow(NetworkError);

      // Should only try primary endpoint
      expect(fetch).toHaveBeenCalledTimes(2); // 2 retries on primary
    });

    it('should respect maxRetries option', async () => {
      const error = new Error('Network error');
      (fetch as jest.Mock).mockRejectedValue(error);

      await expect(
        fetchWithFallback('/test-endpoint', { maxRetries: 1 })
      ).rejects.toThrow(NetworkError);

      // Should try primary once, then fallback once
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should pass through fetch options', async () => {
      const mockResponse = new Response('{"success": true}', { status: 200 });
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      const headers = { 'Authorization': 'Bearer token' };
      await fetchWithFallback('/test-endpoint', {
        method: 'POST',
        headers,
        body: JSON.stringify({ test: true }),
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers,
          body: JSON.stringify({ test: true }),
        })
      );
    });
  });

  describe('timeout handling', () => {
    it('should timeout requests', async () => {
      // Mock a long-running request
      (fetch as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 10000))
      );

      await expect(
        fetchWithFallback('/test-endpoint', { timeout: 100 })
      ).rejects.toThrow();
    });
  });
});
