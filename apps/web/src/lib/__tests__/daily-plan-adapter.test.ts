// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  applyDirectiveTaskSelection,
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
});
