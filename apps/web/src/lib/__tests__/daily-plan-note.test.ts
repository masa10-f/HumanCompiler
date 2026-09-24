// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  dailyPlanToNote,
  noteToDailyPlan,
  sameSchedulingBlocks,
  schedulingBlocks,
} from "../daily-plan-note";
import type { DailyPlanDocumentV1 } from "@/types/daily-plan";

const plan: DailyPlanDocumentV1 = {
  schema_version: 1,
  blocks: [
    { id: "memo", type: "text", text: "メモ" },
    {
      id: "schedule",
      type: "schedule_directive",
      mode: "filter",
      filter: { work_types: [], project_ids: [], goal_ids: [] },
      allowed_windows: [{ start: "09:00", end: "12:00" }],
    },
  ],
};

it("preserves existing schedule identity and rich content across editor round trips", () => {
  const saved = noteToDailyPlan(dailyPlanToNote(plan));
  expect(saved.blocks[1]).toEqual(plan.blocks[1]);
  expect(saved.blocks[0]).toMatchObject({
    id: "memo",
    type: "text",
    text: "メモ",
  });
  expect(noteToDailyPlan(dailyPlanToNote(saved))).toEqual(saved);
});

it("preserves blank lines between notes but not the final cursor paragraph", () => {
  const doc = noteToDailyPlan({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "前" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "後" }] },
      { type: "paragraph" },
    ],
  });
  expect(doc.blocks).toHaveLength(3);
  expect(new Set(doc.blocks.map((block) => block.id)).size).toBe(3);
});

it("does not invalidate a schedule for memo or checklist edits, but detects time changes", () => {
  const modified: DailyPlanDocumentV1 = {
    ...plan,
    blocks: [
      ...plan.blocks,
      { type: "checklist_item", id: "done", title: "実施済み", checked: true },
      { type: "text", id: "after", text: "振り返り" },
    ],
  };
  expect(
    sameSchedulingBlocks(schedulingBlocks(plan), schedulingBlocks(modified)),
  ).toBe(true);
  const schedule = schedulingBlocks(plan)[0]!;
  expect(
    sameSchedulingBlocks(
      [schedule],
      [
        {
          ...schedule,
          work_type: "light_work",
          title: null,
        } as typeof schedule,
      ],
    ),
  ).toBe(true);
  expect(
    sameSchedulingBlocks(
      [schedule],
      [
        {
          ...schedule,
          allowed_windows: [{ start: "13:00", end: "14:00" }],
        } as typeof schedule,
      ],
    ),
  ).toBe(false);
});

it("retains completion in note data but excludes it from schedule conditions", () => {
  const fixed = { id: "fixed", type: "timed_line" as const, title: "Meeting", start: "09:00", end: "10:00" };
  const done = { ...fixed, completed: true };
  expect(sameSchedulingBlocks([fixed], [done])).toBe(true);
  expect(sameSchedulingBlocks([done], [{ ...done, end: "10:30" }])).toBe(false);
  expect(noteToDailyPlan(dailyPlanToNote({ schema_version: 1, blocks: [done] })).blocks[0]).toEqual(done);
});

it("keeps line memos in note data but excludes them from schedule conditions", () => {
  const fixed = { id: "fixed", type: "timed_line" as const, title: "Meeting", start: "09:00", end: "10:00" };
  const withMemo = { ...fixed, note: "議題を確認" };
  expect(sameSchedulingBlocks([fixed], [withMemo])).toBe(true);
  expect(sameSchedulingBlocks([withMemo], [{ ...withMemo, start: "08:30" }])).toBe(false);
  const schedule = schedulingBlocks(plan)[0]!;
  expect(sameSchedulingBlocks([schedule], [{ ...schedule, note: "午後は実装" } as typeof schedule])).toBe(true);
  expect(noteToDailyPlan(dailyPlanToNote({ schema_version: 1, blocks: [withMemo] })).blocks[0]).toEqual(withMemo);
});
