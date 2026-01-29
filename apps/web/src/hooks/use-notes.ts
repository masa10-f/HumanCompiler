import { useState, useCallback, useEffect, useRef } from 'react';
import { notesApi } from '@/lib/api';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { ContextNote, ContextNoteUpdate, NoteEntityType } from '@/types/context-note';

const DEBOUNCE_MS = 500;

export interface UseNoteReturn {
  note: ContextNote | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  updateNote: (data: ContextNoteUpdate) => void;
  updateNoteImmediate: (data: ContextNoteUpdate) => Promise<void>;
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
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestContentRef = useRef<string | null>(null);

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

  const updateNoteImmediate = useCallback(
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

        // Only update state if this is the latest content
        if (latestContentRef.current === null || latestContentRef.current === data.content) {
          log.component(hookName, 'save_success', { noteId: updated.id });
          setNote(updated);
        } else {
          log.component(hookName, 'save_skipped_stale', { noteId: updated.id });
        }
      } catch (err) {
        handleHookError(err, hookName, 'update note', {
          entityType,
          entityId,
        });
        setError('Failed to save note. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [entityType, entityId, hookName]
  );

  const updateNote = useCallback(
    (data: ContextNoteUpdate) => {
      if (!entityId) return;

      // Track latest content to prevent stale updates
      latestContentRef.current = data.content ?? null;

      // Optimistically update local state
      setNote((prev) => prev ? { ...prev, content: data.content ?? prev.content } : prev);

      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        updateNoteImmediate(data).catch(() => {
          // Error already handled in updateNoteImmediate
        });
      }, DEBOUNCE_MS);
    },
    [entityId, updateNoteImmediate]
  );

  useEffect(() => {
    fetchNote();
  }, [fetchNote]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    note,
    loading,
    error,
    saving,
    updateNote,
    updateNoteImmediate,
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
