// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * Week arithmetic on `YYYY-MM-DD` strings for weekly notes.
 *
 * A week runs Monday to Sunday (ISO 8601), as the API's weekly notes and the
 * weekly rhythm's weekday 0 = Monday. All math is done on UTC calendar dates,
 * so the browser's time zone never shifts a day.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function parse(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject dates that roll over, such as 2026-02-30.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function format(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseOrThrow(value: string): Date {
  const date = parse(value);
  if (!date) throw new Error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  return date;
}

export function isValidDateString(value: string): boolean {
  return parse(value) !== null;
}

/** 0 = Monday ... 6 = Sunday, as the API's `date.weekday()`. */
export function weekdayIndex(value: string): number {
  return (parseOrThrow(value).getUTCDay() + 6) % 7;
}

export function addDays(value: string, days: number): string {
  return format(new Date(parseOrThrow(value).getTime() + days * DAY_MS));
}

/** The Monday of the week that contains `value`. */
export function weekStartOf(value: string): string {
  return addDays(value, -weekdayIndex(value));
}

/** The Sunday of the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

/** The seven dates of the week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function weekdayLabel(value: string): string {
  return WEEKDAY_LABELS[weekdayIndex(value)] ?? '';
}

/** ISO 8601 week number and its year (the year of the week's Thursday). */
export function isoWeek(weekStart: string): { year: number; week: number } {
  const thursday = parseOrThrow(addDays(weekStartOf(weekStart), 3));
  const year = thursday.getUTCFullYear();
  const firstDay = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - firstDay) / DAY_MS / 7) + 1;
  return { year, week };
}

/** For example `2026年11月2日（月）〜8日（日）` or across months and years. */
export function formatWeekRange(weekStart: string): string {
  const start = parseOrThrow(weekStart);
  const end = parseOrThrow(weekEndOf(weekStart));
  const startText = `${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月${start.getUTCDate()}日（月）`;
  let endText: string;
  if (end.getUTCFullYear() !== start.getUTCFullYear()) {
    endText = `${end.getUTCFullYear()}年${end.getUTCMonth() + 1}月${end.getUTCDate()}日（日）`;
  } else if (end.getUTCMonth() !== start.getUTCMonth()) {
    endText = `${end.getUTCMonth() + 1}月${end.getUTCDate()}日（日）`;
  } else {
    endText = `${end.getUTCDate()}日（日）`;
  }
  return `${startText}〜${endText}`;
}

/** `M/D` for a date in a list. */
export function formatShortDate(value: string): string {
  const date = parseOrThrow(value);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
