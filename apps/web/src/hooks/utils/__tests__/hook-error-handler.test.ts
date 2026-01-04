/**
 * @jest-environment jsdom
 */
import { handleHookError } from '../hook-error-handler';

// Mock logger
const mockLogError = jest.fn();
jest.mock('@/lib/logger', () => ({
  log: {
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

describe('handleHookError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('error message extraction', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Test error message');
      const result = handleHookError(error, 'useTest', 'fetch');

      expect(result).toBe('Test error message');
    });

    it('should use default message for non-Error values', () => {
      const result = handleHookError('string error', 'useTest', 'fetch');

      expect(result).toBe('Failed to fetch');
    });

    it('should use custom default message when provided', () => {
      const result = handleHookError(
        'string error',
        'useTest',
        'fetch',
        {},
        'Custom error message'
      );

      expect(result).toBe('Custom error message');
    });

    it('should handle null error', () => {
      const result = handleHookError(null, 'useTest', 'fetch');

      expect(result).toBe('Failed to fetch');
    });

    it('should handle undefined error', () => {
      const result = handleHookError(undefined, 'useTest', 'fetch');

      expect(result).toBe('Failed to fetch');
    });
  });

  describe('logging', () => {
    it('should log error with correct message format', () => {
      const error = new Error('Test error');
      handleHookError(error, 'useTest', 'fetch data');

      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to fetch data',
        error,
        expect.objectContaining({
          component: 'useTest',
          action: 'fetch_data_error',
        })
      );
    });

    it('should include additional context in log', () => {
      const error = new Error('Test error');
      handleHookError(error, 'useTest', 'create', { taskId: '123', goalId: 'goal-1' });

      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to create',
        error,
        expect.objectContaining({
          component: 'useTest',
          action: 'create_error',
          taskId: '123',
          goalId: 'goal-1',
        })
      );
    });

    it('should convert action with spaces to underscores in action field', () => {
      const error = new Error('Test error');
      handleHookError(error, 'useTasks', 'fetch tasks');

      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to fetch tasks',
        error,
        expect.objectContaining({
          action: 'fetch_tasks_error',
        })
      );
    });

    it('should log non-Error values', () => {
      const errorValue = { code: 500, message: 'Server error' };
      handleHookError(errorValue, 'useTest', 'fetch');

      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to fetch',
        errorValue,
        expect.objectContaining({
          component: 'useTest',
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty hook name', () => {
      const error = new Error('Test error');
      const result = handleHookError(error, '', 'fetch');

      expect(result).toBe('Test error');
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to fetch',
        error,
        expect.objectContaining({
          component: '',
        })
      );
    });

    it('should handle empty action', () => {
      const error = new Error('Test error');
      const result = handleHookError(error, 'useTest', '');

      expect(result).toBe('Test error');
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to ',
        error,
        expect.objectContaining({
          action: '_error',
        })
      );
    });
  });
});
