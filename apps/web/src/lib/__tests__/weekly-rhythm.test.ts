// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  formatRhythmHours,
  hasTimedBlocks,
  insertRhythmBlocks,
  rhythmBlocksForWeekday,
  rhythmToPlanBlocks,
  rhythmValidationError,
  weekdayOfDate,
} from "../weekly-rhythm";
import type { WeeklyRhythmBlock } from "@/types/weekly-rhythm";

function block(overrides: Partial<WeeklyRhythmBlock>): WeeklyRhythmBlock {
  return {
    id: "block",
    weekday: 0,
    start: "09:00",
    end: "12:00",
    kind: "schedule",
    title: null,
    project_id: null,
    work_type: "focused_work",
    locked: false,
    ...overrides,
  };
}

describe("weekly rhythm helpers", () => {
  it("maps note dates to Monday-based weekdays", () => {
    expect(weekdayOfDate("2026-11-08")).toBe(6); // Sunday
    expect(weekdayOfDate("2026-11-09")).toBe(0); // Monday
    expect(weekdayOfDate("2026-11-14")).toBe(5); // Saturday
  });

  it("selects one weekday in time order", () => {
    const blocks = [
      block({ id: "late", start: "13:00", end: "14:00" }),
      block({ id: "other", weekday: 1 }),
      block({ id: "early", start: "07:00", end: "08:00" }),
    ];

    expect(rhythmBlocksForWeekday(blocks, 0).map((item) => item.id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("turns template blocks into /schedule lines, events and breaks", () => {
    const lines = rhythmToPlanBlocks(
      [
        block({ project_id: "phd", title: "実験", work_type: "focused_work" }),
        block({ project_id: "side", start: "16:00", end: "18:00", work_type: "light_work" }),
        block({ start: "18:00", end: "19:00", work_type: "study" }),
        block({ kind: "break", title: "昼食", start: "12:00", end: "13:00" }),
        block({ kind: "event", title: "定例", start: "10:00", end: "10:30" }),
      ],
      [
        { id: "phd", title: "PhD" },
        { id: "side", title: "副業" },
      ],
    );

    expect(lines[0]).toMatchObject({
      type: "schedule_directive",
      mode: "filter",
      title: "実験（PhD）",
      work_type: "focused_work",
      filter: { work_types: [], project_ids: ["phd"], goal_ids: [] },
      allowed_windows: [{ start: "09:00", end: "12:00" }],
    });
    expect(lines[1]).toMatchObject({ title: "副業", work_type: "light_work" });
    // Without a project the line picks tasks by work type, like /schedule's "auto".
    expect(lines[2]).toMatchObject({
      filter: { work_types: ["study"], project_ids: [], goal_ids: [] },
    });
    expect(lines[2]).not.toHaveProperty("title");
    expect(lines[3]).toMatchObject({
      type: "timed_line",
      kind: "break",
      title: "昼食",
      start: "12:00",
      end: "13:00",
      pinned: true,
    });
    expect(lines[4]).toMatchObject({ type: "timed_line", kind: "event", title: "定例" });
    expect(new Set(lines.map((line) => line.id)).size).toBe(5);
  });

  it("appends after the memo and drops trailing blank lines", () => {
    const document = {
      schema_version: 1 as const,
      blocks: [
        { id: "memo", type: "text" as const, text: "今日の目標" },
        { id: "blank", type: "text" as const, text: "  " },
      ],
    };
    const [line] = rhythmToPlanBlocks([block({})], []);

    const next = insertRhythmBlocks(document, [line!]);

    expect(next.blocks.map((item) => item.id)).toEqual(["memo", line!.id]);
    expect(hasTimedBlocks(document)).toBe(false);
    expect(hasTimedBlocks(next)).toBe(true);
  });

  it("keeps textless rich blocks such as a horizontal rule", () => {
    const document = {
      schema_version: 1 as const,
      blocks: [
        { id: "memo", type: "text" as const, text: "メモ" },
        { id: "rule", type: "text" as const, text: "", content: { type: "horizontalRule" } },
        { id: "empty", type: "text" as const, text: "", content: { type: "paragraph" } },
      ],
    };
    const [line] = rhythmToPlanBlocks([block({})], []);

    const next = insertRhythmBlocks(document, [line!]);

    expect(next.blocks.map((item) => item.id)).toEqual(["memo", "rule", line!.id]);
  });

  it("formats hours without trailing zeros", () => {
    expect(formatRhythmHours(630)).toBe("10.5h");
    expect(formatRhythmHours(480)).toBe("8h");
    expect(formatRhythmHours(0)).toBe("0h");
  });

  it("reports the same problems as the API", () => {
    expect(rhythmValidationError([block({}), block({ start: "12:00", end: "13:00" })])).toBeNull();
    expect(rhythmValidationError([block({ start: "12:00", end: "09:00" })])).toBe(
      "月曜の枠 12:00-09:00 は開始を終了より前にしてください",
    );
    expect(rhythmValidationError([block({ kind: "event", title: " " })])).toBe(
      "月曜の固定予定 09:00-12:00 に名前を入力してください",
    );
    expect(
      rhythmValidationError([
        block({ weekday: 1 }),
        block({ weekday: 1, start: "11:00", end: "13:00" }),
      ]),
    ).toBe("火曜の予定枠 09:00-12:00 と 11:00-13:00 が重なっています");
    // Breaks may sit inside a /schedule line.
    expect(
      rhythmValidationError([
        block({}),
        block({ kind: "break", title: "休憩", start: "10:00", end: "10:15" }),
      ]),
    ).toBeNull();
    expect(rhythmValidationError([block({ start: "" })])).toBe(
      "月曜の枠に開始・終了時刻を入力してください",
    );
  });
});
