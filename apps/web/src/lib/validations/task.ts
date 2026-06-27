import * as z from 'zod';

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 1000;
export const TASK_MEMO_MAX_LENGTH = 2000;
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
  description: z.string()
    .max(TASK_DESCRIPTION_MAX_LENGTH, '1000文字以内で入力してください')
    .optional(),
  estimate_hours: taskEstimateHoursSchema,
  due_date: z.string().optional(),
  work_type: z.enum(['light_work', 'study', 'focused_work']).optional(),
  priority: z.number()
    .int()
    .min(1, '1以上で入力してください')
    .max(5, '5以下で入力してください')
    .optional(),
});

export const taskCreateFormSchema = taskBaseFormSchema;

export const taskEditFormSchema = taskBaseFormSchema.extend({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const taskMemoSchema = z.string()
  .max(TASK_MEMO_MAX_LENGTH, '2000文字以内で入力してください');

export type TaskCreateFormData = z.infer<typeof taskCreateFormSchema>;
export type TaskEditFormData = z.infer<typeof taskEditFormSchema>;
