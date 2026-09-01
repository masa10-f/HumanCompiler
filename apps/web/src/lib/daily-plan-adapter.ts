// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type {
  DailyPlanAvailabilityWindow,
  DailyPlanBlock,
  DailyPlanDocumentV1,
  DailyPlanScheduleDirective,
  DailyPlanTaskRef,
  DailyPlanTimedLine,
} from "@/types/daily-plan";
import type { TimeSlot } from "@/types/ai-planning";
import { normalizeDailyPlanClock } from "@/lib/daily-plan-command";

export interface DetailedDailyPlanTimeSlot extends TimeSlot {
  sourceBlockId?: string;
  sourceTitle?: string;
  sourceKind?: "event" | "break";
}

export function dailyPlanDocumentToDetailedSlots(
  document: DailyPlanDocumentV1,
): DetailedDailyPlanTimeSlot[] {
  const availability: DetailedDailyPlanTimeSlot[] =
    document.availability_windows.map((window) => ({
      start: window.start,
      end: window.end,
      kind: window.work_type,
    }));
  const events: DetailedDailyPlanTimeSlot[] = document.blocks.flatMap(
    (block) => {
      if (block.type !== "timed_line" || block.task_ref) return [];
      return [
        {
          start: block.start,
          end: block.end,
          kind: "meeting" as const,
          sourceBlockId: block.id,
          sourceTitle: block.title,
          sourceKind: block.kind ?? "event",
        },
      ];
    },
  );
  return [...availability, ...events];
}

export function detailedMeetingSlotsToDailyPlanBlocks(
  slots: DetailedDailyPlanTimeSlot[],
): DailyPlanTimedLine[] {
  return slots.flatMap((slot, index) => {
    if (slot.kind !== "meeting") return [];
    return [
      {
        id: slot.sourceBlockId ?? `detailed-event:${index}`,
        type: "timed_line" as const,
        start: slot.start,
        end: slot.end,
        title: slot.sourceTitle ?? "固定イベント",
        pinned: true,
        kind: slot.sourceKind ?? "event",
      },
    ];
  });
}

export function detailedSlotForScheduler(
  slot: DetailedDailyPlanTimeSlot,
): TimeSlot {
  return {
    start: slot.start,
    end: slot.end,
    kind: slot.kind,
    capacity_hours: slot.capacity_hours,
    assigned_project_id: slot.assigned_project_id,
  };
}

export function detailedSlotsToAvailabilityWindows(
  slots: DetailedDailyPlanTimeSlot[],
): DailyPlanAvailabilityWindow[] {
  const ordered = slots
    .flatMap((slot) => {
      if (slot.kind === "meeting") return [];
      const start = normalizeDailyPlanClock(slot.start);
      const end = normalizeDailyPlanClock(slot.end);
      if (!start || !end || start >= end) return [];
      return [{ start, end, work_type: slot.kind }];
    })
    .sort(
      (left, right) =>
        left.start.localeCompare(right.start) ||
        left.end.localeCompare(right.end),
    );

  const result: DailyPlanAvailabilityWindow[] = [];
  for (const window of ordered) {
    const previous = result.at(-1);
    const start =
      previous && window.start < previous.end ? previous.end : window.start;
    if (start >= window.end) continue;
    result.push({ ...window, start });
    if (result.length === 24) break;
  }
  return result;
}

export function preserveUnconvertedDailyPlanBlocks(
  blocks: DailyPlanBlock[],
  replacedBlockIds: Iterable<string>,
): DailyPlanBlock[] {
  const replaced = new Set(replacedBlockIds);
  return blocks.filter((block) => !replaced.has(block.id));
}

export function applyDirectiveTaskSelection(
  block: DailyPlanScheduleDirective,
  task?: { ref: DailyPlanTaskRef; title: string },
): DailyPlanScheduleDirective {
  if (task) {
    return {
      ...block,
      mode: "task",
      task_ref: task.ref,
      title: task.title,
      filter: undefined,
    };
  }
  return {
    ...block,
    mode: "filter",
    task_ref: undefined,
    filter: block.filter ?? {
      work_types: [],
      project_ids: [],
      goal_ids: [],
    },
  };
}
