import { buildTaskEditUpdatePayload } from '../task-edit-payload';

describe('buildTaskEditUpdatePayload', () => {
  it('keeps a cleared deadline in JSON by sending an explicit null', () => {
    const payload = buildTaskEditUpdatePayload({
      title: 'Updated task',
      estimate_hours: 2,
      due_date: '',
      status: 'pending',
      work_type: 'focused_work',
      priority: 2,
    });

    expect(payload.due_date).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({ due_date: null });
  });

  it('sends deadlines as JST start of day', () => {
    const payload = buildTaskEditUpdatePayload({
      title: 'Updated task',
      estimate_hours: 2,
      due_date: '2026-01-15',
      status: 'in_progress',
      work_type: 'study',
      priority: 1,
    });

    expect(payload.due_date).toBe('2026-01-15T00:00:00+09:00');
  });

  it('never sends task text: the note is edited on its own', () => {
    const payload = buildTaskEditUpdatePayload({
      title: 'Updated task',
      estimate_hours: 2,
      status: 'pending',
    });

    expect(payload).not.toHaveProperty('description');
    expect(payload).not.toHaveProperty('memo');
    expect(payload).not.toHaveProperty('note');
  });
});
