import * as z from 'zod';

export const TASK_TITLE_MAX_LENGTH = 200;
// Plain text a task can be created with; it becomes the task's note.
export const TASK_NOTE_MAX_LENGTH = 20000;
export const TASK_ESTIMATE_HOURS_MIN = 0.01;
export const TASK_ESTIMATE_HOURS_MAX = 999.99;

export const taskEstimateHoursSchema = z.number()
  .min(TASK_ESTIMATE_HOURS_MIN, '0.01時間以上で入力してください')
  .max(TASK_ESTIMATE_HOURS_MAX, '999.99時間以内で入力してください')
  .refine((val) => Number((val * 100).toFixed()) / 100 === val, {
    message: '小数点以下は2桁以内で入力してください',
  });

export const taskBaseFormSchema = z.object({
  title: z.string()
    .min(1, '必須項目です')
    .max(TASK_TITLE_MAX_LENGTH, '200文字以内で入力してください'),
  estimate_hours: taskEstimateHoursSchema,
  due_date: z.string().optional(),
  work_type: z.enum(['light_work', 'study', 'focused_work']).optional(),
  priority: z.number()
    .int()
    .min(1, '1以上で入力してください')
    .max(5, '5以下で入力してください')
    .optional(),
});

export const taskCreateFormSchema = taskBaseFormSchema.extend({
  note: z.string()
    .max(TASK_NOTE_MAX_LENGTH, '20000文字以内で入力してください')
    .optional(),
});

export const taskEditFormSchema = taskBaseFormSchema.extend({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export type TaskCreateFormData = z.infer<typeof taskCreateFormSchema>;
export type TaskEditFormData = z.infer<typeof taskEditFormSchema>;
