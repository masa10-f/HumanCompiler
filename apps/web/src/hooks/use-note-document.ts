// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiError } from '@/lib/errors';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { ContextNoteUpdate } from '@/types/context-note';

const DEBOUNCE_MS = 500;

/** What the editor needs from a stored note, whatever it belongs to. */
export interface EditableNote {
  id: string | null;
  content: string;
  content_type: string;
  /** null for a note that has never been saved. */
  updated_at: string | null;
}

function normalizeNoteUpdate(data: ContextNoteUpdate): ContextNoteUpdate {
  if (data.content !== undefined && data.content_type === undefined) {
    return { ...data, content_type: 'html' };
  }

  return data;
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 409;
}

export interface UseNoteDocumentReturn<T extends EditableNote> {
  note: T | null;
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

export interface UseNoteDocumentConfig<T extends EditableNote> {
  /** Identifies the note; a new key loads that note. Empty: nothing to load. */
  noteKey: string;
  /** Name used in logs. */
  hookName: string;
  /** Extra fields for log and error context. */
  logContext?: Record<string, unknown>;
  load: () => Promise<T>;
  save: (body: ContextNoteUpdate) => Promise<T>;
}

/**
 * Loading, debounced saving and conflict handling for one rich-text note.
 *
 * Saves carry the note's last known `updated_at` as `expected_updated_at`, so
 * a note changed elsewhere (e.g. by an agent) gives a conflict instead of being
 * overwritten. Saves run one at a time: each waits for the one before it and
 * sends the `updated_at` that save returned. A note that has never been saved
 * (`updated_at` null) is saved without `expected_updated_at`.
 *
 * `load` and `save` may change on every render; only `noteKey` triggers a load.
 * A save goes through the `save` of the render that scheduled it. Give the
 * component a React `key` per note when one screen switches between notes, so
 * each note starts with fresh state. An edit still waiting for its debounce is
 * saved on unmount instead of being dropped.
 */
export function useNoteDocument<T extends EditableNote>({
  noteKey,
  hookName,
  logContext,
  load,
  save,
}: UseNoteDocumentConfig<T>): UseNoteDocumentReturn<T> {
  const [note, setNote] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const loadRef = useRef(load);
  const saveRef = useRef(save);
  const logContextRef = useRef(logContext);
  loadRef.current = load;
  saveRef.current = save;
  logContextRef.current = logContext;

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // The edit the debounce timer will save, with the save function to use.
  const pendingRef = useRef<{
    data: ContextNoteUpdate;
    save: (body: ContextNoteUpdate) => Promise<T>;
  } | null>(null);
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
    if (!noteKey) return false;

    try {
      setLoading(true);
      setError(null);
      log.component(hookName, 'fetching', logContextRef.current);

      const data = await loadRef.current();

      log.component(hookName, 'fetch_success', { noteId: data.id });
      baseUpdatedAtRef.current = data.updated_at;
      setNote(data);
      return true;
    } catch (err) {
      const errorMessage = handleHookError(
        err,
        hookName,
        'fetch note',
        logContextRef.current
      );
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [noteKey, hookName]);

  const fetchNote = useCallback(async () => {
    await loadNote();
  }, [loadNote]);

  /**
   * Queue one save. `locked` saves send `expected_updated_at` and are skipped
   * while there is a conflict; the overwrite save is not locked. Resolves to
   * whether the save was sent and succeeded.
   */
  const enqueueSave = useCallback(
    (
      data: ContextNoteUpdate,
      locked: boolean,
      saveFn: (body: ContextNoteUpdate) => Promise<T> = saveRef.current
    ): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        if (locked && conflictRef.current) {
          log.component(hookName, 'save_paused_conflict', logContextRef.current);
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
          log.component(hookName, 'saving', { ...logContextRef.current, locked });

          const updated = await saveFn(body);

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
            log.component(hookName, 'save_conflict', logContextRef.current);
            markConflict(true);
            return false;
          }
          handleHookError(err, hookName, 'update note', logContextRef.current);
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
    [hookName, markConflict]
  );

  const saveLocked = useCallback(
    async (
      data: ContextNoteUpdate,
      saveFn?: (body: ContextNoteUpdate) => Promise<T>
    ) => {
      const normalizedData = normalizeNoteUpdate(data);
      if (normalizedData.content !== undefined) {
        latestContentRef.current = normalizedData.content;
      }
      await enqueueSave(normalizedData, true, saveFn);
    },
    [enqueueSave]
  );

  const updateNoteImmediate = useCallback(
    async (data: ContextNoteUpdate) => {
      if (!noteKey) return;
      await saveLocked(data);
    },
    [noteKey, saveLocked]
  );

  const clearDebounce = useCallback(() => {
    pendingRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  /** Save the edit waiting for its debounce now, if there is one. */
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    clearDebounce();
    if (pending === null) return;
    saveLocked(pending.data, pending.save).catch(() => {
      // Error already handled in enqueueSave
    });
  }, [clearDebounce, saveLocked]);

  const updateNote = useCallback(
    (data: ContextNoteUpdate) => {
      if (!noteKey) return;

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
      pendingRef.current = { data: normalizedData, save: saveRef.current };
      debounceTimerRef.current = setTimeout(flushPending, DEBOUNCE_MS);
    },
    [noteKey, clearDebounce, flushPending]
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

  // Save a debounced edit on unmount rather than dropping it.
  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;
  useEffect(() => () => flushPendingRef.current(), []);

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
