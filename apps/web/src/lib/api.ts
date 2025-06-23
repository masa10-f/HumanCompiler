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