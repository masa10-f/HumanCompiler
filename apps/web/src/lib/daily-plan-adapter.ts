// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type {
  DailyPlanBlock,
  DailyPlanDocumentV1,
  DailyPlanScheduleDirective,
  DailyPlanTaskRef,
  DailyPlanTimedLine,
} from "@/types/daily-plan";
import type { TimeSlot } from "@/types/ai-planning";

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

export function preserveUnconvertedDailyPlanBlocks(
  blocks: DailyPlanBlock[],
  replacedBlockIds: Iterable<string>,
): DailyPlanBlock[] {
  const replaced = new Set(replacedBlockIds);
  return blocks.filter(
    (block) =>
      !replaced.has(block.id) &&
      !block.id.startsWith("detailed-fixed:") &&
      !block.id.startsWith("detailed-event:"),
  );
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
