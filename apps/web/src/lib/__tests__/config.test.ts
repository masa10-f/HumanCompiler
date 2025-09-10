/**
 * Tests for configuration management
 */

import { getApiEndpoint, getFallbackApiEndpoint, shouldLog, safeLog, appConfig } from '../config';

// Mock window object for testing
const mockWindow = (hostname: string) => {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
  });
};

// Mock environment variables
const mockEnv = (env: Partial<typeof process.env>) => {
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env };
  return () => {
    process.env = originalEnv;
  };
};

describe('Configuration Management', () => {
  beforeEach(() => {
    // Reset console methods
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getApiEndpoint', () => {
    it('should return empty string for production hostname', () => {
      mockWindow('human-compiler.vercel.app');
      expect(getApiEndpoint()).toBe('');
    });

    it('should return preview API for humancompiler preview domains', () => {
      mockWindow('humancompiler-preview-123.vercel.app');
      expect(getApiEndpoint()).toBe(appConfig.api.endpoints.preview);
    });

    it('should return development API for localhost', () => {
      mockWindow('localhost:3000');
      expect(getApiEndpoint()).toBe(appConfig.api.endpoints.development);
    });

    it('should return preview API for other vercel.app domains', () => {
      mockWindow('some-preview.vercel.app');
      expect(getApiEndpoint()).toBe(appConfig.api.endpoints.preview);
    });

    it('should handle server-side rendering', () => {
      // Mock server-side environment
      const restoreEnv = mockEnv({ NODE_ENV: 'production' });

      // Temporarily remove window
      const originalWindow = global.window;
      delete (global as unknown as { window: unknown }).window;

      expect(getApiEndpoint()).toBe('');

      // Restore
      global.window = originalWindow;
      restoreEnv();
    });
  });

  describe('getFallbackApiEndpoint', () => {
    it('should return production API for production hostname', () => {
      mockWindow('human-compiler.vercel.app');
      expect(getFallbackApiEndpoint()).toBe(appConfig.api.endpoints.production);
    });

    it('should return production API as fallback for other domains', () => {
      mockWindow('some-preview.vercel.app');
      expect(getFallbackApiEndpoint()).toBe(appConfig.api.endpoints.production);
    });
  });

  describe('shouldLog', () => {
    it('should respect logging configuration', () => {
      // Test when logging is disabled
      const originalConfig = appConfig.performance.enableLogging;
      appConfig.performance.enableLogging = false;

      expect(shouldLog('info')).toBe(false);
      expect(shouldLog('error')).toBe(false);

      // Restore
      appConfig.performance.enableLogging = originalConfig;
    });

    it('should respect log levels', () => {
      const originalConfig = { ...appConfig.performance };
      appConfig.performance.enableLogging = true;
      appConfig.performance.logLevel = 'warn';

      expect(shouldLog('debug')).toBe(false);
      expect(shouldLog('info')).toBe(false);
      expect(shouldLog('warn')).toBe(true);
      expect(shouldLog('error')).toBe(true);

      // Restore
      appConfig.performance = originalConfig;
    });
  });

  describe('safeLog', () => {
    it('should log when enabled', () => {
      const originalConfig = { ...appConfig.performance };
      appConfig.performance.enableLogging = true;
      appConfig.performance.logLevel = 'debug';

      safeLog('info', 'Test message', { test: true });

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('Test message'),
        { test: true }
      );

      // Restore
      appConfig.performance = originalConfig;
    });

    it('should not log when disabled', () => {
      const originalConfig = appConfig.performance.enableLogging;
      appConfig.performance.enableLogging = false;

      safeLog('info', 'Test message');

      expect(console.info).not.toHaveBeenCalled();

      // Restore
      appConfig.performance.enableLogging = originalConfig;
    });

    it('should respect log levels', () => {
      const originalConfig = { ...appConfig.performance };
      appConfig.performance.enableLogging = true;
      appConfig.performance.logLevel = 'error';

      safeLog('info', 'Info message');
      safeLog('error', 'Error message');

      expect(console.info).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error message')
      );

      // Restore
      appConfig.performance = originalConfig;
    });
  });

  describe('appConfig', () => {
    it('should have valid default configuration', () => {
      expect(appConfig.api.endpoints.development).toBe('http://localhost:8000');
      expect(appConfig.api.timeout).toBeGreaterThan(0);
      expect(appConfig.api.retryAttempts).toBeGreaterThan(0);
      expect(appConfig.security.enforceHttps).toBeDefined();
      expect(appConfig.performance.enableLogging).toBeDefined();
    });

    it('should read environment variables correctly', () => {
      const restoreEnv = mockEnv({
        NEXT_PUBLIC_API_TIMEOUT: '5000',
        NEXT_PUBLIC_API_RETRY_ATTEMPTS: '5',
        NODE_ENV: 'production',
      });

      // Re-import to get fresh config with new env vars
      delete require.cache[require.resolve('../config')];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { appConfig: freshConfig } = require('../config');

      expect(freshConfig.api.timeout).toBe(5000);
      expect(freshConfig.api.retryAttempts).toBe(5);
      expect(freshConfig.security.enforceHttps).toBe(true);

      restoreEnv();
    });
  });
});
