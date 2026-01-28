import { useState, useCallback, useEffect } from 'react';
import { notesApi } from '@/lib/api';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { ContextNote, ContextNoteUpdate, NoteEntityType } from '@/types/context-note';

export interface UseNoteReturn {
  note: ContextNote | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  updateNote: (data: ContextNoteUpdate) => Promise<void>;
  refetch: () => Promise<void>;
}

interface UseNoteConfig {
  entityType: NoteEntityType;
  entityId: string;
}

/**
 * Hook for managing context notes on projects, goals, or tasks.
 * Provides automatic loading and saving of note content.
 */
export function useNote({ entityType, entityId }: UseNoteConfig): UseNoteReturn {
  const [note, setNote] = useState<ContextNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hookName = `useNote:${entityType}`;

  const fetchNote = useCallback(async () => {
    if (!entityId) return;

    try {
      setLoading(true);
      setError(null);
      log.component(hookName, 'fetching', { entityType, entityId });

      let data: ContextNote;
      switch (entityType) {
        case 'project':
          data = await notesApi.getProjectNote(entityId);
          break;
        case 'goal':
          data = await notesApi.getGoalNote(entityId);
          break;
        case 'task':
          data = await notesApi.getTaskNote(entityId);
          break;
        default:
          throw new Error(`Invalid entity type: ${entityType}`);
      }

      log.component(hookName, 'fetch_success', { noteId: data.id });
      setNote(data);
    } catch (err) {
      const errorMessage = handleHookError(err, hookName, 'fetch note', {
        entityType,
        entityId,
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, hookName]);

  const updateNote = useCallback(
    async (data: ContextNoteUpdate) => {
      if (!entityId) return;

      try {
        setSaving(true);
        setError(null);
        log.component(hookName, 'saving', { entityType, entityId });

        let updated: ContextNote;
        switch (entityType) {
          case 'project':
            updated = await notesApi.updateProjectNote(entityId, data);
            break;
          case 'goal':
            updated = await notesApi.updateGoalNote(entityId, data);
            break;
          case 'task':
            updated = await notesApi.updateTaskNote(entityId, data);
            break;
          default:
            throw new Error(`Invalid entity type: ${entityType}`);
        }

        log.component(hookName, 'save_success', { noteId: updated.id });
        setNote(updated);
      } catch (err) {
        const errorMessage = handleHookError(err, hookName, 'update note', {
          entityType,
          entityId,
        });
        setError(errorMessage);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [entityType, entityId, hookName]
  );

  useEffect(() => {
    fetchNote();
  }, [fetchNote]);

  return {
    note,
    loading,
    error,
    saving,
    updateNote,
    refetch: fetchNote,
  };
}

/**
 * Convenience hook for project notes.
 */
export function useProjectNote(projectId: string): UseNoteReturn {
  return useNote({ entityType: 'project', entityId: projectId });
}

/**
 * Convenience hook for goal notes.
 */
export function useGoalNote(goalId: string): UseNoteReturn {
  return useNote({ entityType: 'goal', entityId: goalId });
}

/**
 * Convenience hook for task notes.
 */
export function useTaskNote(taskId: string): UseNoteReturn {
  return useNote({ entityType: 'task', entityId: taskId });
}
