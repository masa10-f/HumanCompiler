// Custom error classes for frontend error handling

export enum ErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',

  // API errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT = 'CONFLICT',
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Client errors
  INVALID_DATA = 'INVALID_DATA',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Application specific errors
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // Unknown error
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface ErrorContext {
  endpoint?: string;
  method?: string;
  statusCode?: number;
  timestamp?: Date;
  userMessage?: string;
  retryable?: boolean;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly userMessage: string;
  public readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    context: ErrorContext = {},
    userMessage?: string
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = {
      ...context,
      timestamp: new Date()
    };
    this.userMessage = userMessage || this.getDefaultUserMessage();
    this.retryable = context.retryable ?? this.getDefaultRetryable();
  }

  private getDefaultUserMessage(): string {
    switch (this.code) {
      case ErrorCode.NETWORK_ERROR:
        return 'ネットワーク接続に問題があります。インターネット接続を確認してください。';
      case ErrorCode.TIMEOUT_ERROR:
        return 'リクエストがタイムアウトしました。もう一度お試しください。';
      case ErrorCode.UNAUTHORIZED:
        return 'ログインが必要です。';
      case ErrorCode.FORBIDDEN:
        return 'この操作を実行する権限がありません。';
      case ErrorCode.NOT_FOUND:
        return '要求されたリソースが見つかりません。';
      case ErrorCode.VALIDATION_ERROR:
        return '入力内容に問題があります。確認して再度お試しください。';
      case ErrorCode.CONFLICT:
        return 'データが他のユーザーによって変更されています。ページを更新してください。';
      case ErrorCode.SERVER_ERROR:
        return 'サーバーでエラーが発生しました。しばらく待ってから再度お試しください。';
      case ErrorCode.SERVICE_UNAVAILABLE:
        return 'サービスが一時的に利用できません。しばらく待ってから再度お試しください。';
      case ErrorCode.AUTHENTICATION_REQUIRED:
        return 'この機能を使用するにはログインが必要です。';
      case ErrorCode.PERMISSION_DENIED:
        return 'この操作を実行する権限がありません。';
      case ErrorCode.RESOURCE_NOT_FOUND:
        return '指定されたリソースが見つかりません。';
      case ErrorCode.EXTERNAL_SERVICE_ERROR:
        return '外部サービスとの通信でエラーが発生しました。';
      default:
        return '予期しないエラーが発生しました。管理者にお問い合わせください。';
    }
  }

  private getDefaultRetryable(): boolean {
    const retryableCodes = [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT_ERROR,
      ErrorCode.SERVER_ERROR,
      ErrorCode.SERVICE_UNAVAILABLE,
      ErrorCode.EXTERNAL_SERVICE_ERROR
    ];
    return retryableCodes.includes(this.code);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
      retryable: this.retryable,
      stack: this.stack
    };
  }
}

export class NetworkError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(ErrorCode.NETWORK_ERROR, message, context);
    this.name = 'NetworkError';
  }
}

export class ApiError extends AppError {
  public readonly statusCode: number;

  constructor(
    statusCode: number,
    message: string,
    context: ErrorContext = {},
    userMessage?: string
  ) {
    const code = ApiError.getErrorCodeFromStatus(statusCode);
    super(code, message, { ...context, statusCode }, userMessage);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }

  private static getErrorCodeFromStatus(statusCode: number): ErrorCode {
    switch (statusCode) {
      case 400:
        return ErrorCode.VALIDATION_ERROR;
      case 401:
        return ErrorCode.UNAUTHORIZED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 500:
        return ErrorCode.SERVER_ERROR;
      case 503:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return statusCode >= 500 ? ErrorCode.SERVER_ERROR : ErrorCode.UNKNOWN_ERROR;
    }
  }
}

export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(message: string, field?: string, context: ErrorContext = {}) {
    super(ErrorCode.VALIDATION_ERROR, message, context);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class InternalLogicError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(ErrorCode.UNKNOWN_ERROR, message, context);
    this.name = 'InternalLogicError';
  }
}

// Error handling utilities
export function isRetryableError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }

  // For non-AppError instances, check if it's a network-related error
  return error.name === 'TypeError' || error.message.includes('fetch');
}

export function getErrorMessage(error: Error): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }

  // Fallback for non-AppError instances
  return '予期しないエラーが発生しました。';
}

export function logError(error: Error, context?: Record<string, unknown>): void {
  const errorInfo = {
    message: error.message,
    name: error.name,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  };

  if (error instanceof AppError) {
    errorInfo.context = { ...(error.context ?? {}), ...(errorInfo.context ?? {}) };
  }

  console.error('Application Error:', errorInfo);

  // Here you could add integration with error tracking services like Sentry
  // if (window.Sentry) {
  //   window.Sentry.captureException(error, { extra: errorInfo });
  // }
}
