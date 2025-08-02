// Error toast utility for user-friendly error display

import React from 'react';
import { toast } from '@/hooks/use-toast';
import { AppError, getErrorMessage, isRetryableError, ErrorCode } from './errors';
import { ToastAction } from '@/components/ui/toast';

export interface ErrorToastOptions {
  title?: string;
  showRetryButton?: boolean;
  onRetry?: () => void;
  duration?: number;
}

/**
 * Display an error toast with appropriate messaging
 */
export function showErrorToast(
  error: Error,
  options: ErrorToastOptions = {}
): void {
  const {
    title = 'エラーが発生しました',
    showRetryButton = isRetryableError(error),
    onRetry,
    duration = 5000
  } = options;

  const userMessage = getErrorMessage(error);

  // Determine toast variant based on error type
  let variant: 'destructive' | 'default' = 'destructive';

  if (error instanceof AppError) {
    // For authentication errors, use default variant
    if (error.code === ErrorCode.UNAUTHORIZED || error.code === ErrorCode.AUTHENTICATION_REQUIRED) {
      variant = 'default';
    }
  }

  toast({
    title,
    description: userMessage,
    variant,
    duration,
    action: showRetryButton && onRetry
      ? <ToastAction altText="Retry" onClick={onRetry}>再試行</ToastAction>
      : undefined
  });
}

/**
 * Show a success toast
 */
export function showSuccessToast(
  message: string,
  title: string = '成功'
): void {
  toast({
    title,
    description: message,
    variant: 'default',
    duration: 3000
  });
}

/**
 * Show a warning toast
 */
export function showWarningToast(
  message: string,
  title: string = '警告'
): void {
  toast({
    title,
    description: message,
    variant: 'default',
    duration: 4000
  });
}

/**
 * Show a network error toast with specific messaging
 */
export function showNetworkErrorToast(onRetry?: () => void): void {
  toast({
    title: 'ネットワークエラー',
    description: 'インターネット接続を確認してください。',
    variant: 'destructive',
    duration: 6000,
    action: onRetry
      ? <ToastAction altText="Retry" onClick={onRetry}>再接続</ToastAction>
      : undefined
  });
}

/**
 * Show an authentication error toast
 */
export function showAuthErrorToast(onLogin?: () => void): void {
  toast({
    title: 'ログインが必要です',
    description: 'この機能を使用するにはログインしてください。',
    variant: 'default',
    duration: 5000,
    action: onLogin
      ? <ToastAction altText="Login" onClick={onLogin}>ログイン</ToastAction>
      : undefined
  });
}
