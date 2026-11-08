// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { weeklyNotesApi } from '@/lib/api';
import { useNoteDocument, type UseNoteDocumentReturn } from './use-note-document';
import type { WeeklyNote } from '@/types/weekly-note';

/**
 * Load and save the weekly note of the week that starts on `weekStart` (a
 * Monday), with the same debounced saves and conflict handling as context
 * notes. Remount the component (React `key`) when the week changes.
 */
export function useWeeklyNote(weekStart: string): UseNoteDocumentReturn<WeeklyNote> {
  return useNoteDocument<WeeklyNote>({
    noteKey: weekStart,
    hookName: 'useWeeklyNote',
    logContext: { weekStart },
    load: () => weeklyNotesApi.get(weekStart),
    save: (body) => weeklyNotesApi.update(weekStart, body),
  });
}
