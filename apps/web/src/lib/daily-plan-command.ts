// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

export interface ParsedTimedLine {
  start: string;
  end: string;
  title: string;
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
