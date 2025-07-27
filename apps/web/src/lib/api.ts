import { supabase } from './supabase';
import type { 
  Project, 
  ProjectCreate, 
  ProjectUpdate, 
  ProjectResponse 
} from '@/types/project';
import type {
  Goal,
  GoalCreate,
  GoalUpdate,
  GoalResponse
} from '@/types/goal';
import type {
  Task,
  TaskCreate,
  TaskUpdate,
  TaskResponse
} from '@/types/task';
import type {
  WeeklyPlanRequest,
  WeeklyPlanResponse,
  WorkloadAnalysis,
  PrioritySuggestions,
  ScheduleRequest,
  ScheduleResult
} from '@/types/ai-planning';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle 204 No Content responses
      if (response.status === 204) {
        return {} as T;
      }

      return response.json();
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
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

  async testAIIntegration(): Promise<any> {
    return this.request<any>('/api/ai/weekly-plan/test');
  }

  // Scheduling API methods
  async optimizeDailySchedule(scheduleRequest: ScheduleRequest): Promise<ScheduleResult> {
    return this.request<ScheduleResult>('/api/schedule/daily', {
      method: 'POST',
      body: JSON.stringify(scheduleRequest),
    });
  }

  async saveDailySchedule(scheduleData: ScheduleResult & { date: string; generated_at: string }): Promise<any> {
    return this.request<any>('/api/schedule/daily/save', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    });
  }

  async getDailySchedule(date: string): Promise<any> {
    return this.request<any>(`/api/schedule/daily/${date}`);
  }

  async listDailySchedules(skip?: number, limit?: number): Promise<any[]> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (limit !== undefined) params.append('limit', limit.toString());
    
    return this.request<any[]>(`/api/schedule/daily/list?${params.toString()}`);
  }

  async testScheduler(): Promise<any> {
    return this.request<any>('/api/schedule/test');
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