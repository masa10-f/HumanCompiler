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
  kind: EditableProposalKind,
  field: string,
  value: string
): string | number | null {
  if (value === '') {
    return REQUIRED_FIELDS[kind].includes(field) ? '' : null;
  }
  return NUMERIC_FIELDS.has(field) ? Number(value) : value;
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
  current: FormValues
): Record<string, unknown> | null {
  const changed = EDITABLE_FIELDS[kind].filter(
    (field) => (current[field] ?? '') !== (initial[field] ?? '')
  );
  if (changed.length === 0) return null;

  const payload = { ...original };
  for (const field of changed) {
    payload[field] = toPayloadValue(kind, field, current[field] ?? '');
  }
  return payload;
}
