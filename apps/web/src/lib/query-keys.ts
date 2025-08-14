/**
 * Centralized query key definitions for React Query
 * Ensures consistency across the application
 */

export const queryKeys = {
  // Project keys
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.projects.lists(), { filters }] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },

  // Goal keys
  goals: {
    all: ['goals'] as const,
    lists: () => [...queryKeys.goals.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.goals.lists(), { filters }] as const,
    details: () => [...queryKeys.goals.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.goals.details(), id] as const,
    byProject: (projectId: string) => [...queryKeys.goals.all, 'project', projectId] as const,
  },

  // Task keys
  tasks: {
    all: ['tasks'] as const,
    lists: () => [...queryKeys.tasks.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.tasks.lists(), { filters }] as const,
    details: () => [...queryKeys.tasks.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.tasks.details(), id] as const,
    byGoal: (goalId: string) => [...queryKeys.tasks.all, 'goal', goalId] as const,
    byProject: (projectId: string) => [...queryKeys.tasks.all, 'project', projectId] as const,
  },

  // Log keys
  logs: {
    all: ['logs'] as const,
    lists: () => [...queryKeys.logs.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.logs.lists(), { filters }] as const,
    details: () => [...queryKeys.logs.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.logs.details(), id] as const,
    byTask: (taskId: string) => [...queryKeys.logs.all, 'task', taskId] as const,
    batch: (taskIds: string[]) => ['logs', 'batch', ...taskIds.sort()] as const,
  },

  // Progress keys
  progress: {
    all: ['progress'] as const,
    project: (projectId: string) => [...queryKeys.progress.all, 'project', projectId] as const,
    goal: (goalId: string) => [...queryKeys.progress.all, 'goal', goalId] as const,
    task: (taskId: string) => [...queryKeys.progress.all, 'task', taskId] as const,
  },

  // Schedule keys
  schedule: {
    all: ['schedule'] as const,
    daily: (date: string) => [...queryKeys.schedule.all, 'daily', date] as const,
    weekly: (startDate: string) => [...queryKeys.schedule.all, 'weekly', startDate] as const,
  },

  // User settings keys
  userSettings: {
    all: ['userSettings'] as const,
    current: () => [...queryKeys.userSettings.all, 'current'] as const,
  },

  // AI keys
  ai: {
    all: ['ai'] as const,
    weeklyPlan: () => [...queryKeys.ai.all, 'weeklyPlan'] as const,
    workloadAnalysis: () => [...queryKeys.ai.all, 'workloadAnalysis'] as const,
    priorities: () => [...queryKeys.ai.all, 'priorities'] as const,
  },

  // Task dependencies keys
  taskDependencies: {
    all: ['taskDependencies'] as const,
    byTask: (taskId: string) => [...queryKeys.taskDependencies.all, 'task', taskId] as const,
  },
} as const;

// Export type for type safety
export type QueryKeys = typeof queryKeys;
