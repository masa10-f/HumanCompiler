import { useState, useEffect, useCallback } from 'react';
import { goalsApi } from '@/lib/api';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal';

export interface UseGoalsReturn {
  goals: Goal[];
  loading: boolean;
  error: string | null;
  createGoal: (data: GoalCreate) => Promise<void>;
  updateGoal: (id: string, data: GoalUpdate) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useGoals(projectId: string): UseGoalsReturn {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError(null);
      log.component('useGoals', 'fetching', { projectId });

      const data = await goalsApi.getByProject(projectId);
      log.component('useGoals', 'fetch_success', {
        count: data.length,
        projectId,
      });
      setGoals(data);
    } catch (err) {
      const errorMessage = handleHookError(err, 'useGoals', 'fetch goals', {
        projectId,
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const createGoal = useCallback(
    async (data: GoalCreate) => {
      try {
        setError(null);
        log.userAction('create_goal', data, {
          component: 'useGoals',
          projectId,
        });

        const newGoal = await goalsApi.create(data);
        log.component('useGoals', 'create_success', {
          goalId: newGoal.id,
          projectId,
        });

        setGoals((prev) => [...prev, newGoal]);
      } catch (err) {
        const errorMessage = handleHookError(err, 'useGoals', 'create goal', {
          projectId,
        });
        setError(errorMessage);
        throw err;
      }
    },
    [projectId]
  );

  const updateGoal = useCallback(async (id: string, data: GoalUpdate) => {
    try {
      setError(null);
      log.component('useGoals', 'updating', { goalId: id, ...data });

      const updatedGoal = await goalsApi.update(id, data);
      log.component('useGoals', 'update_success', { goalId: id });

      setGoals((prev) =>
        prev.map((goal) => (goal.id === id ? updatedGoal : goal))
      );
    } catch (err) {
      const errorMessage = handleHookError(err, 'useGoals', 'update goal', {
        goalId: id,
      });
      setError(errorMessage);
      throw err;
    }
  }, []);

  const deleteGoal = useCallback(async (id: string) => {
    try {
      setError(null);
      log.component('useGoals', 'deleting', { goalId: id });

      await goalsApi.delete(id);
      log.component('useGoals', 'delete_success', { goalId: id });

      setGoals((prev) => prev.filter((goal) => goal.id !== id));
    } catch (err) {
      const errorMessage = handleHookError(err, 'useGoals', 'delete goal', {
        goalId: id,
      });
      setError(errorMessage);
      throw err;
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  return {
    goals,
    loading,
    error,
    createGoal,
    updateGoal,
    deleteGoal,
    refetch: fetchGoals,
  };
}
