// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  applyDirectiveTaskSelection,
  dailyPlanDocumentToDetailedSlots,
  detailedMeetingSlotsToDailyPlanBlocks,
  preserveUnconvertedDailyPlanBlocks,
} from "../daily-plan-adapter";
import type { DailyPlanBlock } from "@/types/daily-plan";

describe("daily plan detail adapter", () => {
  it("replaces converted timed lines instead of duplicating them", () => {
    const blocks: DailyPlanBlock[] = [
      {
        id: "original-task-line",
        type: "timed_line",
        start: "11:00",
        end: "12:00",
        title: "Read paper",
        task_ref: { source: "task", id: "task-1" },
      },
      {
        id: "outside-detail-slots",
        type: "timed_line",
        start: "19:00",
        end: "20:00",
        title: "Evening task",
        task_ref: { source: "task", id: "task-2" },
      },
      { id: "note", type: "text", text: "Keep this note" },
      {
        id: "detailed-fixed:stale",
        type: "timed_line",
        start: "09:00",
        end: "10:00",
        title: "Stale adapter row",
      },
    ];

    expect(
      preserveUnconvertedDailyPlanBlocks(blocks, ["original-task-line"]),
    ).toEqual([blocks[1], blocks[2]]);
  });

  it("preserves a converted row when detailed mode cannot re-emit it", () => {
    const blocks: DailyPlanBlock[] = [
      {
        id: "resolved-line",
        type: "timed_line",
        start: "09:00",
        end: "10:00",
        title: "Resolved",
        task_ref: { source: "task", id: "task-1" },
      },
      {
        id: "missing-task-line",
        type: "timed_line",
        start: "10:00",
        end: "11:00",
        title: "Missing from detailed task pool",
        task_ref: { source: "task", id: "task-2" },
      },
    ];

    expect(
      preserveUnconvertedDailyPlanBlocks(blocks, ["resolved-line"]),
    ).toEqual([blocks[1]]);
  });

  it("does not restore a converted row explicitly removed in detailed mode", () => {
    const removed: DailyPlanBlock = {
      id: "removed-task-line",
      type: "timed_line",
      start: "09:00",
      end: "10:00",
      title: "Removed",
      task_ref: { source: "task", id: "task-1" },
    };

    expect(preserveUnconvertedDailyPlanBlocks([removed], [removed.id])).toEqual(
      [],
    );
  });

  it("falls back to a valid filter directive when task selection is cleared", () => {
    const directive = {
      id: "directive",
      type: "schedule_directive" as const,
      mode: "task" as const,
      task_ref: { source: "task" as const, id: "task-1" },
      title: "Task",
    };

    expect(applyDirectiveTaskSelection(directive)).toEqual({
      ...directive,
      mode: "filter",
      task_ref: undefined,
      filter: { work_types: [], project_ids: [], goal_ids: [] },
    });
  });

  it("round-trips fixed events and breaks through detailed meeting slots", () => {
    const document = {
      schema_version: 1 as const,
      availability_windows: [
        { start: "09:00", end: "12:00", work_type: "focused_work" as const },
      ],
      blocks: [
        {
          id: "meeting",
          type: "timed_line" as const,
          start: "10:00",
          end: "10:30",
          title: "Standup",
          kind: "event" as const,
          pinned: true,
        },
        {
          id: "lunch",
          type: "timed_line" as const,
          start: "12:00",
          end: "13:00",
          title: "昼休み",
          kind: "break" as const,
          pinned: true,
        },
      ],
    };

    const slots = dailyPlanDocumentToDetailedSlots(document);
    const eventBlocks = detailedMeetingSlotsToDailyPlanBlocks(slots);

    expect(slots.filter((slot) => slot.kind === "meeting")).toHaveLength(2);
    expect(eventBlocks).toEqual(document.blocks);
  });
});
