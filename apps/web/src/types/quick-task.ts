/**
 * @fileoverview Quick Task (unclassified task) related type definitions
 * @description QuickTasks are tasks that don't belong to any project/goal
 */

import { TaskStatus, WorkType } from './task';

/**
 * Quick Task
 * @description Unclassified task not belonging to any project/goal
 */
export interface QuickTask {
  /** Task ID (UUID) */
  id: string;
  /** Owner user ID */
  owner_id: string;
  /** Task title */
  title: string;
  /** Task description */
  description: string | null;
  /** Estimated hours */
  estimate_hours: number;
  /** Due date (ISO 8601 format) */
  due_date: string | null;
  /** Status */
  status: TaskStatus;
  /** Work type classification */
  work_type: WorkType;
  /** Priority (1=highest, 5=lowest) */
  priority: number;
  /** Created at (ISO 8601 format) */
  created_at: string;
  /** Updated at (ISO 8601 format) */
  updated_at: string;
}

/**
 * Quick Task create request
 * @description Parameters for creating a new quick task
 */
export interface QuickTaskCreate {
  /** Task title */
  title: string;
  /** Task description */
  description?: string;
  /** Estimated hours (default: 0.5) */
  estimate_hours?: number;
  /** Due date (ISO 8601 format) */
  due_date?: string;
  /** Work type classification (default: light_work) */
  work_type?: WorkType;
  /** Priority (1=highest, 5=lowest, default: 3) */
  priority?: number;
}

/**
 * Quick Task update request
 * @description Parameters for updating a quick task (all fields optional)
 */
export interface QuickTaskUpdate {
  /** Task title */
  title?: string;
  /** Task description */
  description?: string;
  /** Estimated hours */
  estimate_hours?: number;
  /** Due date (ISO 8601 format) */
  due_date?: string;
  /** Status */
  status?: TaskStatus;
  /** Work type classification */
  work_type?: WorkType;
  /** Priority (1=highest, 5=lowest) */
  priority?: number;
}

/**
 * Quick Task convert request
 * @description Request to convert a quick task to a regular task
 */
export interface QuickTaskConvertRequest {
  /** Target goal ID to move the task to */
  goal_id: string;
}

/**
 * Quick Task API response
 * @description Response format for quick task endpoints
 */
export type QuickTaskResponse = QuickTask;

/**
 * Quick Tasks list API response
 * @description Response format for quick tasks list endpoint
 */
export interface QuickTasksApiResponse {
  /** Quick task data array */
  data: QuickTask[];
  /** Total count */
  total: number;
}
