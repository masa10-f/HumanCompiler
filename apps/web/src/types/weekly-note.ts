// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { WeekStartDay } from '@/lib/weekly-note';

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

/** The first day of the user's new weeks. */
export interface WeeklyNotePreferences {
  week_start_day: WeekStartDay;
}
