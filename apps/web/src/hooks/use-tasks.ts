import { useState, useEffect, useCallback } from 'react';
import { tasksApi } from '@/lib/api';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { Task, TaskCreate, TaskUpdate } from '@/types/task';

/**
 * Return type for task management hooks.
 */
export interface UseTasksReturn {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  createTask: (data: TaskCreate) => Promise<void>;
  updateTask: (id: string, data: TaskUpdate) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

interface TasksHookConfig {
  type: 'goal' | 'project';
  hookName: string;
}

/**
 * Factory function to create task hooks with shared logic.
 * Eliminates duplication between useTasks and useProjectTasks.
 */
function createTasksHook(config: TasksHookConfig) {
  const { type, hookName } = config;
  const idKey = type === 'goal' ? 'goalId' : 'projectId';

  return function useTasksInternal(id: string): UseTasksReturn {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTasks = useCallback(async () => {
      if (!id) return;

      try {
        setLoading(true);
        setError(null);
        log.component(hookName, 'fetching', { [idKey]: id });

        const data =
          type === 'goal'
            ? await tasksApi.getByGoal(id)
            : await tasksApi.getByProject(id);

        log.component(hookName, 'fetch_success', {
          count: data.length,
          [idKey]: id,
        });
        setTasks(data);
      } catch (err) {
        const errorMessage = handleHookError(err, hookName, 'fetch tasks', {
          [idKey]: id,
        });
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }, [id]);

    const createTask = useCallback(
      async (data: TaskCreate) => {
        try {
          setError(null);
          log.userAction('create_task', data, { component: hookName, [idKey]: id });

          const newTask = await tasksApi.create(data);
          log.component(hookName, 'create_success', {
            taskId: newTask.id,
            [idKey]: id,
          });

          setTasks((prev) => [...prev, newTask]);
        } catch (err) {
          const errorMessage = handleHookError(err, hookName, 'create task', {
            [idKey]: id,
          });
          setError(errorMessage);
          throw err;
        }
      },
      [id]
    );

    const updateTask = useCallback(async (taskId: string, data: TaskUpdate) => {
      try {
        setError(null);
        log.component(hookName, 'updating', { taskId, ...data });

        const updatedTask = await tasksApi.update(taskId, data);
        log.component(hookName, 'update_success', { taskId });

        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? updatedTask : task))
        );
      } catch (err) {
        const errorMessage = handleHookError(err, hookName, 'update task', {
          taskId,
        });
        setError(errorMessage);
        throw err;
      }
    }, []);

    const deleteTask = useCallback(async (taskId: string) => {
      try {
        setError(null);
        log.component(hookName, 'deleting', { taskId });

        await tasksApi.delete(taskId);
        log.component(hookName, 'delete_success', { taskId });

        setTasks((prev) => prev.filter((task) => task.id !== taskId));
      } catch (err) {
        const errorMessage = handleHookError(err, hookName, 'delete task', {
          taskId,
        });
        setError(errorMessage);
        throw err;
      }
    }, []);

    useEffect(() => {
      fetchTasks();
    }, [fetchTasks]);

    return {
      tasks,
      loading,
      error,
      createTask,
      updateTask,
      deleteTask,
      refetch: fetchTasks,
    };
  };
}

/**
 * Hook for managing tasks associated with a specific goal.
 * Provides CRUD operations and loading/error states.
 *
 * @param goalId - The goal UUID to fetch tasks for
 * @returns Task management state and methods
 *
 * @example
 * ```tsx
 * const { tasks, loading, createTask } = useTasks(goalId);
 * ```
 */
export const useTasks = createTasksHook({ type: 'goal', hookName: 'useTasks' });

/**
 * Hook for managing tasks associated with a specific project.
 * Similar to useTasks but fetches by project ID.
 *
 * @param projectId - The project UUID to fetch tasks for
 * @returns Task management state and methods
 *
 * @example
 * ```tsx
 * const { tasks, loading, createTask } = useProjectTasks(projectId);
 * ```
 */
export const useProjectTasks = createTasksHook({
  type: 'project',
  hookName: 'useProjectTasks',
});
