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
import { normalizeDailyPlanClock } from "@/lib/daily-plan-command";

export interface DetailedDailyPlanTimeSlot extends TimeSlot {
  sourceBlockId?: string;
  sourceTitle?: string;
  sourceKind?: "event" | "break";
  sourceDirective?: DailyPlanScheduleDirective;
}

export function dailyPlanDocumentToDetailedSlots(
  document: DailyPlanDocumentV1,
): DetailedDailyPlanTimeSlot[] {
  const availability: DetailedDailyPlanTimeSlot[] = document.blocks.flatMap((block) =>
    block.type === "schedule_directive" ? (block.allowed_windows ?? []).map((window) => ({
      start: window.start, end: window.end, kind: block.work_type ?? "light_work",
      sourceBlockId: block.id, sourceDirective: block,
    })) : [],
  );
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

export function detailedWorkSlotsToDirectives(slots: DetailedDailyPlanTimeSlot[]): DailyPlanScheduleDirective[] {
  const directives = new Map<string, DailyPlanScheduleDirective>();
  for (const slot of slots) {
    if (slot.kind === "meeting") continue;
    const start = normalizeDailyPlanClock(slot.start);
    const end = normalizeDailyPlanClock(slot.end);
    if (!start || !end || start >= end) throw new Error("各スロットの開始・終了時刻を確認してください");
    const id = slot.sourceBlockId ?? `detailed-schedule:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const existing = directives.get(id);
    if (existing) {
      existing.allowed_windows!.push({ start, end });
    } else {
      directives.set(id, {
        ...(slot.sourceDirective ?? { type: "schedule_directive", mode: "filter" }),
        id, work_type: slot.kind, allowed_windows: [{ start, end }],
      });
    }
  }
  return [...directives.values()];
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
