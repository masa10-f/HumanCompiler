// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { WeekStartDay } from '@/lib/weekly-note';
import type { ContextNoteUpdate } from '@/types/context-note';

/**
 * A week's free-form note: seven days from `week_start`. `id` and the
 * timestamps are null until the first save.
 */
export interface WeeklyNote {
  id: string | null;
  week_start: string;
  week_end: string;
  content: string;
  content_type: 'html' | 'markdown';
  created_at: string | null;
  updated_at: string | null;
}

export interface WeeklyNoteSummary {
  week_start: string;
  week_end: string;
  updated_at: string;
  preview: string;
}

export interface WeeklyNoteListQuery {
  /** Only weeks that start before this date (the previous page's cursor). */
  before?: string;
  limit?: number;
}

export interface WeeklyNoteListResponse {
  items: WeeklyNoteSummary[];
  next_cursor: string | null;
}

/** The weekday the user's new weeks start on (`/api/user/settings/week-start`). */
export interface WeekStartSettings {
  week_start_day: WeekStartDay;
}

/**
 * A save. `expect_new` says the editor read the week without a note: the
 * server answers 409 if one was created meanwhile (another tab), instead of
 * overwriting it.
 */
export type WeeklyNoteUpdate = ContextNoteUpdate & { expect_new?: boolean };
