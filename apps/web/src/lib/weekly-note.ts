// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * Week arithmetic on `YYYY-MM-DD` strings for weekly notes.
 *
 * A week is seven days from its first day. Each user chooses Sunday or Monday
 * as the first day of new weeks; a saved note keeps the days it was written
 * for, so a note's range always comes from its own `week_start`. All math is
 * done on UTC calendar dates, so the browser's time zone never shifts a day.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Indexed by Date.getUTCDay(): 0 = Sunday.
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
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

export type WeekStartDay = 'sunday' | 'monday';

export const WEEK_START_DAY_LABELS: Record<WeekStartDay, string> = {
  sunday: '日曜日',
  monday: '月曜日',
};

export function addDays(value: string, days: number): string {
  return format(new Date(parseOrThrow(value).getTime() + days * DAY_MS));
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseOrThrow(to).getTime() - parseOrThrow(from).getTime()) / DAY_MS);
}

/** The first day of the week that contains `value`. */
export function weekStartOf(value: string, startDay: WeekStartDay): string {
  const day = parseOrThrow(value).getUTCDay();
  const offset = startDay === 'monday' ? (day + 6) % 7 : day;
  return addDays(value, -offset);
}

/** The last day of the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

/** The seven dates of the week, from its first day. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function weekdayLabel(value: string): string {
  return WEEKDAY_LABELS[parseOrThrow(value).getUTCDay()] ?? '';
}

function formatDay(date: Date, withYear: boolean, withMonth: boolean): string {
  const year = withYear ? `${date.getUTCFullYear()}年` : '';
  const month = withMonth ? `${date.getUTCMonth() + 1}月` : '';
  const weekday = WEEKDAY_LABELS[date.getUTCDay()];
  return `${year}${month}${date.getUTCDate()}日（${weekday}）`;
}

/** For example `2026年11月1日（日）〜7日（土）`, or across months and years. */
export function formatWeekRange(weekStart: string): string {
  const start = parseOrThrow(weekStart);
  const end = parseOrThrow(weekEndOf(weekStart));
  const newYear = end.getUTCFullYear() !== start.getUTCFullYear();
  const newMonth = newYear || end.getUTCMonth() !== start.getUTCMonth();
  return `${formatDay(start, true, true)}〜${formatDay(end, newYear, newMonth)}`;
}

/** 今週, 先週, 来週, or N週前 / N週後 for the week starting on `weekStart`. */
export function relativeWeekLabel(weekStart: string, today: string): string {
  const fromToday = daysBetween(today, weekStart);
  if (fromToday <= 0 && fromToday > -7) return '今週';
  const weeks =
    fromToday > 0 ? Math.ceil(fromToday / 7) : -Math.ceil(-(fromToday + 6) / 7);
  if (weeks === 1) return '来週';
  if (weeks === -1) return '先週';
  return weeks > 0 ? `${weeks}週後` : `${-weeks}週前`;
}

/** `M/D` for a date in a list. */
export function formatShortDate(value: string): string {
  const date = parseOrThrow(value);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
