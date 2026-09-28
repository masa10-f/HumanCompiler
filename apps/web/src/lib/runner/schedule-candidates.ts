// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { DailySchedule } from "@/types/api-responses";

export type ScheduleAssignment =
  DailySchedule["plan_json"]["assignments"][number];

/**
 * Keep the schedule entries that can start a work session, one per task.
 *
 * The daily plan note also places Quick Tasks (`quick_<id>`), which a work
 * session cannot reference, and may split one task into several blocks. The
 * first block of each task is kept, so pass assignments in time order.
 */
export function getStartableAssignments(
  assignments: ScheduleAssignment[] | null | undefined,
): ScheduleAssignment[] {
  const seen = new Set<string>();
  return (assignments ?? []).filter((assignment) => {
    if (assignment.task_id.startsWith("quick_") || seen.has(assignment.task_id)) {
      return false;
    }
    seen.add(assignment.task_id);
    return true;
  });
}
