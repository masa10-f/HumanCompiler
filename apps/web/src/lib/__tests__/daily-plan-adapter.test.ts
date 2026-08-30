// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { preserveUnconvertedDailyPlanBlocks } from "../daily-plan-adapter";
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
});
