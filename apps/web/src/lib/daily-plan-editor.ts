// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { ApiError } from '@/lib/errors';

export function extractDailyPlanMention(text: string): string | undefined {
  return text.match(/(?:^|\s)@([^()]+)/)?.[1]?.trim();
}

export function matchDailyPlanTasks<T extends { title: string }>(text: string, options: T[]): T[] {
  const mention = extractDailyPlanMention(text)?.toLocaleLowerCase();
  if (!mention) return [];
  const exact = options.filter((option) => option.title.toLocaleLowerCase() === mention);
  return exact.length ? exact : options.filter((option) => option.title.toLocaleLowerCase().includes(mention));
}

export function isPermanentDailyPlanSaveError(error: unknown): boolean {
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
