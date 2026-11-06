// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { toJSTDateInputValue } from './date-utils';
import type { ProposalKind } from '@/types/proposal';

/** Every form input holds a string. */
export type FormValues = Record<string, string>;

export type EditableProposalKind =
  | 'goal'
  | 'task'
  | 'quick_task'
  | 'note_append'
  | 'experiment';

/** The payload fields the edit form shows, per kind. */
export const EDITABLE_FIELDS: Record<EditableProposalKind, readonly string[]> = {
  goal: ['project_id', 'title', 'description', 'due_date'],
  task: [
    'goal_id',
    'title',
    'description',
    'estimate_hours',
    'due_date',
    'work_type',
    'priority',
    'note_markdown',
  ],
  quick_task: [
    'title',
    'description',
    'estimate_hours',
    'due_date',
    'work_type',
    'priority',
  ],
  note_append: ['content_markdown'],
  experiment: [
    'question',
    'method',
    'supports_if',
    'refutes_if',
    'effort',
    'estimated_hours',
    'prerequisites',
  ],
};

/** The fields that must not be empty; every other field may be cleared. */
export const REQUIRED_FIELDS: Record<EditableProposalKind, readonly string[]> = {
  goal: ['project_id', 'title'],
  task: ['goal_id', 'title', 'estimate_hours'],
  quick_task: ['title'],
  note_append: ['content_markdown'],
  experiment: ['question', 'method', 'supports_if', 'refutes_if', 'effort'],
};

const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
  'estimate_hours',
  'estimated_hours',
  'priority',
]);

export function isEditableKind(kind: ProposalKind): kind is EditableProposalKind {
  return Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, kind);
}

function toInputValue(field: string, value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return field === 'due_date' ? toJSTDateInputValue(value) : value;
}

/** Input strings for the form, read from the proposal's payload. */
export function initialFormValues(
  kind: EditableProposalKind,
  payload: Record<string, unknown>
): FormValues {
  return Object.fromEntries(
    EDITABLE_FIELDS[kind].map((field) => [field, toInputValue(field, payload[field])])
  );
}

function toPayloadValue(
  requiredFields: readonly string[],
  field: string,
  value: string
): string | number | null {
  if (value.trim() === '') {
    return requiredFields.includes(field) ? '' : null;
  }
  return NUMERIC_FIELDS.has(field) ? Number(value) : value;
}

/** The fields of one task inside a goal proposal. */
export const GOAL_TASK_FIELDS = [
  'title',
  'description',
  'estimate_hours',
  'due_date',
  'work_type',
  'priority',
  'note_markdown',
] as const;

export const GOAL_TASK_REQUIRED_FIELDS: readonly string[] = ['title', 'estimate_hours'];

export interface TaskItemState {
  values: FormValues;
  removed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One item state per task of a goal payload; none when it has no tasks array. */
export function initialTaskItems(payload: Record<string, unknown>): TaskItemState[] {
  if (!Array.isArray(payload.tasks)) return [];
  return payload.tasks.filter(isRecord).map((task) => ({
    values: Object.fromEntries(
      GOAL_TASK_FIELDS.map((field) => [field, toInputValue(field, task[field])])
    ),
    removed: false,
  }));
}

/**
 * The goal's tasks to send: the kept items in order, each a copy of its
 * original with only changed fields replaced. Null when nothing was removed or
 * changed.
 */
export function buildEditedTasks(
  originalTasks: Record<string, unknown>[],
  initial: TaskItemState[],
  current: TaskItemState[]
): Record<string, unknown>[] | null {
  const kept: Record<string, unknown>[] = [];
  let changedAny = false;
  current.forEach((item, index) => {
    if (item.removed) {
      changedAny = true;
      return;
    }
    const task = { ...originalTasks[index] };
    for (const field of GOAL_TASK_FIELDS) {
      const now = item.values[field] ?? '';
      if (now !== (initial[index]?.values[field] ?? '')) {
        task[field] = toPayloadValue(GOAL_TASK_REQUIRED_FIELDS, field, now);
        changedAny = true;
      }
    }
    kept.push(task);
  });
  return changedAny ? kept : null;
}

/**
 * The payload to send with an edited accept: a copy of `original` where only
 * the fields whose input value changed are replaced. Returns null when nothing
 * changed, so the caller sends a plain accept.
 */
export function buildEditedPayload(
  kind: EditableProposalKind,
  original: Record<string, unknown>,
  initial: FormValues,
  current: FormValues,
  tasks?: { initial: TaskItemState[]; current: TaskItemState[] }
): Record<string, unknown> | null {
  const changed = EDITABLE_FIELDS[kind].filter(
    (field) => (current[field] ?? '') !== (initial[field] ?? '')
  );
  const originalTasks = Array.isArray(original.tasks)
    ? original.tasks.filter(isRecord)
    : [];
  const editedTasks = tasks
    ? buildEditedTasks(originalTasks, tasks.initial, tasks.current)
    : null;
  if (changed.length === 0 && editedTasks === null) return null;

  const payload = { ...original };
  for (const field of changed) {
    payload[field] = toPayloadValue(REQUIRED_FIELDS[kind], field, current[field] ?? '');
  }
  if (editedTasks !== null) {
    payload.tasks = editedTasks.length > 0 ? editedTasks : null;
  }
  return payload;
}
