// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { WorkType } from "./task";

/** schedule: a /schedule line; event: a fixed event; break: a break. */
export type WeeklyRhythmBlockKind = "schedule" | "event" | "break";

/** 0 = Monday ... 6 = Sunday, as the API (Python's date.weekday()) uses. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeeklyRhythmBlockInput {
  weekday: Weekday;
  start: string;
  end: string;
  kind: WeeklyRhythmBlockKind;
  title?: string | null;
  project_id?: string | null;
  work_type: WorkType;
  /** Kept out of future in-week rebalancing; not used by the note yet. */
  locked: boolean;
}

export interface WeeklyRhythmBlock extends WeeklyRhythmBlockInput {
  id: string;
  title: string | null;
  project_id: string | null;
}

export interface WeeklyRhythmDaySummary {
  weekday: Weekday;
  schedule_minutes: number;
  event_minutes: number;
  break_minutes: number;
}

export interface WeeklyRhythmProjectSummary {
  /** null: /schedule lines without a project (Inbox in triage). */
  project_id: string | null;
  project_title: string | null;
  project_status: string | null;
  minutes: number;
  locked_minutes: number;
}

export interface WeeklyRhythmTriageAllocation {
  effective_capacity_hours: number;
  project_allocations: Record<string, number>;
  inbox_allocation_percent: number;
}

export interface WeeklyRhythmSummary {
  days: WeeklyRhythmDaySummary[];
  projects: WeeklyRhythmProjectSummary[];
  total_schedule_minutes: number;
  triage_allocation: WeeklyRhythmTriageAllocation | null;
}

export interface WeeklyRhythm {
  blocks: WeeklyRhythmBlock[];
  summary: WeeklyRhythmSummary;
  updated_at: string | null;
}
