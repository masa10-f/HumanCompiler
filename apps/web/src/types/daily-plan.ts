// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { TaskStatus, WorkType } from "./task";

export interface DailyPlanTaskRef {
  source: "task" | "quick_task";
  id: string;
}

export interface DailyPlanAvailabilityWindow {
  start: string;
  end: string;
  work_type: WorkType;
}

export interface DailyPlanTimedLine {
  id: string;
  type: "timed_line";
  start: string;
  end: string;
  title: string;
  task_ref?: DailyPlanTaskRef | null;
  pinned?: boolean;
  kind?: "event" | "break";
}

export interface DailyPlanDirectiveWindow {
  start: string;
  end: string;
}

export interface DailyPlanDirectiveFilter {
  work_types: WorkType[];
  project_ids: string[];
  goal_ids: string[];
}

export interface DailyPlanScheduleDirective {
  id: string;
  type: "schedule_directive";
  mode: "task" | "filter";
  title?: string | null;
  task_ref?: DailyPlanTaskRef | null;
  filter?: DailyPlanDirectiveFilter | null;
  duration_override_minutes?: number | null;
  allowed_windows?: DailyPlanDirectiveWindow[];
}

export interface DailyPlanChecklistItem {
  id: string;
  type: "checklist_item";
  title: string;
  checked: boolean;
  task_ref?: DailyPlanTaskRef | null;
  duration_override_minutes?: number | null;
}

export interface DailyPlanTextBlock {
  id: string;
  type: "text";
  text: string;
}

export type DailyPlanBlock =
  | DailyPlanTimedLine
  | DailyPlanScheduleDirective
  | DailyPlanChecklistItem
  | DailyPlanTextBlock;

export interface DailyPlanDocumentV1 {
  schema_version: 1;
  availability_windows: DailyPlanAvailabilityWindow[];
  blocks: DailyPlanBlock[];
}

export interface DailyPlanAssignment {
  task_id: string;
  task_title: string;
  goal_id: string;
  project_id: string;
  slot_index: number;
  start_time: string;
  duration_hours: number;
  slot_start: string;
  slot_end: string;
  slot_kind: WorkType;
  is_fixed: boolean;
  directive_id?: string | null;
  source?: "task" | "quick_task";
}

export interface DailyPlanDirectiveDiagnostic {
  directive_id: string;
  eligible_count: number;
  generated_count: number;
  generated_minutes?: number;
  reason?: string | null;
}

export interface DailyPlanSchedule {
  success: boolean;
  assignments: DailyPlanAssignment[];
  total_scheduled_hours: number;
  optimization_status: string;
  generated_at: string;
  source?: string;
  source_document_revision?: number;
  directive_diagnostics?: DailyPlanDirectiveDiagnostic[];
  unused_minutes?: number;
  unscheduled_tasks?: Array<{
    task_id: string;
    title: string;
    reason: string;
  }>;
}

export interface DailyPlanResponse {
  id?: string | null;
  date: string;
  revision: number;
  document: DailyPlanDocumentV1;
  schedule?: DailyPlanSchedule | null;
  updated_at?: string | null;
}

export interface DailyPlanTaskActionRequest {
  task_ref: DailyPlanTaskRef;
  action: "continue" | "complete";
  actual_minutes?: number;
}

export interface DailyPlanTaskActionResponse {
  task_ref: DailyPlanTaskRef;
  status: TaskStatus;
  actual_minutes?: number | null;
}
