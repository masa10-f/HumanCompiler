// Retry utility for API calls with exponential backoff

import { isRetryableError, logError } from './errors';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryCondition?: (error: Error) => boolean;
}

export interface RetryContext {
  attempt: number;
  totalAttempts: number;
  delay: number;
  error: Error;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryCondition: isRetryableError
};

/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on the last attempt
      if (attempt > opts.maxRetries) {
        break;
      }

      // Check if the error is retryable
      if (!opts.retryCondition(lastError)) {
        logError(lastError, {
          reason: 'Non-retryable error',
          attempt,
          maxRetries: opts.maxRetries
        });
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelay
      );

      logError(lastError, {
        reason: 'Retryable error, will retry',
        attempt,
        maxRetries: opts.maxRetries,
        nextRetryIn: delay
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  if (lastError) {
    logError(lastError, {
      reason: 'All retries exhausted',
      totalAttempts: opts.maxRetries + 1
    });
    throw lastError;
  }

  // This should never happen, but provide a fallback
  throw new Error('All retries exhausted, but no error was captured.');
}

/**
 * Create a retryable version of an async function
 */
export function createRetryableFunction<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * Sleep utility for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add jitter to delay to avoid thundering herd problem
 */
export function addJitter(delay: number, jitterFactor: number = 0.1): number {
  const jitter = delay * jitterFactor * Math.random();
  return delay + jitter;
}
