// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { DailyPlanValidationError } from '@/lib/daily-plan-validation';
import { ApiError } from '@/lib/errors';
import type { DailyPlanScheduleDirective, DailyPlanTaskRef } from '@/types/daily-plan';

export function extractDailyPlanMention(text: string): string | undefined {
  const mention = text.match(/(?:^|\s)@([^()]+)/)?.[1];
  // A trailing schedule window is a separate token, not part of the task title.
  // Keep spaces/numbers in titles and require a complete range at a token boundary.
  return mention?.split(/\s+\d{1,2}:?\d{2}\s*[-–]\s*\d{1,2}:?\d{2}(?=\s|$)/, 1)[0]?.trim() || undefined;
}

export function matchDailyPlanTasks<T extends { title: string }>(text: string, options: T[]): T[] {
  const mention = extractDailyPlanMention(text)?.toLocaleLowerCase();
  if (!mention) return [];
  const exact = options.filter((option) => option.title.toLocaleLowerCase() === mention);
  return exact.length ? exact : options.filter((option) => option.title.toLocaleLowerCase().includes(mention));
}

function normalizeDailyPlanSearch(value: string): string {
  // NFKC folds full-width letters and spaces typed with a Japanese IME.
  return value.normalize('NFKC').toLocaleLowerCase();
}

/**
 * Narrows task candidates from free text such as a fixed line's title.
 * Every word must appear in the task, goal or project title; tasks whose own
 * title matches more words (then exactly, then as a prefix) come first.
 */
export function searchDailyPlanTasks<T extends { title: string; projectTitle?: string; goalTitle?: string }>(
  options: T[],
  query: string,
): T[] {
  const normalized = normalizeDailyPlanSearch(query).replace(/(^|\s)@/g, '$1').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return options
    .flatMap((option, index) => {
      const title = normalizeDailyPlanSearch(option.title);
      const context = normalizeDailyPlanSearch(`${option.projectTitle ?? ''} ${option.goalTitle ?? ''}`);
      if (!words.every((word) => title.includes(word) || context.includes(word))) return [];
      const score = words.filter((word) => title.includes(word)).length * 4 +
        (title === normalized ? 2 : 0) + (title.startsWith(words[0]!) ? 1 : 0);
      return [{ option, index, score }];
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ option }) => option);
}

export function isPermanentDailyPlanSaveError(error: unknown): boolean {
  if (error instanceof DailyPlanValidationError) return true;
  return error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 &&
    ![408, 429].includes(error.statusCode);
}

export function missingDailyPlanBlockIds(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const data = error.context.responseData;
  if (!data || typeof data !== 'object' || !('detail' in data)) return [];
  const detail = data.detail;
  if (!detail || typeof detail !== 'object' || !('missing' in detail) || !Array.isArray(detail.missing)) return [];
  return detail.missing.flatMap((item: unknown) =>
    item && typeof item === 'object' && 'block_id' in item && typeof item.block_id === 'string'
      ? [item.block_id] : [],
  );
}

export function stripDailyPlanDuration(text: string): string {
  return text.replace(/\(\d+(?:h(?:\d+m)?|m)\)\s*$/i, '').trim();
}

export function applyDirectiveTaskSelection(
  block: DailyPlanScheduleDirective,
  task?: { ref: DailyPlanTaskRef; title: string },
): DailyPlanScheduleDirective {
  if (task) {
    return { ...block, mode: 'task', task_ref: task.ref, title: task.title, filter: undefined };
  }
  return {
    ...block,
    mode: 'filter',
    task_ref: undefined,
    filter: block.filter ?? { work_types: [], project_ids: [], goal_ids: [] },
  };
}
