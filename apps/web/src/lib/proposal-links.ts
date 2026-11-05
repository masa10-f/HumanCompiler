// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { ApiError, getErrorMessage } from './errors';
import type { Proposal } from '@/types/proposal';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Where to open what an accepted proposal created, or null when it is not
 * known (no result, or an id needed for the path is missing).
 */
export function proposalResultHref(p: Proposal): string | null {
  if (!p.result) return null;

  const payload = p.final_payload ?? p.payload;
  const projectId = asString(p.project_id);
  const resultId = asString(p.result.id);

  switch (p.result.type) {
    case 'goal':
      return projectId && resultId
        ? `/projects/${projectId}/goals/${resultId}`
        : null;
    case 'task': {
      const goalId = asString(payload.goal_id);
      return projectId && goalId && resultId
        ? `/projects/${projectId}/goals/${goalId}/tasks/${resultId}`
        : null;
    }
    case 'quick_task':
      return '/tasks';
    case 'context_note': {
      const target = asRecord(payload.target);
      if (!target) return null;

      const targetProjectId = asString(target.project_id);
      if (targetProjectId) return `/projects/${targetProjectId}/notes`;

      const goalId = asString(target.goal_id);
      if (goalId) {
        return projectId ? `/projects/${projectId}/goals/${goalId}/notes` : null;
      }

      const taskId = asString(target.task_id);
      if (taskId) {
        const taskGoalId = asString(p.task_goal_id);
        return projectId && taskGoalId
          ? `/projects/${projectId}/goals/${taskGoalId}/tasks/${taskId}`
          : null;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * The parsed (normalised) URL when the ref is an http(s) URL, otherwise null
 * (it is then shown as plain text, never as a link). The href comes from the
 * parsed URL so what is checked is exactly what is linked.
 */
export function sourceHref(ref: string): string | null {
  try {
    const url = new URL(ref);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function validationLines(detail: unknown[]): string[] {
  const lines: string[] = [];
  for (const item of detail) {
    const entry = asRecord(item);
    if (!entry || typeof entry.msg !== 'string') continue;

    const loc = Array.isArray(entry.loc) ? entry.loc : [];
    const path = (loc[0] === 'body' ? loc.slice(1) : loc).join('.');
    lines.push(path ? `${path}: ${entry.msg}` : entry.msg);
  }
  return lines;
}

const ALREADY_DECIDED = 'Proposal already decided';

/** Japanese text for the detail strings the proposals API is known to send. */
const KNOWN_DETAIL_MESSAGES: ReadonlyMap<string, string> = new Map([
  [ALREADY_DECIDED, 'この提案はすでに処理されています。一覧を更新しました。'],
  [
    'Proposal target no longer exists; reject it instead',
    '提案の対象が見つかりません（削除された可能性があります）。この提案は却下してください。',
  ],
  [
    'Stored proposal no longer matches its schema; reject it instead',
    'この提案は現在の形式に合わないため承認できません。却下してください。',
  ],
  [
    'Note was created concurrently; retry',
    'ノートが同時に作成されました。もう一度お試しください。',
  ],
  ['Proposal not found', '提案が見つかりません。'],
]);

/** The string `detail` of an API error, or its message when there is none. */
function errorDetail(error: ApiError): string {
  const detail = asRecord(error.context?.responseData)?.detail;
  return typeof detail === 'string' ? detail : error.message;
}

/**
 * True when another tab or the agent already decided the proposal (HTTP 409
 * with exactly that detail), so the card on screen is stale.
 */
export function isAlreadyDecidedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.statusCode === 409 &&
    errorDetail(error) === ALREADY_DECIDED
  );
}

/**
 * A readable message for a failed accept/reject: one line per Pydantic error
 * for a 422 with an array detail, Japanese text for the known backend details,
 * otherwise the standard error message.
 */
export function proposalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = asRecord(error.context?.responseData)?.detail;
    if (Array.isArray(detail)) {
      const lines = validationLines(detail);
      if (lines.length > 0) return lines.join('\n');
    }
    const known = KNOWN_DETAIL_MESSAGES.get(errorDetail(error));
    if (known) return known;
  }
  return getErrorMessage(error instanceof Error ? error : new Error(String(error)));
}
