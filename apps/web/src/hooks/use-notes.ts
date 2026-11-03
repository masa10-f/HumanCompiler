import { useState, useCallback, useEffect, useRef } from 'react';
import { notesApi } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { ContextNote, ContextNoteUpdate, NoteEntityType } from '@/types/context-note';

const DEBOUNCE_MS = 500;

function normalizeNoteUpdate(data: ContextNoteUpdate): ContextNoteUpdate {
  if (data.content !== undefined && data.content_type === undefined) {
    return { ...data, content_type: 'html' };
  }

  return data;
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 409;
}

export interface UseNoteReturn {
  note: ContextNote | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** The note changed elsewhere since it was read; saves are paused. */
  conflict: boolean;
  updateNote: (data: ContextNoteUpdate) => void;
  updateNoteImmediate: (data: ContextNoteUpdate) => Promise<void>;
  refetch: () => Promise<void>;
  /** Refetch the note, drop the unsaved local content and clear `conflict`. */
  reloadLatest: () => Promise<void>;
  /** Save the latest local content over the other change and clear `conflict`. */
  overwrite: () => Promise<void>;
}

interface UseNoteConfig {
  entityType: NoteEntityType;
  entityId: string;
}

/**
 * Hook for managing context notes on projects, goals, or tasks.
 * Provides automatic loading and saving of note content.
 *
 * Saves carry the note's last known `updated_at` as `expected_updated_at`, so
 * a note changed elsewhere (e.g. by an agent) gives a conflict instead of being
 * overwritten. Saves run one at a time: each waits for the one before it and
 * sends the `updated_at` that save returned.
 */
export function useNote({ entityType, entityId }: UseNoteConfig): UseNoteReturn {
  const [note, setNote] = useState<ContextNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const hookName = `useNote:${entityType}`;
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestContentRef = useRef<string | null>(null);
  // The updated_at of the version this tab last read or wrote.
  const baseUpdatedAtRef = useRef<string | null>(null);
  // Tail of the save queue; each save starts after the previous one settles.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const savesInFlightRef = useRef(0);
  const conflictRef = useRef(false);

  const markConflict = useCallback((value: boolean) => {
    conflictRef.current = value;
    setConflict(value);
  }, []);

  const loadNote = useCallback(async (): Promise<boolean> => {
    if (!entityId) return false;

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
      baseUpdatedAtRef.current = data.updated_at;
      setNote(data);
      return true;
    } catch (err) {
      const errorMessage = handleHookError(err, hookName, 'fetch note', {
        entityType,
        entityId,
      });
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, hookName]);

  const fetchNote = useCallback(async () => {
    await loadNote();
  }, [loadNote]);

  /**
   * Queue one save. `locked` saves send `expected_updated_at` and are skipped
   * while there is a conflict; the overwrite save is not locked. Resolves to
   * whether the save was sent and succeeded.
   */
  const enqueueSave = useCallback(
    (data: ContextNoteUpdate, locked: boolean): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        if (locked && conflictRef.current) {
          log.component(hookName, 'save_paused_conflict', { entityType, entityId });
          return false;
        }

        // The lock comes from baseUpdatedAtRef only; an unlocked save sends none.
        const body: ContextNoteUpdate = { ...data };
        delete body.expected_updated_at;
        if (locked && baseUpdatedAtRef.current) {
          body.expected_updated_at = baseUpdatedAtRef.current;
        }

        savesInFlightRef.current += 1;
        try {
          setSaving(true);
          setError(null);
          log.component(hookName, 'saving', { entityType, entityId, locked });

          let updated: ContextNote;
          switch (entityType) {
            case 'project':
              updated = await notesApi.updateProjectNote(entityId, body);
              break;
            case 'goal':
              updated = await notesApi.updateGoalNote(entityId, body);
              break;
            case 'task':
              updated = await notesApi.updateTaskNote(entityId, body);
              break;
            default:
              throw new Error(`Invalid entity type: ${entityType}`);
          }

          baseUpdatedAtRef.current = updated.updated_at;

          // Only update state if this is the latest content
          if (latestContentRef.current === null || latestContentRef.current === body.content) {
            log.component(hookName, 'save_success', { noteId: updated.id });
            setNote(updated);
          } else {
            log.component(hookName, 'save_skipped_stale', { noteId: updated.id });
          }
          return true;
        } catch (err) {
          if (isConflict(err)) {
            log.component(hookName, 'save_conflict', { entityType, entityId });
            markConflict(true);
            return false;
          }
          handleHookError(err, hookName, 'update note', {
            entityType,
            entityId,
          });
          setError('Failed to save note. Please try again.');
          return false;
        } finally {
          savesInFlightRef.current -= 1;
          if (savesInFlightRef.current === 0) {
            setSaving(false);
          }
        }
      };

      const next = saveChainRef.current.then(run, run);
      saveChainRef.current = next;
      return next;
    },
    [entityType, entityId, hookName, markConflict]
  );

  const updateNoteImmediate = useCallback(
    async (data: ContextNoteUpdate) => {
      if (!entityId) return;

      const normalizedData = normalizeNoteUpdate(data);
      if (normalizedData.content !== undefined) {
        latestContentRef.current = normalizedData.content;
      }
      await enqueueSave(normalizedData, true);
    },
    [entityId, enqueueSave]
  );

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const updateNote = useCallback(
    (data: ContextNoteUpdate) => {
      if (!entityId) return;

      const normalizedData = normalizeNoteUpdate(data);

      // Track latest content to prevent stale updates
      latestContentRef.current = normalizedData.content ?? null;

      // Optimistically update local state
      setNote((prev) => prev ? {
        ...prev,
        content: normalizedData.content ?? prev.content,
        content_type: normalizedData.content_type ?? prev.content_type,
      } : prev);

      clearDebounce();

      // While there is a conflict, keep the content locally and send nothing.
      if (conflictRef.current) return;

      // Set new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        updateNoteImmediate(normalizedData).catch(() => {
          // Error already handled in updateNoteImmediate
        });
      }, DEBOUNCE_MS);
    },
    [entityId, updateNoteImmediate, clearDebounce]
  );

  const reloadLatest = useCallback(async () => {
    clearDebounce();
    latestContentRef.current = null;
    // Let a save in flight settle so its response cannot replace the reload.
    await saveChainRef.current;
    if (await loadNote()) {
      markConflict(false);
    }
  }, [clearDebounce, loadNote, markConflict]);

  const overwrite = useCallback(async () => {
    clearDebounce();
    const content = latestContentRef.current;
    if (content === null) {
      markConflict(false);
      return;
    }
    if (await enqueueSave(normalizeNoteUpdate({ content }), false)) {
      markConflict(false);
      // Text typed while the overwrite was in flight was kept but not sent.
      const typedSince = latestContentRef.current;
      if (typedSince !== null && typedSince !== content) {
        await enqueueSave(normalizeNoteUpdate({ content: typedSince }), true);
      }
    }
  }, [clearDebounce, enqueueSave, markConflict]);

  useEffect(() => {
    markConflict(false);
    fetchNote();
  }, [fetchNote, markConflict]);

  // Cleanup debounce timer on unmount
  useEffect(() => clearDebounce, [clearDebounce]);

  return {
    note,
    loading,
    error,
    saving,
    conflict,
    updateNote,
    updateNoteImmediate,
    refetch: fetchNote,
    reloadLatest,
    overwrite,
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
