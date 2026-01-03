import type { Project, ProjectStatus } from '@/types/project'
import type { Goal, GoalStatus } from '@/types/goal'
import type { Task, TaskStatus, WorkType } from '@/types/task'
import type { Log } from '@/types/log'
import type {
  ProjectTimelineData,
  TimelineOverviewData,
  TimelineGoal,
  TimelineTask,
  TimelineProject,
  ProjectStatistics,
} from '@/types/timeline'

// Counter for unique IDs
let idCounter = 0
const generateId = (prefix: string) => `${prefix}-${++idCounter}`

// Reset counter for tests
export const resetIdCounter = () => {
  idCounter = 0
}

// Project factory
export const createMockProject = (overrides: Partial<Project> = {}): Project => ({
  id: generateId('project'),
  title: 'Test Project',
  description: 'Test description',
  status: 'in_progress' as ProjectStatus,
  owner_id: 'user-123',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
})

// Goal factory
export const createMockGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: generateId('goal'),
  title: 'Test Goal',
  description: 'Test goal description',
  estimate_hours: 10,
  status: 'pending' as GoalStatus,
  project_id: 'project-123',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
})

// Task factory
export const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: generateId('task'),
  title: 'Test Task',
  description: 'Test task description',
  estimate_hours: 2,
  due_date: '2025-01-15',
  status: 'pending' as TaskStatus,
  work_type: 'focused_work' as WorkType,
  priority: 3,
  goal_id: 'goal-123',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
})

// Log factory
export const createMockLog = (overrides: Partial<Log> = {}): Log => ({
  id: generateId('log'),
  task_id: 'task-123',
  actual_minutes: 30,
  comment: 'Test log entry',
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
})

// Timeline Task factory
export const createMockTimelineTask = (overrides: Partial<TimelineTask> = {}): TimelineTask => ({
  id: generateId('timeline-task'),
  goal_id: 'goal-123',
  title: 'Timeline Task',
  description: null,
  status: 'pending',
  estimate_hours: 2,
  due_date: '2025-01-15',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  progress_percentage: 0,
  status_color: 'gray',
  actual_hours: 0,
  logs_count: 0,
  ...overrides,
})

// Timeline Goal factory
export const createMockTimelineGoal = (overrides: Partial<TimelineGoal> = {}): TimelineGoal => ({
  id: generateId('timeline-goal'),
  title: 'Timeline Goal',
  description: null,
  status: 'pending',
  estimate_hours: 10,
  start_date: '2025-01-01',
  end_date: '2025-01-15',
  dependencies: [],
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  tasks: [],
  ...overrides,
})

// Project Statistics factory
export const createMockProjectStatistics = (overrides: Partial<ProjectStatistics> = {}): ProjectStatistics => ({
  total_goals: 5,
  completed_goals: 2,
  in_progress_goals: 2,
  total_tasks: 20,
  completed_tasks: 8,
  in_progress_tasks: 6,
  goals_completion_rate: 40,
  tasks_completion_rate: 40,
  ...overrides,
})

// Timeline Project factory
export const createMockTimelineProject = (overrides: Partial<TimelineProject> = {}): TimelineProject => ({
  id: generateId('timeline-project'),
  title: 'Timeline Project',
  description: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  statistics: createMockProjectStatistics(),
  ...overrides,
})

// Project Timeline Data factory
export const createMockProjectTimelineData = (overrides: Partial<ProjectTimelineData> = {}): ProjectTimelineData => ({
  project: {
    id: 'project-123',
    title: 'Test Project',
    description: 'Test description',
    weekly_work_hours: 40,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  timeline: {
    start_date: '2025-01-01',
    end_date: '2025-01-31',
    time_unit: 'day',
  },
  goals: [],
  ...overrides,
})

// Timeline Overview Data factory
export const createMockTimelineOverviewData = (overrides: Partial<TimelineOverviewData> = {}): TimelineOverviewData => ({
  timeline: {
    start_date: '2025-01-01',
    end_date: '2025-01-31',
  },
  projects: [],
  ...overrides,
})

// Batch factories for multiple items
export const createMockProjects = (count: number, overrides: Partial<Project> = {}): Project[] =>
  Array.from({ length: count }, (_, i) => createMockProject({ title: `Project ${i + 1}`, ...overrides }))

export const createMockGoals = (count: number, overrides: Partial<Goal> = {}): Goal[] =>
  Array.from({ length: count }, (_, i) => createMockGoal({ title: `Goal ${i + 1}`, ...overrides }))

export const createMockTasks = (count: number, overrides: Partial<Task> = {}): Task[] =>
  Array.from({ length: count }, (_, i) => createMockTask({ title: `Task ${i + 1}`, ...overrides }))

export const createMockLogs = (count: number, overrides: Partial<Log> = {}): Log[] =>
  Array.from({ length: count }, (_, i) => createMockLog({ actual_minutes: 30 * (i + 1), ...overrides }))
