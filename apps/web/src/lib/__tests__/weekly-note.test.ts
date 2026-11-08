// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  addDays,
  formatShortDate,
  formatWeekRange,
  isValidDateString,
  isoWeek,
  weekDates,
  weekEndOf,
  weekStartOf,
  weekdayIndex,
  weekdayLabel,
} from "../weekly-note";

describe("weekly note week helpers", () => {
  it("starts weeks on Monday", () => {
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(weekStartOf("2026-11-05")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekEndOf("2026-11-02")).toBe("2026-11-08");
    expect(weekdayIndex("2026-11-08")).toBe(6);
    expect(weekdayLabel("2026-11-08")).toBe("日");
  });

  it("crosses months and years", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(weekDates("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("numbers weeks as ISO 8601", () => {
    expect(isoWeek("2026-11-02")).toEqual({ year: 2026, week: 45 });
    // The week of 2026-12-28 holds Thursday 2026-12-31: week 53 of 2026.
    expect(isoWeek("2026-12-28")).toEqual({ year: 2026, week: 53 });
    // The week of 2024-12-30 holds Thursday 2025-01-02: week 1 of 2025.
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
  });

  it("formats week ranges in Japanese", () => {
    expect(formatWeekRange("2026-11-02")).toBe("2026年11月2日（月）〜8日（日）");
    expect(formatWeekRange("2026-11-30")).toBe("2026年11月30日（月）〜12月6日（日）");
    expect(formatWeekRange("2026-12-28")).toBe(
      "2026年12月28日（月）〜2027年1月3日（日）",
    );
    expect(formatShortDate("2026-11-02")).toBe("11/2");
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidDateString("2026-11-02")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-11-2")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(() => weekStartOf("nope")).toThrow();
  });
});
