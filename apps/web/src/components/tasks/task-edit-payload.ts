import { toJSTStartOfDayISOString } from '@/lib/date-utils';
import type { TaskStatus, TaskUpdate, WorkType } from '@/types/task';

interface TaskEditPayloadInput {
  title: string;
  description?: string;
  estimate_hours: number;
  due_date?: string;
  status: TaskStatus;
  work_type?: WorkType;
  priority?: number;
}

function toDueDatePayload(dueDate?: string): string | null | undefined {
  if (dueDate === '') return null;
  return dueDate && toJSTStartOfDayISOString(dueDate);
}

export function buildTaskEditUpdatePayload(data: TaskEditPayloadInput): TaskUpdate {
  return {
    title: data.title,
    description: data.description === '' ? null : data.description,
    estimate_hours: data.estimate_hours,
    due_date: toDueDatePayload(data.due_date),
    status: data.status,
    work_type: data.work_type || 'light_work',
    priority: data.priority || 3,
  };
}
