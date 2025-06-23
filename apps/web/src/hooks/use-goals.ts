import { useState, useEffect, useCallback } from 'react';
import { goalsApi } from '@/lib/api';
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
      const data = await goalsApi.getByProject(projectId);
      setGoals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch goals');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const createGoal = useCallback(async (data: GoalCreate) => {
    try {
      setError(null);
      const newGoal = await goalsApi.create(data);
      setGoals(prev => [...prev, newGoal]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create goal');
      throw err;
    }
  }, []);

  const updateGoal = useCallback(async (id: string, data: GoalUpdate) => {
    try {
      setError(null);
      const updatedGoal = await goalsApi.update(id, data);
      setGoals(prev => prev.map(goal => 
        goal.id === id ? updatedGoal : goal
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update goal');
      throw err;
    }
  }, []);

  const deleteGoal = useCallback(async (id: string) => {
    try {
      setError(null);
      await goalsApi.delete(id);
      setGoals(prev => prev.filter(goal => goal.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete goal');
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