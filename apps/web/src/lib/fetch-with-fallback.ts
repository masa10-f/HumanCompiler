/**
 * Enhanced fetch function with automatic fallback and retry capabilities
 * Implements Circuit Breaker pattern for API server failures
 */

import { getApiEndpoint, getFallbackApiEndpoint, appConfig, safeLog } from './config';
import { NetworkError } from './errors';

interface FetchWithFallbackOptions extends RequestInit {
  enableFallback?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

// Circuit breaker state for primary endpoint
const circuitBreaker: CircuitBreakerState = {
  failureCount: 0,
  lastFailureTime: 0,
  state: 'closed',
};

const CIRCUIT_BREAKER_THRESHOLD = 3; // Number of failures before opening circuit
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds before attempting to close circuit

/**
 * Update circuit breaker state based on request outcome
 */
const updateCircuitBreaker = (success: boolean): void => {
  if (success) {
    circuitBreaker.failureCount = 0;
    circuitBreaker.state = 'closed';
    safeLog('info', '🔄 Circuit breaker reset - primary endpoint healthy');
  } else {
    circuitBreaker.failureCount++;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreaker.state = 'open';
      safeLog('warn', `⚠️ Circuit breaker opened - ${circuitBreaker.failureCount} failures detected`);
    }
  }
};

/**
 * Check if circuit breaker should allow requests
 */
const shouldAllowRequest = (): boolean => {
  if (circuitBreaker.state === 'closed') {
    return true;
  }

  if (circuitBreaker.state === 'open') {
    const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailureTime;
    if (timeSinceLastFailure > CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreaker.state = 'half-open';
      safeLog('info', '🔄 Circuit breaker half-open - testing primary endpoint');
      return true;
    }
    return false;
  }

  // half-open state - allow one request to test
  return true;
};

/**
 * Create an AbortController with timeout
 */
const createTimeoutController = (timeout: number): AbortController => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout);
  return controller;
};

/**
 * Check if error indicates DNS resolution failure
 */
const isDnsError = (error: Error): boolean => {
  const errorMessage = error.message.toLowerCase();
  return (
    errorMessage.includes('err_name_not_resolved') ||
    errorMessage.includes('network error') ||
    errorMessage.includes('failed to fetch') ||
    errorMessage.includes('dns') ||
    errorMessage.includes('getaddrinfo')
  );
};

/**
 * Wait for specified delay with exponential backoff
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Enhanced fetch with automatic fallback and retry functionality
 */
export const fetchWithFallback = async (
  endpoint: string,
  options: FetchWithFallbackOptions = {}
): Promise<Response> => {
  const {
    enableFallback = true,
    maxRetries = appConfig.api.retryAttempts,
    retryDelay = appConfig.api.retryDelay,
    timeout = appConfig.api.timeout,
    ...fetchOptions
  } = options;

  const primaryUrl = getApiEndpoint();
  const fallbackUrl = getFallbackApiEndpoint();

  // Construct full URLs
  const primaryFullUrl = primaryUrl ? `${primaryUrl}${endpoint}` : endpoint;
  const fallbackFullUrl = `${fallbackUrl}${endpoint}`;

  safeLog('debug', '🔗 fetchWithFallback starting', {
    endpoint,
    primaryUrl: primaryFullUrl,
    fallbackUrl: fallbackFullUrl,
    enableFallback,
    maxRetries
  });

  // Try primary endpoint first (if circuit breaker allows)
  if (shouldAllowRequest()) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        safeLog('debug', `🎯 Attempting primary endpoint (${attempt}/${maxRetries})`, primaryFullUrl);

        const controller = createTimeoutController(timeout);
        const response = await fetch(primaryFullUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });

        if (response.ok) {
          updateCircuitBreaker(true);
          safeLog('info', '✅ Primary endpoint request successful', {
            status: response.status,
            url: primaryFullUrl
          });
          return response;
        } else {
          safeLog('warn', `⚠️ Primary endpoint returned error status: ${response.status}`, {
            url: primaryFullUrl,
            statusText: response.statusText
          });

          // Don't retry for client errors (4xx)
          if (response.status >= 400 && response.status < 500) {
            updateCircuitBreaker(false);
            return response;
          }
        }
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMessage = error instanceof Error ? error.message : String(error);

        safeLog('warn', `❌ Primary endpoint attempt ${attempt} failed: ${errorMessage}`, {
          url: primaryFullUrl,
          isLastAttempt,
          isDnsError: isDnsError(error as Error)
        });

        if (isDnsError(error as Error) || isLastAttempt) {
          updateCircuitBreaker(false);
          break;
        }

        // Wait before retry with exponential backoff
        if (!isLastAttempt) {
          const waitTime = retryDelay * Math.pow(2, attempt - 1);
          safeLog('debug', `⏱️ Waiting ${waitTime}ms before retry`);
          await sleep(waitTime);
        }
      }
    }
  } else {
    safeLog('info', '🚫 Circuit breaker open - skipping primary endpoint');
  }

  // Try fallback endpoint if enabled and available
  if (enableFallback && fallbackUrl && fallbackFullUrl !== primaryFullUrl) {
    safeLog('info', '🔄 Switching to fallback endpoint', fallbackFullUrl);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        safeLog('debug', `🎯 Attempting fallback endpoint (${attempt}/${maxRetries})`, fallbackFullUrl);

        const controller = createTimeoutController(timeout);
        const response = await fetch(fallbackFullUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });

        if (response.ok) {
          safeLog('info', '✅ Fallback endpoint request successful', {
            status: response.status,
            url: fallbackFullUrl
          });
          return response;
        } else {
          safeLog('warn', `⚠️ Fallback endpoint returned error status: ${response.status}`, {
            url: fallbackFullUrl,
            statusText: response.statusText
          });

          // Don't retry for client errors (4xx)
          if (response.status >= 400 && response.status < 500) {
            return response;
          }
        }
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMessage = error instanceof Error ? error.message : String(error);

        safeLog('error', `❌ Fallback endpoint attempt ${attempt} failed: ${errorMessage}`, {
          url: fallbackFullUrl,
          isLastAttempt
        });

        if (isLastAttempt) {
          // Both primary and fallback failed
          const networkError = new NetworkError(
            `All endpoints failed. Last error: ${errorMessage}`,
            { primaryUrl: primaryFullUrl, fallbackUrl: fallbackFullUrl, attempts: maxRetries }
          );
          throw networkError;
        }

        // Wait before retry
        const waitTime = retryDelay * Math.pow(2, attempt - 1);
        safeLog('debug', `⏱️ Waiting ${waitTime}ms before fallback retry`);
        await sleep(waitTime);
      }
    }
  }

  // All attempts failed
  const finalError = new NetworkError(
    'All API endpoints are unavailable',
    {
      primaryUrl: primaryFullUrl,
      fallbackUrl: enableFallback ? fallbackFullUrl : 'disabled',
      circuitBreakerState: circuitBreaker.state,
      attempts: maxRetries
    }
  );

  safeLog('error', '💥 All endpoints failed - throwing final error', finalError.context);
  throw finalError;
};

/**
 * Get current circuit breaker status for monitoring
 */
export const getCircuitBreakerStatus = (): CircuitBreakerState & { isHealthy: boolean } => {
  return {
    ...circuitBreaker,
    isHealthy: circuitBreaker.state === 'closed' && circuitBreaker.failureCount === 0,
  };
};

/**
 * Manually reset circuit breaker (for testing or administrative purposes)
 */
export const resetCircuitBreaker = (): void => {
  circuitBreaker.failureCount = 0;
  circuitBreaker.lastFailureTime = 0;
  circuitBreaker.state = 'closed';
  safeLog('info', '🔄 Circuit breaker manually reset');
};
