// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * A week's free-form note. A week runs Monday to Sunday (ISO 8601) and is
 * addressed by its Monday. `id` and the timestamps are null until the first
 * save.
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
  /** Only weeks that start before this Monday (the previous page's cursor). */
  before?: string;
  limit?: number;
}

export interface WeeklyNoteListResponse {
  items: WeeklyNoteSummary[];
  next_cursor: string | null;
}
