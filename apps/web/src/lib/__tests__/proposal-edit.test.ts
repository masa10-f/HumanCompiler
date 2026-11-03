// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  buildEditedPayload,
  initialFormValues,
  type FormValues,
} from '../proposal-edit';

const original = {
  goal_id: 'g1',
  title: 'Old title',
  description: 'Old description',
  estimate_hours: 2,
  due_date: '2026-11-10T15:00:00Z',
  work_type: 'study',
  priority: 3,
};

function taskValues(overrides: FormValues = {}): FormValues {
  return { ...initialFormValues('task', original), ...overrides };
}

describe('initialFormValues', () => {
  it('turns payload values into input strings', () => {
    expect(initialFormValues('task', original)).toEqual({
      goal_id: 'g1',
      title: 'Old title',
      description: 'Old description',
      estimate_hours: '2',
      due_date: '2026-11-11',
      work_type: 'study',
      priority: '3',
    });
  });

  it('uses an empty string for missing or null values', () => {
    expect(
      initialFormValues('quick_task', { title: 'T', description: null })
    ).toEqual({
      title: 'T',
      description: '',
      estimate_hours: '',
      due_date: '',
      work_type: '',
      priority: '',
    });
  });
});

describe('buildEditedPayload', () => {
  it('returns null when nothing changed', () => {
    const initial = taskValues();
    expect(buildEditedPayload('task', original, initial, { ...initial })).toBeNull();
  });

  it('replaces only the changed field and keeps the original due_date', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, {
      ...initial,
      title: 'new',
    });
    expect(result).toEqual({ ...original, title: 'new' });
    expect(result?.due_date).toBe('2026-11-10T15:00:00Z');
  });

  it('sends null for a cleared optional field', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, {
      ...initial,
      description: '',
    });
    expect(result).toEqual({ ...original, description: null });
  });

  it('sends null for whitespace-only optional text', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, {
      ...initial,
      description: '   \n ',
      estimate_hours: '4',
    });
    expect(result).toEqual({ ...original, description: null, estimate_hours: 4 });
  });

  it('keeps whitespace-only required text empty', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, { ...initial, title: '  ' });
    expect(result).toEqual({ ...original, title: '' });
  });

  it('converts numeric fields to numbers', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, {
      ...initial,
      estimate_hours: '2.5',
      priority: '5',
    });
    expect(result).toEqual({ ...original, estimate_hours: 2.5, priority: 5 });
  });

  it('sends the date input value for a changed due date', () => {
    const initial = taskValues();
    const result = buildEditedPayload('task', original, initial, {
      ...initial,
      due_date: '2026-11-20',
    });
    expect(result).toEqual({ ...original, due_date: '2026-11-20' });
  });

  it('sends a cleared experiment estimate as null and keeps unchanged fields', () => {
    const exp = {
      question: 'Q',
      method: 'M',
      supports_if: 'S',
      refutes_if: 'R',
      effort: 'low',
      estimated_hours: 1.5,
    };
    const initial = initialFormValues('experiment', exp);
    const result = buildEditedPayload('experiment', exp, initial, {
      ...initial,
      estimated_hours: '',
    });
    expect(result).toEqual({ ...exp, estimated_hours: null });
  });

  it('never adds fields that are not form fields of the kind', () => {
    const note = {
      target: { project_id: 'p1' },
      content_markdown: 'old',
    };
    const initial = initialFormValues('note_append', note);
    const result = buildEditedPayload('note_append', note, initial, {
      ...initial,
      content_markdown: 'new',
    });
    expect(result).toEqual({ target: { project_id: 'p1' }, content_markdown: 'new' });
  });
});
