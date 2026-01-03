import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project'
import type { Goal, GoalCreate, GoalUpdate } from '@/types/goal'
import type { Task, TaskCreate, TaskUpdate } from '@/types/task'
import type { Log, LogCreate, LogUpdate } from '@/types/log'
import type { ProjectTimelineData, TimelineOverviewData } from '@/types/timeline'
import type { SortOptions } from '@/types/sort'

// Projects API mock
export const mockProjectsApi = {
  getAll: jest.fn<Promise<Project[]>, [number?, number?, SortOptions?]>(),
  getById: jest.fn<Promise<Project>, [string]>(),
  create: jest.fn<Promise<Project>, [ProjectCreate]>(),
  update: jest.fn<Promise<Project>, [string, ProjectUpdate]>(),
  delete: jest.fn<Promise<void>, [string]>(),
}

// Goals API mock
export const mockGoalsApi = {
  getByProject: jest.fn<Promise<Goal[]>, [string, number?, number?, SortOptions?]>(),
  getById: jest.fn<Promise<Goal>, [string]>(),
  create: jest.fn<Promise<Goal>, [GoalCreate]>(),
  update: jest.fn<Promise<Goal>, [string, GoalUpdate]>(),
  delete: jest.fn<Promise<void>, [string]>(),
}

// Tasks API mock
export const mockTasksApi = {
  getByGoal: jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>(),
  getByProject: jest.fn<Promise<Task[]>, [string, number?, number?, SortOptions?]>(),
  getById: jest.fn<Promise<Task>, [string]>(),
  create: jest.fn<Promise<Task>, [TaskCreate]>(),
  update: jest.fn<Promise<Task>, [string, TaskUpdate]>(),
  delete: jest.fn<Promise<void>, [string]>(),
}

// Logs API mock
export const mockLogsApi = {
  getByTask: jest.fn<Promise<Log[]>, [string, number?, number?]>(),
  getBatch: jest.fn<Promise<Record<string, Log[]>>, [string[]]>(),
  getById: jest.fn<Promise<Log>, [string]>(),
  create: jest.fn<Promise<Log>, [LogCreate]>(),
  update: jest.fn<Promise<Log>, [string, LogUpdate]>(),
  delete: jest.fn<Promise<void>, [string]>(),
}

// Timeline API mock
export const mockTimelineApi = {
  getProjectTimeline: jest.fn<
    Promise<ProjectTimelineData>,
    [string, string?, string?, string?, number?]
  >(),
  getOverview: jest.fn<Promise<TimelineOverviewData>, [string?, string?]>(),
}

// Reset all API mocks
export const resetApiMocks = () => {
  Object.values(mockProjectsApi).forEach((fn) => fn.mockReset())
  Object.values(mockGoalsApi).forEach((fn) => fn.mockReset())
  Object.values(mockTasksApi).forEach((fn) => fn.mockReset())
  Object.values(mockLogsApi).forEach((fn) => fn.mockReset())
  Object.values(mockTimelineApi).forEach((fn) => fn.mockReset())
}

// Export as a combined object for convenience
export const mockApi = {
  projectsApi: mockProjectsApi,
  goalsApi: mockGoalsApi,
  tasksApi: mockTasksApi,
  logsApi: mockLogsApi,
  timelineApi: mockTimelineApi,
}

export default mockApi
