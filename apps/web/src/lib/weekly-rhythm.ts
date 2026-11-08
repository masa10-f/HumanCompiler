// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { createDailyPlanId } from "@/lib/daily-plan-id";
import type { DailyPlanBlock, DailyPlanDocumentV1 } from "@/types/daily-plan";
import type {
  Weekday,
  WeeklyRhythmBlock,
  WeeklyRhythmBlockInput,
} from "@/types/weekly-rhythm";

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "月曜",
  1: "火曜",
  2: "水曜",
  3: "木曜",
  4: "金曜",
  5: "土曜",
  6: "日曜",
};

/** The week is shown from Sunday, the day that prepares the next week. */
export const WEEKDAY_DISPLAY_ORDER: Weekday[] = [6, 0, 1, 2, 3, 4, 5];

export const RHYTHM_KIND_LABELS = {
  schedule: "予定枠",
  event: "固定予定",
  break: "休憩",
} as const;

/** Weekday of a YYYY-MM-DD note date, independent of the browser time zone. */
export function weekdayOfDate(date: string): Weekday {
  const [year, month, day] = date.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return ((jsDay + 6) % 7) as Weekday;
}

export function rhythmBlocksForWeekday<T extends WeeklyRhythmBlockInput>(
  blocks: T[],
  weekday: Weekday,
): T[] {
  return blocks
    .filter((block) => block.weekday === weekday)
    .sort(
      (left, right) =>
        left.start.localeCompare(right.start) ||
        left.end.localeCompare(right.end),
    );
}

/** Converts template blocks into note lines, with fresh line IDs. */
export function rhythmToPlanBlocks(
  blocks: WeeklyRhythmBlock[],
  projects: Array<{ id: string; title: string }>,
): DailyPlanBlock[] {
  const projectTitle = (id: string | null) =>
    projects.find((project) => project.id === id)?.title;
  return blocks.map((block): DailyPlanBlock => {
    if (block.kind !== "schedule") {
      return {
        id: createDailyPlanId(),
        type: "timed_line",
        start: block.start,
        end: block.end,
        title: block.title ?? RHYTHM_KIND_LABELS[block.kind],
        kind: block.kind,
        pinned: true,
      };
    }
    const project = block.project_id ? projectTitle(block.project_id) : undefined;
    const title =
      block.title && project
        ? `${block.title}（${project}）`
        : (block.title ?? project);
    // Same shape as choosing a project (or "auto") in the /schedule menu.
    return {
      id: createDailyPlanId(),
      type: "schedule_directive",
      mode: "filter",
      work_type: block.work_type,
      ...(title ? { title } : {}),
      filter: {
        work_types: block.project_id ? [] : [block.work_type],
        project_ids: block.project_id ? [block.project_id] : [],
        goal_ids: [],
      },
      allowed_windows: [{ start: block.start, end: block.end }],
    };
  });
}

/** True once the note has any time-bound line (a fixed event, break or /schedule). */
export function hasTimedBlocks(document: DailyPlanDocumentV1): boolean {
  return document.blocks.some(
    (block) =>
      block.type === "timed_line" || block.type === "schedule_directive",
  );
}

/**
 * Only a genuinely empty paragraph is a blank line. Rich blocks such as a
 * horizontal rule also have no text, but they are content and must be kept.
 */
function isEmptyText(block: DailyPlanBlock): boolean {
  if (block.type !== "text" || block.text.trim()) return false;
  return (
    !block.content ||
    (block.content.type === "paragraph" && !block.content.content?.length)
  );
}

/** Appends template lines after the note's memo, dropping trailing blank lines. */
export function insertRhythmBlocks(
  document: DailyPlanDocumentV1,
  planBlocks: DailyPlanBlock[],
): DailyPlanDocumentV1 {
  const kept = [...document.blocks];
  while (kept.length && isEmptyText(kept.at(-1)!)) kept.pop();
  return { ...document, blocks: [...kept, ...planBlocks] };
}

export function formatRhythmHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours}h`;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * Mirrors the API's checks so the editor can point at the problem before saving.
 * Returns null when the template can be saved.
 */
export function rhythmValidationError(
  blocks: WeeklyRhythmBlockInput[],
): string | null {
  if (blocks.length > 200) return "週のリズムの枠は200件までです";
  for (const block of blocks) {
    const label = WEEKDAY_LABELS[block.weekday];
    if (!/^\d{2}:\d{2}$/.test(block.start) || !/^\d{2}:\d{2}$/.test(block.end))
      return `${label}の枠に開始・終了時刻を入力してください`;
    if (toMinutes(block.start) >= toMinutes(block.end))
      return `${label}の枠 ${block.start}-${block.end} は開始を終了より前にしてください`;
    if (block.kind !== "schedule" && !block.title?.trim())
      return `${label}の${RHYTHM_KIND_LABELS[block.kind]} ${block.start}-${block.end} に名前を入力してください`;
    if ((block.title?.trim().length ?? 0) > 200)
      return `${label}の枠の名前は200文字以内にしてください`;
  }
  for (const weekday of WEEKDAY_DISPLAY_ORDER) {
    const dayBlocks = rhythmBlocksForWeekday(blocks, weekday);
    if (dayBlocks.length > 48)
      return `${WEEKDAY_LABELS[weekday]}の枠は48件までです`;
    const schedules = dayBlocks.filter((block) => block.kind === "schedule");
    for (let index = 1; index < schedules.length; index += 1) {
      const previous = schedules[index - 1]!;
      const current = schedules[index]!;
      if (current.start < previous.end)
        return `${WEEKDAY_LABELS[weekday]}の予定枠 ${previous.start}-${previous.end} と ${current.start}-${current.end} が重なっています`;
    }
  }
  return null;
}
