// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  addDays,
  formatShortDate,
  formatWeekRange,
  isValidDateString,
  relativeWeekLabel,
  weekDates,
  weekEndOf,
  weekStartOf,
  weekdayLabel,
} from "../weekly-note";

describe("weekly note week helpers", () => {
  it.each([
    // day, Sunday start, Monday start
    ["2026-11-01", "2026-11-01", "2026-10-26"], // Sunday
    ["2026-11-02", "2026-11-01", "2026-11-02"], // Monday
    ["2026-11-07", "2026-11-01", "2026-11-02"], // Saturday
    ["2027-01-01", "2026-12-27", "2026-12-28"],
  ])("finds the first day of the week of %s", (day, sunday, monday) => {
    expect(weekStartOf(day, "sunday")).toBe(sunday);
    expect(weekStartOf(day, "monday")).toBe(monday);
  });

  it("lists the seven days from the first day", () => {
    expect(weekEndOf("2026-11-01")).toBe("2026-11-07");
    expect(weekDates("2026-12-27")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(weekdayLabel("2026-11-01")).toBe("日");
    expect(weekdayLabel("2026-11-02")).toBe("月");
  });

  it("formats ranges with each day's own weekday", () => {
    expect(formatWeekRange("2026-11-01")).toBe("2026年11月1日（日）〜7日（土）");
    expect(formatWeekRange("2026-11-02")).toBe("2026年11月2日（月）〜8日（日）");
    expect(formatWeekRange("2026-11-29")).toBe("2026年11月29日（日）〜12月5日（土）");
    expect(formatWeekRange("2026-12-28")).toBe(
      "2026年12月28日（月）〜2027年1月3日（日）",
    );
    expect(formatShortDate("2026-11-02")).toBe("11/2");
  });

  it("labels weeks relative to today", () => {
    const today = "2026-11-04";
    expect(relativeWeekLabel("2026-11-01", today)).toBe("今週");
    expect(relativeWeekLabel("2026-10-29", today)).toBe("今週"); // ends 11-04
    expect(relativeWeekLabel("2026-11-04", today)).toBe("今週");
    expect(relativeWeekLabel("2026-11-05", today)).toBe("来週");
    expect(relativeWeekLabel("2026-11-08", today)).toBe("来週");
    expect(relativeWeekLabel("2026-11-15", today)).toBe("2週後");
    expect(relativeWeekLabel("2026-10-25", today)).toBe("先週");
    expect(relativeWeekLabel("2026-10-18", today)).toBe("2週前");
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidDateString("2026-11-02")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-11-2")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(() => weekStartOf("nope", "sunday")).toThrow();
  });
});
