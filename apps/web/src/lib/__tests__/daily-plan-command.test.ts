// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  addDailyPlanClockMinutes,
  dailyPlanTimeRangesOverlap,
  normalizeDailyPlanClock,
  parseBreakLine,
  parseDurationMinutes,
  parseScheduleDirective,
  parseTimedLine,
  updateDailyPlanTimeRange,
} from "../daily-plan-command";

describe("daily plan command parser", () => {
  it("parses compact and colon-delimited timed lines", () => {
    expect(parseTimedLine("1100-1200 論文読み")).toEqual({
      start: "11:00",
      end: "12:00",
      title: "論文読み",
    });
    expect(parseTimedLine("13:00–14:30 図を直す")).toEqual({
      start: "13:00",
      end: "14:30",
      title: "図を直す",
    });
  });

  it("rejects invalid and reversed time ranges", () => {
    expect(normalizeDailyPlanClock("2500")).toBeNull();
    expect(parseTimedLine("1200-1100 invalid")).toBeNull();
  });

  it("keeps incomplete and reversed time edits out of saved ranges", () => {
    const range = { start: "09:00", end: "18:00" };
    expect(updateDailyPlanTimeRange(range, "start", "")).toBeNull();
    expect(updateDailyPlanTimeRange(range, "start", "18:00")).toBeNull();
    expect(updateDailyPlanTimeRange(range, "end", "08:00")).toBeNull();
    expect(updateDailyPlanTimeRange(range, "start", "10:30")).toEqual({
      start: "10:30",
      end: "18:00",
    });
  });

  it("detects overlapping work availability and advances clocks", () => {
    expect(
      dailyPlanTimeRangesOverlap([
        { start: "09:00", end: "12:00" },
        { start: "11:30", end: "13:00" },
      ]),
    ).toBe(true);
    expect(
      dailyPlanTimeRangesOverlap([
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "18:00" },
      ]),
    ).toBe(false);
    expect(addDailyPlanClockMinutes("18:00", 60)).toBe("19:00");
  });

  it("parses per-day duration overrides", () => {
    expect(parseDurationMinutes("/schedule @paper (1h30m)")).toBe(90);
    expect(parseDurationMinutes("/schedule project:A")).toBeUndefined();
  });

  it("parses schedule allocation and allowed time window", () => {
    expect(parseScheduleDirective("/schedule 13:00-17:00 @paper (2h)")).toEqual(
      {
        durationMinutes: 120,
        allowedWindow: { start: "13:00", end: "17:00" },
      },
    );
  });

  it("parses first-class break lines", () => {
    expect(parseBreakLine("/break 1200-1300 昼休み")).toEqual({
      start: "12:00",
      end: "13:00",
      title: "昼休み",
    });
    expect(parseBreakLine("/break 15:00-15:15")).toEqual({
      start: "15:00",
      end: "15:15",
      title: "休憩",
    });
  });
});
