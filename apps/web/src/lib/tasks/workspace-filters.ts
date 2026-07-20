import type { TaskStatus, TaskWorkspaceFilters } from "@/types/task";

export type TaskWorkspacePreset =
  | "ready"
  | "today"
  | "week"
  | "in_progress"
  | "overdue"
  | "blocked"
  | "unplanned"
  | "inbox"
  | "all";

export const DEFAULT_TASK_WORKSPACE_PRESET: TaskWorkspacePreset = "ready";
const actionableStatuses: TaskStatus[] = ["pending", "in_progress"];

interface BuildTaskWorkspaceFiltersInput {
  preset: TaskWorkspacePreset;
  page: number;
  status: TaskStatus | "";
  projectId: string;
  goalId: string;
  search: string;
  now?: Date;
}

export function buildTaskWorkspaceFilters({
  preset,
  page,
  status,
  projectId,
  goalId,
  search,
  now = new Date(),
}: BuildTaskWorkspaceFiltersInput): TaskWorkspaceFilters {
  let statuses = status ? [status] : undefined;
  if (
    !status &&
    ["ready", "overdue", "today", "week", "unplanned"].includes(preset)
  ) {
    statuses = actionableStatuses;
  }
  if (!status && preset === "in_progress") statuses = ["in_progress"];

  return {
    skip: page * 50,
    limit: 50,
    status: statuses,
    projectId: projectId || undefined,
    goalId: goalId || undefined,
    dueBefore: preset === "overdue" ? now.toISOString() : undefined,
    search: search || undefined,
    blocked:
      preset === "blocked" ? true : preset === "ready" ? false : undefined,
    plan: ["today", "week", "unplanned"].includes(preset)
      ? (preset as "today" | "week" | "unplanned")
      : undefined,
    sortBy: preset === "ready" ? "priority" : "due_date",
  };
}
