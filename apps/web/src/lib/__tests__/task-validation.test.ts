import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_ESTIMATE_HOURS_MAX,
  TASK_MEMO_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  taskCreateFormSchema,
  taskEditFormSchema,
  taskMemoSchema,
} from '../validations/task';

const validTaskForm = {
  title: 'Valid task',
  description: 'Valid description',
  estimate_hours: 1.25,
  due_date: '',
  work_type: 'light_work' as const,
  priority: 3,
};

describe('task validation schemas', () => {
  it('uses API-aligned task create limits', () => {
    expect(taskCreateFormSchema.safeParse({
      ...validTaskForm,
      title: 'a'.repeat(TASK_TITLE_MAX_LENGTH),
      description: 'b'.repeat(TASK_DESCRIPTION_MAX_LENGTH),
      estimate_hours: TASK_ESTIMATE_HOURS_MAX,
    }).success).toBe(true);

    expect(taskCreateFormSchema.safeParse({
      ...validTaskForm,
      title: 'a'.repeat(TASK_TITLE_MAX_LENGTH + 1),
    }).success).toBe(false);

    expect(taskCreateFormSchema.safeParse({
      ...validTaskForm,
      description: 'b'.repeat(TASK_DESCRIPTION_MAX_LENGTH + 1),
    }).success).toBe(false);
  });

  it('rejects task estimates outside numeric precision limits', () => {
    expect(taskCreateFormSchema.safeParse({
      ...validTaskForm,
      estimate_hours: TASK_ESTIMATE_HOURS_MAX + 0.01,
    }).success).toBe(false);

    expect(taskCreateFormSchema.safeParse({
      ...validTaskForm,
      estimate_hours: 1.234,
    }).success).toBe(false);
  });

  it('derives edit validation by adding status to the base task schema', () => {
    expect(taskEditFormSchema.safeParse({
      ...validTaskForm,
      status: 'pending',
    }).success).toBe(true);

    expect(taskEditFormSchema.safeParse({
      ...validTaskForm,
    }).success).toBe(false);
  });

  it('validates task memo length', () => {
    expect(taskMemoSchema.safeParse('a'.repeat(TASK_MEMO_MAX_LENGTH)).success).toBe(true);
    expect(taskMemoSchema.safeParse('a'.repeat(TASK_MEMO_MAX_LENGTH + 1)).success).toBe(false);
  });
});
