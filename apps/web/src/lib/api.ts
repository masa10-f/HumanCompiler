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
  GoalUpdate,
  GoalDependency,
  GoalDependencyCreate
} from '@/types/goal';
import type {
  Task,
  TaskCreate,
  TaskUpdate,
  TaskDependency
} from '@/types/task';
import type {
  Log,
  LogCreate,
  LogUpdate
} from '@/types/log';
import type {
  ProjectProgress,
  GoalProgress,
  TaskProgress
} from '@/types/progress';
import type {
  ProjectTimelineData,
  TimelineOverviewData
} from '@/types/timeline';
import type {
  WeeklyPlanRequest,
  WeeklyPlanResponse,
  WorkloadAnalysis,
  PrioritySuggestions,
  ScheduleRequest,
  ScheduleResult,
  SavedWeeklySchedule
} from '@/types/ai-planning';
import type {
  TestAIIntegrationResponse,
  SaveDailyScheduleResponse,
  DailySchedule,
  TestSchedulerResponse
} from '@/types/api-responses';
import type {
  WeeklyRecurringTask,
  WeeklyRecurringTaskCreate,
  WeeklyRecurringTaskUpdate
} from '@/types/weekly-recurring-task';

// Helper function to ensure HTTPS protocol
const ensureHttps = (url: string): string => {
  if (!url) return url;

  // Force HTTPS for production API endpoints (including all fly.dev and taskagent domains)
  if (url.startsWith('http://') &&
      (url.includes('taskagent-api-masa') ||
       url.includes('.fly.dev') ||
       url.includes('taskagent') ||
       url.includes('vercel.app'))) {
    const httpsUrl = url.replace('http://', 'https://');
    console.log(`🔒 ensureHttps: Converting ${url} to ${httpsUrl}`);
    return httpsUrl;
  }

  console.log(`🔒 ensureHttps: No change needed for ${url}`);
  return url;
};

// Determine API URL based on environment
const getApiBaseUrl = () => {
  console.log(`🚀 getApiBaseUrl() called at ${new Date().toISOString()}`);

  // Client-side hostname detection takes priority over env var for production
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    console.log(`🌐 Current hostname: ${hostname}`);

    // HumanCompiler Production - use relative URL to leverage Vercel rewrites
    if (hostname === 'human-compiler.vercel.app') {
      console.log(`🏭 Using HumanCompiler Production API via Vercel Rewrite`);
      return '';  // Use relative URL to leverage Vercel rewrites
    }
  }

  // If explicitly set via environment variable, use it (but NEVER for HumanCompiler production)
  if (process.env.NEXT_PUBLIC_API_URL) {
    // Additional safety check for HumanCompiler production
    if (typeof window !== 'undefined' && window.location.hostname === 'human-compiler.vercel.app') {
      console.log(`🚫 BLOCKED: Ignoring NEXT_PUBLIC_API_URL for HumanCompiler production`);
    } else if (process.env.NODE_ENV !== 'production') {
      const originalUrl = process.env.NEXT_PUBLIC_API_URL;
      const secureUrl = ensureHttps(originalUrl);
      console.log(`🔧 Using env var NEXT_PUBLIC_API_URL: ${originalUrl} -> ${secureUrl}`);
      return secureUrl;
    }
  }

  // Server-side: use environment-based detection
  if (typeof window === 'undefined') {
    // During SSR, use relative URL for production (Vercel rewrites handle routing)
    return process.env.NODE_ENV === 'production'
      ? ''  // Use relative URL for production SSR
      : 'http://localhost:8000';
  }

  // Client-side: use hostname detection (already handled above, this is fallback)
  const hostname = window.location.hostname;

  // Debug logging
  console.log(`🌐 Fallback hostname check: ${hostname}`);

  // Add to window object for debugging and cache busting
  (window as any).taskAgentDebug = {
    hostname,
    timestamp: new Date().toISOString(),
    version: '2025-08-25-v2'  // Update this to force cache refresh
  };

  // Force cache clear for HumanCompiler production if needed
  if (hostname === 'human-compiler.vercel.app') {
    console.log(`🧹 Cache info for HumanCompiler production debugging`);
  }

  // TaskAgent Production Vercel deployment (exact match)
  if (hostname === 'taskagent.vercel.app') {
    console.log(`🏭 Using TaskAgent Production API`);
    return 'https://taskagent-api-masa.fly.dev';
  }

  // HumanCompiler Vercel preview deployments
  if (hostname.includes('humancompiler') || hostname.includes('human-compiler')) {
    console.log(`🔬 Using HumanCompiler Preview API`);
    return 'https://humancompiler-api-masa-preview.fly.dev';
  }

  // TaskAgent Vercel preview deployments (any other vercel.app domain)
  if (hostname.endsWith('.vercel.app')) {
    console.log(`🔬 Using TaskAgent Preview API`);
    return 'https://taskagent-api-masa-preview.fly.dev';
  }

  // Local development
  if (hostname === 'localhost' || hostname.startsWith('localhost:')) {
    console.log(`💻 Using Local API`);
    return 'http://localhost:8000';
  }

  // Default fallback - check for HumanCompiler domains first
  console.log(`🔄 Using Default API (NODE_ENV: ${process.env.NODE_ENV})`);

  // If hostname contains humancompiler, use humancompiler API
  if (hostname.includes('humancompiler') || hostname.includes('human-compiler')) {
    return process.env.NODE_ENV === 'production'
      ? 'https://humancompiler-api-masa.fly.dev'
      : 'http://localhost:8000';
  }

  // Otherwise use TaskAgent API
  return process.env.NODE_ENV === 'production'
    ? 'https://taskagent-api-masa.fly.dev'
    : 'http://localhost:8000';
};

// API client configuration
class ApiClient {
  private getBaseURL(): string {
    const url = getApiBaseUrl();
    console.log(`🔗 ApiClient.getBaseURL() called, returning: ${url}`);

    // CRITICAL: Force relative URL for HumanCompiler production to prevent direct Fly.io access
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname === 'human-compiler.vercel.app') {
        console.log(`🔒 FORCED: Using relative URL for HumanCompiler production`);
        return '';  // Always return empty string for production
      }
    }

    return url;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    console.log('🔍 [ApiClient] Getting Supabase session...');

    // Try to refresh the session first
    const { data: { session }, error } = await supabase.auth.getSession();

    console.log('🔍 [ApiClient] Session data:', {
      hasSession: !!session,
      hasAccessToken: !!session?.access_token,
      userId: session?.user?.id,
      email: session?.user?.email,
      expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'N/A',
      isExpired: session?.expires_at ? Date.now() / 1000 > session.expires_at : 'Unknown'
    });

    if (error) {
      console.error('❌ [ApiClient] Supabase auth error:', error);
      throw new Error('Authentication error');
    }

    if (!session?.access_token) {
      console.error('❌ [ApiClient] No access token found');
      throw new Error('User not authenticated');
    }

    // Check if token is expired and refresh if needed
    if (session.expires_at && Date.now() / 1000 > session.expires_at - 60) {
      console.log('🔄 [ApiClient] Token expiring soon, refreshing...');
      const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError || !refreshedSession.session) {
        console.error('❌ [ApiClient] Failed to refresh token:', refreshError);
        throw new Error('Failed to refresh authentication');
      }

      console.log('✅ [ApiClient] Token refreshed successfully');
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshedSession.session.access_token}`,
      };
    }

    console.log('✅ [ApiClient] Auth headers prepared');
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

    console.log('🔍 [ApiClient] Starting request:', context);

    try {
      console.log('🔍 [ApiClient] Getting auth headers...');
      const headers = await this.getAuthHeaders();
      console.log('✅ [ApiClient] Auth headers obtained');

      const baseUrl = this.getBaseURL();
      const fullUrl = `${baseUrl}${endpoint}`;
      console.log('🔍 [ApiClient] Making fetch request to:', fullUrl);
      // Safe header logging
      const headerObj = { ...headers, ...options.headers };
      const authHeader = typeof headerObj === 'object' && headerObj && 'Authorization' in headerObj
        ? String(headerObj.Authorization) : undefined;

      console.log('🔍 [ApiClient] Request headers:', {
        ...headerObj,
        Authorization: authHeader ? `${authHeader.substring(0, 20)}...` : 'None'
      });

      const response = await fetch(fullUrl, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
      });

      console.log('🔍 [ApiClient] Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        let errorData: Record<string, unknown>;
        let errorMessage: string;

        try {
          errorData = await response.json();
          errorMessage =
            (typeof errorData.detail === 'string' ? errorData.detail : undefined) ||
            (typeof errorData.message === 'string' ? errorData.message : undefined) ||
            `HTTP ${response.status}: ${response.statusText}`;
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
        console.log('✅ [ApiClient] 204 No Content response');
        return {} as T;
      }

      console.log('🔍 [ApiClient] Parsing JSON response...');
      const responseData = await response.json();
      console.log('✅ [ApiClient] JSON response parsed:', responseData);
      return responseData;
    } catch (error) {
      // If it's already an ApiError, re-throw it
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle network errors (fetch failures)
      if (error instanceof TypeError) {
        const networkError = new NetworkError(
          `Network request failed: ${error.message}`,
          context
        );
        logError(networkError, context);
        throw networkError;
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

  // Goal dependency methods
  async addGoalDependency(dependencyData: GoalDependencyCreate): Promise<GoalDependency> {
    return this.request<GoalDependency>('/api/goal-dependencies/', {
      method: 'POST',
      body: JSON.stringify(dependencyData),
    });
  }

  async getGoalDependencies(goalId: string): Promise<GoalDependency[]> {
    return this.request<GoalDependency[]>(`/api/goal-dependencies/goal/${goalId}`);
  }

  async deleteGoalDependency(dependencyId: string): Promise<void> {
    return this.request<void>(`/api/goal-dependencies/${dependencyId}`, {
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

  // Task dependency methods
  async addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDependency> {
    return this.request<TaskDependency>(`/api/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({
        depends_on_task_id: dependsOnTaskId,
      }),
    });
  }

  async getTaskDependencies(taskId: string): Promise<TaskDependency[]> {
    return this.request<TaskDependency[]>(`/api/tasks/${taskId}/dependencies`);
  }

  async deleteTaskDependency(taskId: string, dependencyId: string): Promise<void> {
    return this.request<void>(`/api/tasks/${taskId}/dependencies/${dependencyId}`, {
      method: 'DELETE',
    });
  }

  // AI Planning API methods
  async generateWeeklyPlan(planRequest: WeeklyPlanRequest): Promise<WeeklyPlanResponse> {
    // Use the new OR-Tools weekly task solver instead of legacy weekly-plan
    const solverRequest = {
      week_start_date: planRequest.week_start_date,
      constraints: {
        total_capacity_hours: planRequest.capacity_hours,
        deadline_weight: 0.4,
        project_balance_weight: 0.3,
        effort_efficiency_weight: 0.3,
      },
      project_filter: planRequest.project_filter,
      selected_recurring_task_ids: planRequest.selected_recurring_task_ids || [],
      preferences: planRequest.preferences || {},
      user_prompt: planRequest.user_prompt,
      use_ai_priority: planRequest.use_ai_priority || false,
    };

    const solverResponse = await this.request<any>('/api/ai/weekly-task-solver', {
      method: 'POST',
      body: JSON.stringify(solverRequest),
    });

    // Convert TaskSolverResponse to WeeklyPlanResponse format for compatibility
    return {
      success: solverResponse.success,
      week_start_date: solverResponse.week_start_date,
      total_planned_hours: solverResponse.total_allocated_hours,
      task_plans: solverResponse.selected_tasks || [],
      recommendations: [], // TaskSolver doesn't have recommendations
      insights: solverResponse.optimization_insights || [],
      project_allocations: solverResponse.project_allocations || [],
      constraint_analysis: solverResponse.constraint_analysis,
      solver_metrics: solverResponse.solver_metrics,
      generated_at: solverResponse.generated_at,
    };
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

  async getWeeklyScheduleOptions(): Promise<import('@/types/ai-planning').WeeklyScheduleOption[]> {
    return this.request<import('@/types/ai-planning').WeeklyScheduleOption[]>('/api/schedule/weekly-schedule-options');
  }

  // Log API methods
  async getLogsByTask(taskId: string, skip: number = 0, limit: number = 20): Promise<Log[]> {
    return this.request<Log[]>(`/api/logs/task/${taskId}?skip=${skip}&limit=${limit}`);
  }

  async getLogsBatch(taskIds: string[], skip: number = 0, limit: number = 20): Promise<Record<string, Log[]>> {
    if (taskIds.length === 0) {
      return {};
    }
    const taskIdsParam = taskIds.join(',');
    return this.request<Record<string, Log[]>>(`/api/logs/batch?task_ids=${taskIdsParam}&skip=${skip}&limit=${limit}`);
  }

  async getLog(logId: string): Promise<Log> {
    return this.request<Log>(`/api/logs/${logId}`);
  }

  async createLog(logData: LogCreate): Promise<Log> {
    return this.request<Log>('/api/logs/', {
      method: 'POST',
      body: JSON.stringify(logData),
    });
  }

  async updateLog(logId: string, logData: LogUpdate): Promise<Log> {
    return this.request<Log>(`/api/logs/${logId}`, {
      method: 'PUT',
      body: JSON.stringify(logData),
    });
  }

  async deleteLog(logId: string): Promise<void> {
    return this.request<void>(`/api/logs/${logId}`, {
      method: 'DELETE',
    });
  }

  // Progress API methods
  async getProjectProgress(projectId: string): Promise<ProjectProgress> {
    return this.request<ProjectProgress>(`/api/progress/project/${projectId}`);
  }

  async getGoalProgress(goalId: string): Promise<GoalProgress> {
    return this.request<GoalProgress>(`/api/progress/goal/${goalId}`);
  }

  async getTaskProgress(taskId: string): Promise<TaskProgress> {
    return this.request<TaskProgress>(`/api/progress/task/${taskId}`);
  }

  // Weekly Schedule API methods
  async getWeeklySchedules(skip = 0, limit = 30): Promise<SavedWeeklySchedule[]> {
    return this.request<SavedWeeklySchedule[]>(`/api/weekly-schedule/list?skip=${skip}&limit=${limit}`);
  }

  async getWeeklySchedule(weekStartDate: string): Promise<SavedWeeklySchedule> {
    return this.request<SavedWeeklySchedule>(`/api/weekly-schedule/${weekStartDate}`);
  }

  async saveWeeklySchedule(weekStartDate: string, scheduleData: any): Promise<SavedWeeklySchedule> {
    return this.request<SavedWeeklySchedule>('/api/weekly-schedule/save', {
      method: 'POST',
      body: JSON.stringify({
        week_start_date: weekStartDate,
        schedule_data: scheduleData,
      }),
    });
  }

  async deleteWeeklySchedule(weekStartDate: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/weekly-schedule/${weekStartDate}`, {
      method: 'DELETE',
    });
  }


  // Timeline API methods
  async getProjectTimeline(projectId: string, startDate?: string, endDate?: string, timeUnit?: string, weeklyWorkHours?: number): Promise<ProjectTimelineData> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (timeUnit) params.append('time_unit', timeUnit);
    if (weeklyWorkHours !== undefined) params.append('weekly_work_hours', weeklyWorkHours.toString());

    return this.request<ProjectTimelineData>(`/api/timeline/projects/${projectId}?${params.toString()}`);
  }

  async getTimelineOverview(startDate?: string, endDate?: string): Promise<TimelineOverviewData> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    return this.request<TimelineOverviewData>(`/api/timeline/overview?${params.toString()}`);
  }

  // Weekly Recurring Tasks
  async getWeeklyRecurringTasks(
    skip: number = 0,
    limit: number = 20,
    category?: string,
    isActive?: boolean
  ): Promise<WeeklyRecurringTask[]> {
    const params = new URLSearchParams();
    if (skip) params.append('skip', skip.toString());
    if (limit) params.append('limit', limit.toString());
    if (category) params.append('category', category);
    if (isActive !== undefined) params.append('is_active', isActive.toString());

    return this.request<WeeklyRecurringTask[]>(`/api/weekly-recurring-tasks?${params.toString()}`);
  }

  async getWeeklyRecurringTask(taskId: string): Promise<WeeklyRecurringTask> {
    return this.request<WeeklyRecurringTask>(`/api/weekly-recurring-tasks/${taskId}`);
  }

  async createWeeklyRecurringTask(taskData: WeeklyRecurringTaskCreate): Promise<WeeklyRecurringTask> {
    return this.request<WeeklyRecurringTask>('/api/weekly-recurring-tasks', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
  }

  async updateWeeklyRecurringTask(
    taskId: string,
    taskData: WeeklyRecurringTaskUpdate
  ): Promise<WeeklyRecurringTask> {
    return this.request<WeeklyRecurringTask>(`/api/weekly-recurring-tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
  }

  async deleteWeeklyRecurringTask(taskId: string): Promise<void> {
    return this.request<void>(`/api/weekly-recurring-tasks/${taskId}`, {
      method: 'DELETE',
    });
  }
}

export const apiClient = new ApiClient();

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
  addDependency: (data: GoalDependencyCreate) => apiClient.addGoalDependency(data),
  getDependencies: (goalId: string) => apiClient.getGoalDependencies(goalId),
  deleteDependency: (dependencyId: string) => apiClient.deleteGoalDependency(dependencyId),
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
  addDependency: (taskId: string, dependsOnTaskId: string) =>
    apiClient.addTaskDependency(taskId, dependsOnTaskId),
  getDependencies: (taskId: string) => apiClient.getTaskDependencies(taskId),
  deleteDependency: (taskId: string, dependencyId: string) =>
    apiClient.deleteTaskDependency(taskId, dependencyId),
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
  getWeeklyScheduleOptions: () => apiClient.getWeeklyScheduleOptions(),
};

export const logsApi = {
  getByTask: (taskId: string, skip?: number, limit?: number) =>
    apiClient.getLogsByTask(taskId, skip, limit),
  getBatch: (taskIds: string[], skip?: number, limit?: number) =>
    apiClient.getLogsBatch(taskIds, skip, limit),
  getById: (id: string) => apiClient.getLog(id),
  create: (data: LogCreate) => apiClient.createLog(data),
  update: (id: string, data: LogUpdate) => apiClient.updateLog(id, data),
  delete: (id: string) => apiClient.deleteLog(id),
};

export const progressApi = {
  getProject: (projectId: string) => apiClient.getProjectProgress(projectId),
  getGoal: (goalId: string) => apiClient.getGoalProgress(goalId),
  getTask: (taskId: string) => apiClient.getTaskProgress(taskId),
};

export const weeklyScheduleApi = {
  getAll: (skip?: number, limit?: number) => apiClient.getWeeklySchedules(skip, limit),
  getByWeek: (weekStartDate: string) => apiClient.getWeeklySchedule(weekStartDate),
  save: (weekStartDate: string, scheduleData: any) => apiClient.saveWeeklySchedule(weekStartDate, scheduleData),
  delete: (weekStartDate: string) => apiClient.deleteWeeklySchedule(weekStartDate),
};

export const weeklyRecurringTasksApi = {
  getAll: (skip?: number, limit?: number, category?: string, isActive?: boolean) =>
    apiClient.getWeeklyRecurringTasks(skip, limit, category, isActive),
  getById: (taskId: string) => apiClient.getWeeklyRecurringTask(taskId),
  create: (taskData: WeeklyRecurringTaskCreate) => apiClient.createWeeklyRecurringTask(taskData),
  update: (taskId: string, taskData: WeeklyRecurringTaskUpdate) => apiClient.updateWeeklyRecurringTask(taskId, taskData),
  delete: (taskId: string) => apiClient.deleteWeeklyRecurringTask(taskId),
};


export const timelineApi = {
  getProjectTimeline: (projectId: string, startDate?: string, endDate?: string, timeUnit?: string, weeklyWorkHours?: number) =>
    apiClient.getProjectTimeline(projectId, startDate, endDate, timeUnit, weeklyWorkHours),
  getOverview: (startDate?: string, endDate?: string) =>
    apiClient.getTimelineOverview(startDate, endDate),
};

// Export helper function for getting secure API URL
export const getSecureApiUrl = (): string => {
  const baseUrl = getApiBaseUrl();
  const secureUrl = ensureHttps(baseUrl);
  console.log(`🔗 getSecureApiUrl: ${baseUrl} -> ${secureUrl}`);
  return secureUrl;
};

// Secure fetch wrapper that enforces HTTPS
export const secureFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // Force HTTPS on the URL at fetch time
  const secureUrl = ensureHttps(url);
  console.log(`🛡️ secureFetch: ${url} -> ${secureUrl}`);

  // Add additional security headers
  const secureOptions: RequestInit = {
    ...options,
    // Force HTTPS in request
    headers: {
      ...options.headers,
      'Upgrade-Insecure-Requests': '1',
    },
  };

  return fetch(secureUrl, secureOptions);
};
