// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  buildEditedPayload,
  buildEditedTasks,
  initialFormValues,
  initialTaskItems,
  type FormValues,
  type TaskItemState,
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
      note_markdown: '',
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

const goalTasks = [
  {
    title: 'A',
    description: 'desc A',
    estimate_hours: 1.5,
    due_date: null,
    work_type: 'study',
    priority: 2,
    note_markdown: 'note A',
    extra: 'kept',
  },
  {
    title: 'B',
    description: null,
    estimate_hours: 3,
    due_date: null,
    work_type: null,
    priority: null,
  },
];
const goalOriginal = { project_id: 'p1', title: 'G', description: null, due_date: null, tasks: goalTasks };

function withTask(items: TaskItemState[], index: number, values: FormValues): TaskItemState[] {
  return items.map((item, i) =>
    i === index ? { ...item, values: { ...item.values, ...values } } : item
  );
}

describe('goal tasks', () => {
  it('reads goal tasks into item states', () => {
    const items = initialTaskItems(goalOriginal);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.removed === false)).toBe(true);
    expect(items[0].values).toEqual({
      title: 'A',
      description: 'desc A',
      estimate_hours: '1.5',
      due_date: '',
      work_type: 'study',
      priority: '2',
      note_markdown: 'note A',
    });
    expect(items[1].values.note_markdown).toBe('');
    expect(initialTaskItems({ title: 'G' })).toEqual([]);
  });

  it('buildEditedTasks returns null when nothing changed', () => {
    const initial = initialTaskItems(goalOriginal);
    expect(buildEditedTasks(goalTasks, initial, JSON.parse(JSON.stringify(initial)))).toBeNull();
  });

  it('buildEditedTasks drops a removed task and keeps the others unchanged', () => {
    const initial = initialTaskItems(goalOriginal);
    const current = initial.map((item, i) => ({ ...item, removed: i === 0 }));
    expect(buildEditedTasks(goalTasks, initial, current)).toEqual([goalTasks[1]]);
  });

  it('buildEditedTasks replaces only the changed note', () => {
    const initial = initialTaskItems(goalOriginal);
    const current = withTask(initial, 0, { note_markdown: 'new note' });
    expect(buildEditedTasks(goalTasks, initial, current)).toEqual([
      { ...goalTasks[0], note_markdown: 'new note' },
      goalTasks[1],
    ]);
  });

  it('buildEditedTasks sends null for a cleared optional field of a task', () => {
    const initial = initialTaskItems(goalOriginal);
    const current = withTask(initial, 0, { description: '' });
    expect(buildEditedTasks(goalTasks, initial, current)?.[0]).toEqual({
      ...goalTasks[0],
      description: null,
    });
  });

  it('buildEditedPayload sends tasks null when every task is removed', () => {
    const initialFields = initialFormValues('goal', goalOriginal);
    const initial = initialTaskItems(goalOriginal);
    const current = initial.map((item) => ({ ...item, removed: true }));
    const result = buildEditedPayload('goal', goalOriginal, initialFields, { ...initialFields }, {
      initial,
      current,
    });
    expect(result).toEqual({ ...goalOriginal, tasks: null });
  });

  it('buildEditedPayload returns null when neither fields nor tasks changed', () => {
    const initialFields = initialFormValues('goal', goalOriginal);
    const initial = initialTaskItems(goalOriginal);
    expect(
      buildEditedPayload('goal', goalOriginal, initialFields, { ...initialFields }, {
        initial,
        current: JSON.parse(JSON.stringify(initial)),
      })
    ).toBeNull();
  });

  it('buildEditedPayload includes note_markdown for a task', () => {
    const base = { ...original, note_markdown: 'old' };
    const initial = initialFormValues('task', base);
    expect(
      buildEditedPayload('task', base, initial, { ...initial, note_markdown: 'new' })
    ).toEqual({ ...base, note_markdown: 'new' });
    expect(
      buildEditedPayload('task', base, initial, { ...initial, note_markdown: '' })
    ).toEqual({ ...base, note_markdown: null });
  });
});
