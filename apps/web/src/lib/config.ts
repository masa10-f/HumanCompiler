/**
 * Environment-based configuration management
 * Centralized configuration to avoid hardcoded URLs across the application
 */

export interface ApiEndpoints {
  production: string;
  preview: string;
  development: string;
}

export interface AppConfig {
  api: {
    endpoints: ApiEndpoints;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  security: {
    enforceHttps: boolean;
    allowInsecureRequests: boolean;
  };
  performance: {
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

// Environment-based API endpoints configuration
const API_ENDPOINTS: ApiEndpoints = {
  production: process.env.NEXT_PUBLIC_API_PRODUCTION_URL || 'https://humancompiler-api-masa.fly.dev',
  preview: process.env.NEXT_PUBLIC_API_PREVIEW_URL || 'https://humancompiler-api-masa-preview.fly.dev',
  development: process.env.NEXT_PUBLIC_API_DEVELOPMENT_URL || 'http://localhost:8000',
};

// Main application configuration
export const appConfig: AppConfig = {
  api: {
    endpoints: API_ENDPOINTS,
    timeout: parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '30000'),
    retryAttempts: parseInt(process.env.NEXT_PUBLIC_API_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.NEXT_PUBLIC_API_RETRY_DELAY || '1000'),
  },
  security: {
    enforceHttps: process.env.NODE_ENV === 'production',
    allowInsecureRequests: process.env.NODE_ENV === 'development',
  },
  performance: {
    enableLogging: process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_LOGGING === 'true',
    logLevel: (process.env.NEXT_PUBLIC_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  },
};

/**
 * Get the appropriate API endpoint based on environment and hostname
 */
export const getApiEndpoint = (): string => {
  // Client-side hostname detection
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // Production domain - use relative URL for Vercel rewrites
    if (hostname === 'human-compiler.vercel.app') {
      return ''; // Relative URL for production to leverage Vercel rewrites
    }

    // Production custom domain
    if (hostname === 'human-compiler.rityo-lab.com') {
      return appConfig.api.endpoints.production;
    }

    // Preview domains (Vercel preview, other custom domains)
    if (hostname.includes('humancompiler') || hostname.includes('human-compiler')) {
      return appConfig.api.endpoints.preview;
    }

    // Local development
    if (hostname === 'localhost' || hostname.startsWith('localhost:')) {
      return appConfig.api.endpoints.development;
    }

    // Other Vercel preview deployments
    if (hostname.endsWith('.vercel.app')) {
      return appConfig.api.endpoints.preview;
    }
  }

  // Server-side rendering
  if (typeof window === 'undefined') {
    return process.env.NODE_ENV === 'production'
      ? '' // Use relative URL for production SSR
      : appConfig.api.endpoints.development;
  }

  // Fallback
  return process.env.NODE_ENV === 'production'
    ? appConfig.api.endpoints.production
    : appConfig.api.endpoints.development;
};

/**
 * Get fallback API endpoint for error recovery
 */
export const getFallbackApiEndpoint = (): string => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // For production, fallback to direct API access
    if (hostname === 'human-compiler.vercel.app') {
      return appConfig.api.endpoints.production;
    }

    // For preview/development, fallback to production
    return appConfig.api.endpoints.production;
  }

  return appConfig.api.endpoints.production;
};

/**
 * Check if logging should be enabled based on configuration
 */
export const shouldLog = (level: 'debug' | 'info' | 'warn' | 'error' = 'info'): boolean => {
  if (!appConfig.performance.enableLogging) {
    return false;
  }

  const levels = ['debug', 'info', 'warn', 'error'];
  const currentLevelIndex = levels.indexOf(appConfig.performance.logLevel);
  const requestedLevelIndex = levels.indexOf(level);

  return requestedLevelIndex >= currentLevelIndex;
};

/**
 * Safe logging function that respects configuration
 */
export const safeLog = (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void => {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;

  switch (level) {
    case 'debug':
      console.debug(logMessage, ...args);
      break;
    case 'info':
      console.info(logMessage, ...args);
      break;
    case 'warn':
      console.warn(logMessage, ...args);
      break;
    case 'error':
      console.error(logMessage, ...args);
      break;
  }
};
