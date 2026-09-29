// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Types for exporting project/goal context as Markdown for AI assistants.
 */

export type ContextExportScope = 'project' | 'goal';

export interface ContextExportOptions {
  /** Include completed and cancelled tasks (and goals, for project exports). */
  includeCompleted: boolean;
  includeWorkSessions: boolean;
  includeDailyPlans: boolean;
  /** Limit work sessions and daily plan entries to the last N days; null for all. */
  periodDays: number | null;
}

export interface ContextExportResponse {
  filename: string;
  markdown: string;
  generated_at: string;
}

export const DEFAULT_CONTEXT_EXPORT_OPTIONS: ContextExportOptions = {
  includeCompleted: true,
  includeWorkSessions: true,
  includeDailyPlans: true,
  periodDays: null,
};
