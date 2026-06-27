import { buildTaskEditUpdatePayload } from '../task-edit-payload';

describe('buildTaskEditUpdatePayload', () => {
  it('keeps cleared optional fields in JSON by sending explicit nulls', () => {
    const payload = buildTaskEditUpdatePayload({
      title: 'Updated task',
      description: '',
      estimate_hours: 2,
      due_date: '',
      status: 'pending',
      work_type: 'focused_work',
      priority: 2,
    });

    expect(payload.description).toBeNull();
    expect(payload.due_date).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({
      description: null,
      due_date: null,
    });
  });

  it('preserves non-empty optional fields', () => {
    const payload = buildTaskEditUpdatePayload({
      title: 'Updated task',
      description: 'Keep this',
      estimate_hours: 2,
      due_date: '2026-01-15',
      status: 'in_progress',
      work_type: 'study',
      priority: 1,
    });

    expect(payload.description).toBe('Keep this');
    expect(payload.due_date).toBe('2026-01-15');
  });
});
