import { log } from '@/lib/logger';

/**
 * Centralized error handling for React hooks.
 * Provides consistent error message extraction and logging.
 *
 * @param err - The caught error
 * @param hookName - Name of the hook for logging context
 * @param action - The action being performed (e.g., "fetch tasks", "create task")
 * @param context - Additional context for logging
 * @param defaultMessage - Default message if error doesn't have a message
 * @returns The error message string for state
 */
export function handleHookError(
  err: unknown,
  hookName: string,
  action: string,
  context: Record<string, unknown> = {},
  defaultMessage?: string
): string {
  const errorMessage =
    err instanceof Error ? err.message : defaultMessage || `Failed to ${action}`;

  log.error(`Failed to ${action}`, err, {
    component: hookName,
    action: `${action.replace(/\s+/g, '_')}_error`,
    ...context,
  });

  return errorMessage;
}
