// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

export interface ParsedTimedLine {
  start: string;
  end: string;
  title: string;
}

export interface ParsedScheduleDirective {
  durationMinutes?: number;
  allowedWindow?: DailyPlanTimeRange;
}

export interface DailyPlanTimeRange {
  start: string;
  end: string;
}

export function parseDurationMinutes(text: string): number | undefined {
  const match = text.match(/\((?:(\d+)h)?(?:(\d+)m)?\)/i);
  if (!match || (!match[1] && !match[2])) return undefined;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

export function normalizeDailyPlanClock(value: string): string | null {
  const normalized = value.replace(":", "");
  if (!/^\d{3,4}$/.test(normalized)) return null;
  const padded = normalized.padStart(4, "0");
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

export function updateDailyPlanTimeRange(
  range: DailyPlanTimeRange,
  field: keyof DailyPlanTimeRange,
  value: string,
): DailyPlanTimeRange | null {
  const normalized = normalizeDailyPlanClock(value);
  if (!normalized) return null;
  const next = { ...range, [field]: normalized };
  return next.start < next.end ? next : null;
}

export function dailyPlanTimeRangesOverlap(
  ranges: DailyPlanTimeRange[],
): boolean {
  const ordered = [...ranges].sort((left, right) =>
    left.start.localeCompare(right.start),
  );
  return ordered.some(
    (range, index) => index > 0 && range.start < ordered[index - 1]!.end,
  );
}

export function addDailyPlanClockMinutes(
  value: string,
  minutes: number,
): string | null {
  const normalized = normalizeDailyPlanClock(value);
  if (!normalized) return null;
  const [hour = 0, minute = 0] = normalized.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  if (total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

export function parseTimedLine(text: string): ParsedTimedLine | null {
  const match = text.match(
    /^(\d{1,2}:?\d{2})\s*[-–]\s*(\d{1,2}:?\d{2})\s+(.+)$/,
  );
  if (!match) return null;
  const [, rawStart = "", rawEnd = "", title = ""] = match;
  const start = normalizeDailyPlanClock(rawStart);
  const end = normalizeDailyPlanClock(rawEnd);
  if (!start || !end || start >= end || !title.trim()) return null;
  return { start, end, title: title.trim() };
}

export function parseScheduleDirective(
  text: string,
): ParsedScheduleDirective | null {
  if (!text.trim().startsWith("/schedule")) return null;
  const range = text.match(/(\d{1,2}:?\d{2})\s*[-–]\s*(\d{1,2}:?\d{2})/);
  const start = range ? normalizeDailyPlanClock(range[1] ?? "") : null;
  const end = range ? normalizeDailyPlanClock(range[2] ?? "") : null;
  return {
    durationMinutes: parseDurationMinutes(text),
    allowedWindow: start && end && start < end ? { start, end } : undefined,
  };
}

export function parseBreakLine(text: string): ParsedTimedLine | null {
  const match = text
    .trim()
    .match(
      /^\/break\s+(\d{1,2}:?\d{2})\s*[-–]\s*(\d{1,2}:?\d{2})(?:\s+(.+))?$/,
    );
  if (!match) return null;
  const start = normalizeDailyPlanClock(match[1] ?? "");
  const end = normalizeDailyPlanClock(match[2] ?? "");
  if (!start || !end || start >= end) return null;
  return { start, end, title: match[3]?.trim() || "休憩" };
}
