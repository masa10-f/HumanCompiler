import { z } from 'zod';

// Database table types
export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  owner_id: string;
  title: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  estimate_hours: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  goal_id: string;
  title: string;
  description?: string;
  estimate_hours: number;
  due_date?: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface Schedule {
  id: string;
  user_id: string;
  date: string;
  plan_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Log {
  id: string;
  task_id: string;
  actual_minutes: number;
  comment?: string;
  created_at: string;
}

// Zod schemas for validation
export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);

export const CreateProjectSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
});

export const CreateGoalSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  estimate_hours: z.number().positive(),
});

export const CreateTaskSchema = z.object({
  goal_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  estimate_hours: z.number().positive(),
  due_date: z.string().datetime().optional(),
  status: TaskStatusSchema.default('pending'),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  estimate_hours: z.number().positive().optional(),
  due_date: z.string().datetime().optional(),
  status: TaskStatusSchema.optional(),
});

export const CreateLogSchema = z.object({
  task_id: z.string().uuid(),
  actual_minutes: z.number().positive(),
  comment: z.string().optional(),
});

export const ScheduleRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  availableSlots: z.array(z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    kind: z.enum(['study', 'deep', 'light']),
  })),
});

// Type exports
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type CreateGoal = z.infer<typeof CreateGoalSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
export type CreateLog = z.infer<typeof CreateLogSchema>;
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;