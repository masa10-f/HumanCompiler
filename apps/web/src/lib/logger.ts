// Structured logging utility for TaskAgent frontend
// Provides environment-aware logging with different levels

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface LogContext {
  component?: string;
  action?: string;
  userId?: string;
  projectId?: string;
  goalId?: string;
  taskId?: string;
  timestamp?: Date;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  data?: unknown;
  error?: Error;
}

/**
 * Centralized logger that intentionally uses console.* methods as output mechanism.
 * The goal is to replace scattered console.* calls with structured logging.
 */
class Logger {
  private isDevelopment: boolean;
  private logLevel: LogLevel;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';

    // Configurable log level via environment variable
    const envLogLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase();
    if (envLogLevel && Object.values(LogLevel).includes(envLogLevel as LogLevel)) {
      this.logLevel = envLogLevel as LogLevel;
    } else {
      // Default: DEBUG in development, WARN in production
      this.logLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
    }
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  /**
   * Format log entry for output
   */
  private formatLog(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;

    // Add component context if available
    const component = entry.context?.component ? `[${entry.context.component}]` : '';
    const action = entry.context?.action ? `[${entry.context.action}]` : '';

    const logPrefix = `${prefix}${component}${action}`;

    // Choose console method based on log level
    switch (entry.level) {
      case LogLevel.DEBUG:
        if (this.isDevelopment) {
          const debugArgs: unknown[] = [logPrefix, entry.message];
          if (entry.data !== undefined && entry.data !== null) debugArgs.push(entry.data);
          if (entry.context !== undefined && entry.context !== null) debugArgs.push(entry.context);
          console.debug(...debugArgs);
        }
        break;
      case LogLevel.INFO:
        const infoArgs: unknown[] = [logPrefix, entry.message];
        if (entry.data !== undefined && entry.data !== null) infoArgs.push(entry.data);
        if (entry.context !== undefined && entry.context !== null) infoArgs.push(entry.context);
        console.info(...infoArgs);
        break;
      case LogLevel.WARN:
        const warnArgs: unknown[] = [logPrefix, entry.message];
        if (entry.data !== undefined && entry.data !== null) warnArgs.push(entry.data);
        if (entry.context !== undefined && entry.context !== null) warnArgs.push(entry.context);
        console.warn(...warnArgs);
        break;
      case LogLevel.ERROR:
        const errorArgs: unknown[] = [logPrefix, entry.message];
        if (entry.error !== undefined && entry.error !== null) errorArgs.push(entry.error);
        else if (entry.data !== undefined && entry.data !== null) errorArgs.push(entry.data);
        if (entry.context !== undefined && entry.context !== null) errorArgs.push(entry.context);
        console.error(...errorArgs);

        // In production, you might want to send errors to an external service
        if (!this.isDevelopment && entry.error) {
          // Example: Send to error tracking service
          // this.sendToErrorTracking(entry);
        }
        break;
    }
  }

  /**
   * Debug level logging (development only)
   */
  debug(message: string, data?: unknown, context?: LogContext): void {
    this.formatLog({
      level: LogLevel.DEBUG,
      message,
      data,
      context: { ...context, timestamp: new Date() }
    });
  }

  /**
   * Info level logging
   */
  info(message: string, data?: unknown, context?: LogContext): void {
    this.formatLog({
      level: LogLevel.INFO,
      message,
      data,
      context: { ...context, timestamp: new Date() }
    });
  }

  /**
   * Warning level logging
   */
  warn(message: string, data?: unknown, context?: LogContext): void {
    this.formatLog({
      level: LogLevel.WARN,
      message,
      data,
      context: { ...context, timestamp: new Date() }
    });
  }

  /**
   * Error level logging
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.formatLog({
      level: LogLevel.ERROR,
      message,
      error: error instanceof Error ? error : undefined,
      data: error instanceof Error ? undefined : error,
      context: { ...context, timestamp: new Date() }
    });
  }

  /**
   * Log user actions for analytics
   */
  userAction(action: string, data?: unknown, context?: LogContext): void {
    this.info(`User action: ${action}`, data, {
      ...context,
      action: 'user_action'
    });
  }

  /**
   * Log API calls
   */
  apiCall(method: string, endpoint: string, data?: unknown, context?: LogContext): void {
    this.debug(`API ${method} ${endpoint}`, data, {
      ...context,
      action: 'api_call'
    });
  }

  /**
   * Log API responses
   */
  apiResponse(method: string, endpoint: string, status: number, data?: unknown, context?: LogContext): void {
    const level = status >= 400 ? LogLevel.ERROR : LogLevel.DEBUG;
    const message = `API ${method} ${endpoint} - ${status}`;

    if (level === LogLevel.ERROR) {
      this.error(message, data, { ...context, action: 'api_error' });
    } else {
      this.debug(message, data, { ...context, action: 'api_response' });
    }
  }

  /**
   * Log component lifecycle events
   */
  component(component: string, event: string, data?: unknown, context?: LogContext): void {
    this.debug(`${component} ${event}`, data, {
      ...context,
      component,
      action: event
    });
  }
}

// Export singleton logger instance
export const logger = new Logger();

// Export convenience functions for cleaner import syntax
export const log = {
  debug: (message: string, data?: unknown, context?: LogContext) => logger.debug(message, data, context),
  info: (message: string, data?: unknown, context?: LogContext) => logger.info(message, data, context),
  warn: (message: string, data?: unknown, context?: LogContext) => logger.warn(message, data, context),
  error: (message: string, error?: Error | unknown, context?: LogContext) => logger.error(message, error, context),
  userAction: (action: string, data?: unknown, context?: LogContext) => logger.userAction(action, data, context),
  apiCall: (method: string, endpoint: string, data?: unknown, context?: LogContext) => logger.apiCall(method, endpoint, data, context),
  apiResponse: (method: string, endpoint: string, status: number, data?: unknown, context?: LogContext) => logger.apiResponse(method, endpoint, status, data, context),
  component: (component: string, event: string, data?: unknown, context?: LogContext) => logger.component(component, event, data, context)
};

// For backwards compatibility and easy migration
export default logger;
