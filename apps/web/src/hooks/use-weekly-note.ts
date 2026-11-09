// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { weeklyNotesApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useNoteDocument, type UseNoteDocumentReturn } from './use-note-document';
import type { WeeklyNote } from '@/types/weekly-note';

/**
 * Load the weekly note of the week that contains `day` (any day of it) and
 * save it, with the same debounced saves and conflict handling as context
 * notes. The server decides the week (the user's week start, or the days of an
 * older note), and saves go to that week's first day. Remount the component
 * (React `key`) when `day` changes. Each successful save refreshes the weekly
 * note lists, also for a save flushed after the component unmounted.
 */
export function useWeeklyNote(day: string): UseNoteDocumentReturn<WeeklyNote> {
  // The week_start the server resolved `day` to; saves cannot run before load.
  const weekStartRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  return useNoteDocument<WeeklyNote>({
    noteKey: day,
    hookName: 'useWeeklyNote',
    logContext: { day },
    load: async () => {
      const note = await weeklyNotesApi.get(day);
      weekStartRef.current = note.week_start;
      return note;
    },
    save: async (body, { locked }) => {
      const weekStart = weekStartRef.current;
      if (!weekStart) throw new Error('Weekly note is not loaded');
      // A week read without a note has no updated_at to lock on: say so, so a
      // note another tab created meanwhile gives a conflict, not an overwrite.
      const request =
        locked && !body.expected_updated_at ? { ...body, expect_new: true } : body;
      const saved = await weeklyNotesApi.update(weekStart, request);
      void queryClient.invalidateQueries({ queryKey: queryKeys.weeklyNotes.lists() });
      return saved;
    },
  });
}
