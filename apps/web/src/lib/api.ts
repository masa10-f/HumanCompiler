import { supabase } from './supabase';
import { ApiError, NetworkError, logError } from './errors';
import type {
  Project,
  ProjectCreate,
  ProjectUpdate
} from '@/types/project';
import type {
  Goal,
  GoalCreate,
  GoalUpdate
} from '@/types/goal';
import type {
  Task,
  TaskCreate,
  TaskUpdate
} from '@/types/task';
import type {
  WeeklyPlanRequest,
  WeeklyPlanResponse,
  WorkloadAnalysis,
  PrioritySuggestions,
  ScheduleRequest,
  ScheduleResult
} from '@/types/ai-planning';
import type {
  TestAIIntegrationResponse,
  SaveDailyScheduleResponse,
  DailySchedule,
  TestSchedulerResponse
} from '@/types/api-responses';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://taskagent-api-masa.fly.dev'
    : 'http://localhost:8000');

// API client configuration
class ApiClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('User not authenticated');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const context = {
      endpoint,
      method: options.method || 'GET',
      timestamp: new Date()
    };

    try {
      const headers = await this.getAuthHeaders();

      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
      });

      if (!response.ok) {
        let errorData: Record<string, unknown>;
        let errorMessage: string;

        try {
          errorData = await response.json();
          errorMessage = (errorData.detail as string) || (errorData.message as string) || `HTTP ${response.status}: ${response.statusText}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          errorData = { detail: errorMessage };
        }

        const apiError = new ApiError(
          response.status,
          errorMessage,
          { ...context, statusCode: response.status, responseData: errorData }
        );

        logError(apiError, context);
        throw apiError;
      }

      // Handle 204 No Content responses
      if (response.status === 204) {
        return {} as T;
      }

      return response.json();
    } catch (error) {
      // If it's already an ApiError, re-throw it
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle network errors (fetch failures)
      if (error instanceof TypeError || (error instanceof Error && error.message?.includes('fetch'))) {
        const networkError = new NetworkError(
          `Network request failed: ${error.message}`,
          context
        );
        logError(networkError, context);
        throw networkError;
      }

      // Handle authentication errors
      if (error instanceof Error && (error.message?.includes('auth') || error.message?.includes('token'))) {
        const authError = new ApiError(
          401,
          error.message,
          context,
          'ログインセッションが無効です。再度ログインしてください。'
        );
        logError(authError, context);
        throw authError;
      }

      // Fallback for unknown errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      const unknownError = new ApiError(
        500,
        `Unexpected error: ${errorMessage}`,
        context,
        '予期しないエラーが発生しました。'
      );
      logError(unknownError, context);
      throw unknownError;
    }
  }

  // Project API methods
  async getProjects(skip: number = 0, limit: number = 20): Promise<Project[]> {
    return this.request<Project[]>(`/api/projects/?skip=${skip}&limit=${limit}`);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/api/projects/${projectId}`);
  }

  async createProject(projectData: ProjectCreate): Promise<Project> {
    return this.request<Project>('/api/projects/', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async updateProject(projectId: string, projectData: ProjectUpdate): Promise<Project> {
    return this.request<Project>(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(projectData),
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.request<void>(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // Goal API methods
  async getGoalsByProject(projectId: string, skip: number = 0, limit: number = 20): Promise<Goal[]> {
    return this.request<Goal[]>(`/api/goals/project/${projectId}?skip=${skip}&limit=${limit}`);
  }

  async getGoal(goalId: string): Promise<Goal> {
    return this.request<Goal>(`/api/goals/${goalId}`);
  }

  async createGoal(goalData: GoalCreate): Promise<Goal> {
    return this.request<Goal>('/api/goals/', {
      method: 'POST',
      body: JSON.stringify(goalData),
    });
  }

  async updateGoal(goalId: string, goalData: GoalUpdate): Promise<Goal> {
    return this.request<Goal>(`/api/goals/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(goalData),
    });
  }

  async deleteGoal(goalId: string): Promise<void> {
    return this.request<void>(`/api/goals/${goalId}`, {
      method: 'DELETE',
    });
  }

  // Task API methods
  async getTasksByGoal(goalId: string, skip: number = 0, limit: number = 20): Promise<Task[]> {
    return this.request<Task[]>(`/api/tasks/goal/${goalId}?skip=${skip}&limit=${limit}`);
  }

  async getTasksByProject(projectId: string, skip: number = 0, limit: number = 20): Promise<Task[]> {
    return this.request<Task[]>(`/api/tasks/project/${projectId}?skip=${skip}&limit=${limit}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}`);
  }

  async createTask(taskData: TaskCreate): Promise<Task> {
    return this.request<Task>('/api/tasks/', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
  }

  async updateTask(taskId: string, taskData: TaskUpdate): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    return this.request<void>(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // AI Planning API methods
  async generateWeeklyPlan(planRequest: WeeklyPlanRequest): Promise<WeeklyPlanResponse> {
    return this.request<WeeklyPlanResponse>('/api/ai/weekly-plan', {
      method: 'POST',
      body: JSON.stringify(planRequest),
    });
  }

  async analyzeWorkload(projectIds?: string[]): Promise<WorkloadAnalysis> {
    const body = projectIds ? { project_ids: projectIds } : {};
    return this.request<WorkloadAnalysis>('/api/ai/analyze-workload', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async suggestTaskPriorities(projectId?: string): Promise<PrioritySuggestions> {
    const body = projectId ? { project_id: projectId } : {};
    return this.request<PrioritySuggestions>('/api/ai/suggest-priorities', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async testAIIntegration(): Promise<TestAIIntegrationResponse> {
    return this.request<TestAIIntegrationResponse>('/api/ai/weekly-plan/test');
  }

  // Scheduling API methods
  async optimizeDailySchedule(scheduleRequest: ScheduleRequest): Promise<ScheduleResult> {
    return this.request<ScheduleResult>('/api/schedule/daily', {
      method: 'POST',
      body: JSON.stringify(scheduleRequest),
    });
  }

  async saveDailySchedule(scheduleData: ScheduleResult & { date: string; generated_at: string }): Promise<SaveDailyScheduleResponse> {
    return this.request<SaveDailyScheduleResponse>('/api/schedule/daily/save', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    });
  }

  async getDailySchedule(date: string): Promise<DailySchedule> {
    return this.request<DailySchedule>(`/api/schedule/daily/${date}`);
  }

  async listDailySchedules(skip?: number, limit?: number): Promise<DailySchedule[]> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (limit !== undefined) params.append('limit', limit.toString());

    return this.request<DailySchedule[]>(`/api/schedule/daily/list?${params.toString()}`);
  }

  async testScheduler(): Promise<TestSchedulerResponse> {
    return this.request<TestSchedulerResponse>('/api/schedule/test');
  }
}

export const apiClient = new ApiClient(API_BASE_URL);

// Export individual API functions for easier use
export const projectsApi = {
  getAll: (skip?: number, limit?: number) => apiClient.getProjects(skip, limit),
  getById: (id: string) => apiClient.getProject(id),
  create: (data: ProjectCreate) => apiClient.createProject(data),
  update: (id: string, data: ProjectUpdate) => apiClient.updateProject(id, data),
  delete: (id: string) => apiClient.deleteProject(id),
};

export const goalsApi = {
  getByProject: (projectId: string, skip?: number, limit?: number) =>
    apiClient.getGoalsByProject(projectId, skip, limit),
  getById: (id: string) => apiClient.getGoal(id),
  create: (data: GoalCreate) => apiClient.createGoal(data),
  update: (id: string, data: GoalUpdate) => apiClient.updateGoal(id, data),
  delete: (id: string) => apiClient.deleteGoal(id),
};

export const tasksApi = {
  getByGoal: (goalId: string, skip?: number, limit?: number) =>
    apiClient.getTasksByGoal(goalId, skip, limit),
  getByProject: (projectId: string, skip?: number, limit?: number) =>
    apiClient.getTasksByProject(projectId, skip, limit),
  getById: (id: string) => apiClient.getTask(id),
  create: (data: TaskCreate) => apiClient.createTask(data),
  update: (id: string, data: TaskUpdate) => apiClient.updateTask(id, data),
  delete: (id: string) => apiClient.deleteTask(id),
};

export const aiPlanningApi = {
  generateWeeklyPlan: (request: WeeklyPlanRequest) => apiClient.generateWeeklyPlan(request),
  analyzeWorkload: (projectIds?: string[]) => apiClient.analyzeWorkload(projectIds),
  suggestPriorities: (projectId?: string) => apiClient.suggestTaskPriorities(projectId),
  testIntegration: () => apiClient.testAIIntegration(),
};

export const schedulingApi = {
  optimizeDaily: (request: ScheduleRequest) => apiClient.optimizeDailySchedule(request),
  save: (scheduleData: ScheduleResult & { date: string; generated_at: string }) => apiClient.saveDailySchedule(scheduleData),
  getByDate: (date: string) => apiClient.getDailySchedule(date),
  list: (skip?: number, limit?: number) => apiClient.listDailySchedules(skip, limit),
  test: () => apiClient.testScheduler(),
};
