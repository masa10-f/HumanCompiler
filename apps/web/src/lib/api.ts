import { supabase } from './supabase';
import { ApiError, NetworkError, logError } from './errors';
import { getApiEndpoint, appConfig, safeLog } from './config';
import { fetchWithFallback } from './fetch-with-fallback';
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
  WeeklyScheduleData,
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
import type {
  WorkSession,
  WorkSessionStartRequest,
  WorkSessionCheckoutRequest,
  WorkSessionUpdateRequest,
  WorkSessionResumeRequest,
} from '@/types/work-session';
import type {
  RescheduleSuggestion,
  RescheduleDecision,
  RescheduleDecisionRequest,
  WorkSessionWithReschedule
} from '@/types/reschedule';
import type { SortOptions } from '@/types/sort';
import type {
  ContextNote,
  ContextNoteUpdate
} from '@/types/context-note';

// Helper function to ensure HTTPS protocol
const ensureHttps = (url: string): string => {
  if (!url) return url;

  // Force HTTPS for production API endpoints
  if (appConfig.security.enforceHttps && url.startsWith('http://')) {
    const httpsUrl = url.replace('http://', 'https://');
    safeLog('info', `🔒 ensureHttps: Converting ${url} to ${httpsUrl}`);
    return httpsUrl;
  }

  return url;
};

// Note: getApiBaseUrl removed - use getApiEndpoint() directly

/**
 * API Client for HumanCompiler backend communication.
 * Handles authentication headers, error handling, and HTTPS enforcement.
 * Uses fetchWithFallback for retry logic and timeout handling.
 */
class ApiClient {
  private getBaseURL(): string {
    const url = getApiEndpoint();
    safeLog('debug', `🔗 ApiClient.getBaseURL() returning: ${url}`);
    return url;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    safeLog('debug', '🔍 [ApiClient] Getting Supabase session...');

    // Try to refresh the session first
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      safeLog('error', '❌ [ApiClient] Supabase auth error:', error);
      throw new Error('Authentication error');
    }

    if (!session?.access_token) {
      safeLog('error', '❌ [ApiClient] No access token found');
      throw new Error('User not authenticated');
    }

    // Check if token is expired and refresh if needed
    if (session.expires_at && Date.now() / 1000 > session.expires_at - 60) {
      safeLog('debug', '🔄 [ApiClient] Token expiring soon, refreshing...');
      const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError || !refreshedSession.session) {
        safeLog('error', '❌ [ApiClient] Failed to refresh token:', refreshError);
        throw new Error('Failed to refresh authentication');
      }

      safeLog('info', '✅ [ApiClient] Token refreshed successfully');
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshedSession.session.access_token}`,
      };
    }

    safeLog('debug', '✅ [ApiClient] Auth headers prepared');
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

    safeLog('debug', '🔍 [ApiClient] Starting request:', context);

    try {
      safeLog('debug', '🔍 [ApiClient] Getting auth headers...');
      const headers = await this.getAuthHeaders();
      safeLog('debug', '✅ [ApiClient] Auth headers obtained');

      // Use enhanced fetch with fallback
      const response = await fetchWithFallback(endpoint, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
        timeout: appConfig.api.timeout,
        maxRetries: appConfig.api.retryAttempts,
        retryDelay: appConfig.api.retryDelay,
      });

      safeLog('debug', '🔍 [ApiClient] Response received:', {
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
        safeLog('debug', '✅ [ApiClient] 204 No Content response');
        return {} as T;
      }

      safeLog('debug', '🔍 [ApiClient] Parsing JSON response...');
      const responseData = await response.json();
      safeLog('debug', '✅ [ApiClient] JSON response parsed successfully');
      return responseData;
    } catch (error) {
      // If it's already an ApiError or NetworkError, re-throw it
      if (error instanceof ApiError || error instanceof NetworkError) {
        throw error;
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

  // === Project API methods ===

  /**
   * Fetches all projects for the authenticated user.
   *
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @param sortOptions - Sorting configuration
   * @returns Array of Project objects
   */
  async getProjects(skip: number = 0, limit: number = 20, sortOptions?: SortOptions): Promise<Project[]> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    if (sortOptions?.sortBy) {
      params.set('sort_by', sortOptions.sortBy);
    }
    if (sortOptions?.sortOrder) {
      params.set('sort_order', sortOptions.sortOrder);
    }

    return this.request<Project[]>(`/api/projects/?${params.toString()}`);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/api/projects/${projectId}/`);
  }

  async createProject(projectData: ProjectCreate): Promise<Project> {
    return this.request<Project>('/api/projects/', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async updateProject(projectId: string, projectData: ProjectUpdate): Promise<Project> {
    return this.request<Project>(`/api/projects/${projectId}/`, {
      method: 'PUT',
      body: JSON.stringify(projectData),
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.request<void>(`/api/projects/${projectId}/`, {
      method: 'DELETE',
    });
  }

  // === Goal API methods ===

  /**
   * Fetches goals for a specific project.
   *
   * @param projectId - The project UUID
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @param sortOptions - Sorting configuration
   * @returns Array of Goal objects
   */
  async getGoalsByProject(projectId: string, skip: number = 0, limit: number = 20, sortOptions?: SortOptions): Promise<Goal[]> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    if (sortOptions?.sortBy) {
      params.set('sort_by', sortOptions.sortBy);
    }
    if (sortOptions?.sortOrder) {
      params.set('sort_order', sortOptions.sortOrder);
    }

    return this.request<Goal[]>(`/api/goals/project/${projectId}?${params.toString()}`);
  }

  async getGoal(goalId: string): Promise<Goal> {
    return this.request<Goal>(`/api/goals/${goalId}/`);
  }

  async createGoal(goalData: GoalCreate): Promise<Goal> {
    return this.request<Goal>('/api/goals/', {
      method: 'POST',
      body: JSON.stringify(goalData),
    });
  }

  async updateGoal(goalId: string, goalData: GoalUpdate): Promise<Goal> {
    return this.request<Goal>(`/api/goals/${goalId}/`, {
      method: 'PUT',
      body: JSON.stringify(goalData),
    });
  }

  async deleteGoal(goalId: string): Promise<void> {
    return this.request<void>(`/api/goals/${goalId}/`, {
      method: 'DELETE',
    });
  }

  // === Goal dependency methods ===

  /**
   * Creates a dependency relationship between goals.
   *
   * @param dependencyData - Dependency creation data
   * @returns Created GoalDependency object
   */
  async addGoalDependency(dependencyData: GoalDependencyCreate): Promise<GoalDependency> {
    return this.request<GoalDependency>('/api/goal-dependencies/', {
      method: 'POST',
      body: JSON.stringify(dependencyData),
    });
  }

  async getGoalDependencies(goalId: string): Promise<GoalDependency[]> {
    return this.request<GoalDependency[]>(`/api/goal-dependencies/goal/${goalId}/`);
  }

  async deleteGoalDependency(dependencyId: string): Promise<void> {
    return this.request<void>(`/api/goal-dependencies/${dependencyId}/`, {
      method: 'DELETE',
    });
  }

  // === Task API methods ===

  /**
   * Fetches tasks for a specific goal.
   *
   * @param goalId - The goal UUID
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @param sortOptions - Sorting configuration
   * @returns Array of Task objects
   */
  async getTasksByGoal(goalId: string, skip: number = 0, limit: number = 20, sortOptions?: SortOptions): Promise<Task[]> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    if (sortOptions?.sortBy) {
      params.set('sort_by', sortOptions.sortBy);
    }
    if (sortOptions?.sortOrder) {
      params.set('sort_order', sortOptions.sortOrder);
    }

    return this.request<Task[]>(`/api/tasks/goal/${goalId}?${params.toString()}`);
  }

  async getTasksByProject(projectId: string, skip: number = 0, limit: number = 20, sortOptions?: SortOptions): Promise<Task[]> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    if (sortOptions?.sortBy) {
      params.set('sort_by', sortOptions.sortBy);
    }
    if (sortOptions?.sortOrder) {
      params.set('sort_order', sortOptions.sortOrder);
    }

    return this.request<Task[]>(`/api/tasks/project/${projectId}?${params.toString()}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}/`);
  }

  async createTask(taskData: TaskCreate): Promise<Task> {
    return this.request<Task>('/api/tasks/', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
  }

  async updateTask(taskId: string, taskData: TaskUpdate): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}/`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    return this.request<void>(`/api/tasks/${taskId}/`, {
      method: 'DELETE',
    });
  }

  // === Task dependency methods ===

  /**
   * Creates a dependency relationship between tasks.
   *
   * @param taskId - The dependent task UUID
   * @param dependsOnTaskId - The prerequisite task UUID
   * @returns Created TaskDependency object
   */
  async addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDependency> {
    return this.request<TaskDependency>(`/api/tasks/${taskId}/dependencies/`, {
      method: 'POST',
      body: JSON.stringify({
        depends_on_task_id: dependsOnTaskId,
      }),
    });
  }

  async getTaskDependencies(taskId: string): Promise<TaskDependency[]> {
    return this.request<TaskDependency[]>(`/api/tasks/${taskId}/dependencies/`);
  }

  async deleteTaskDependency(taskId: string, dependencyId: string): Promise<void> {
    return this.request<void>(`/api/tasks/${taskId}/dependencies/${dependencyId}/`, {
      method: 'DELETE',
    });
  }

  // === AI Planning API methods ===

  /**
   * Generates a weekly task plan using OR-Tools optimizer.
   *
   * @param planRequest - Weekly plan request configuration
   * @returns Optimized weekly plan response
   */
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

    const solverResponse = await this.request<WeeklyScheduleData>('/api/ai/weekly-task-solver', {
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

  // === Scheduling API methods ===

  /**
   * Optimizes daily schedule using constraint solver.
   *
   * @param scheduleRequest - Schedule optimization request
   * @returns Optimized schedule result
   */
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
    return this.request<DailySchedule>(`/api/schedule/daily/${date}/`);
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

  // === Log API methods ===

  /**
   * Fetches logs for a specific task.
   *
   * @param taskId - The task UUID
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @returns Array of Log objects
   */
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
    return this.request<Log>(`/api/logs/${logId}/`);
  }

  async createLog(logData: LogCreate): Promise<Log> {
    return this.request<Log>('/api/logs/', {
      method: 'POST',
      body: JSON.stringify(logData),
    });
  }

  async updateLog(logId: string, logData: LogUpdate): Promise<Log> {
    return this.request<Log>(`/api/logs/${logId}/`, {
      method: 'PUT',
      body: JSON.stringify(logData),
    });
  }

  async deleteLog(logId: string): Promise<void> {
    return this.request<void>(`/api/logs/${logId}/`, {
      method: 'DELETE',
    });
  }

  // === Progress API methods ===

  /**
   * Fetches progress data for a project.
   *
   * @param projectId - The project UUID
   * @returns Project progress metrics
   */
  async getProjectProgress(projectId: string): Promise<ProjectProgress> {
    return this.request<ProjectProgress>(`/api/progress/project/${projectId}/`);
  }

  async getGoalProgress(goalId: string): Promise<GoalProgress> {
    return this.request<GoalProgress>(`/api/progress/goal/${goalId}/`);
  }

  async getTaskProgress(taskId: string): Promise<TaskProgress> {
    return this.request<TaskProgress>(`/api/progress/task/${taskId}/`);
  }

  // === Weekly Schedule API methods ===

  /**
   * Fetches saved weekly schedules.
   *
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 30)
   * @returns Array of saved weekly schedules
   */
  async getWeeklySchedules(skip = 0, limit = 30): Promise<SavedWeeklySchedule[]> {
    return this.request<SavedWeeklySchedule[]>(`/api/weekly-schedule/list?skip=${skip}&limit=${limit}`);
  }

  async getWeeklySchedule(weekStartDate: string): Promise<SavedWeeklySchedule> {
    return this.request<SavedWeeklySchedule>(`/api/weekly-schedule/${weekStartDate}/`);
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
    return this.request<{ message: string }>(`/api/weekly-schedule/${weekStartDate}/`, {
      method: 'DELETE',
    });
  }


  // === Timeline API methods ===

  /**
   * Fetches timeline data for a project.
   *
   * @param projectId - The project UUID
   * @param startDate - Optional filter start date
   * @param endDate - Optional filter end date
   * @param timeUnit - Time granularity (day, week, month)
   * @param weeklyWorkHours - Weekly capacity hours
   * @param sortOptions - Sorting configuration
   * @returns Project timeline data
   */
  async getProjectTimeline(
    projectId: string,
    startDate?: string,
    endDate?: string,
    timeUnit?: string,
    weeklyWorkHours?: number,
    sortOptions?: SortOptions
  ): Promise<ProjectTimelineData> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (timeUnit) params.append('time_unit', timeUnit);
    if (weeklyWorkHours !== undefined) params.append('weekly_work_hours', weeklyWorkHours.toString());
    if (sortOptions?.sortBy) params.append('sort_by', sortOptions.sortBy);
    if (sortOptions?.sortOrder) params.append('sort_order', sortOptions.sortOrder);

    return this.request<ProjectTimelineData>(`/api/timeline/projects/${projectId}/?${params.toString()}`);
  }

  async getTimelineOverview(startDate?: string, endDate?: string): Promise<TimelineOverviewData> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    return this.request<TimelineOverviewData>(`/api/timeline/overview?${params.toString()}`);
  }

  // === Reports API methods ===

  /**
   * Generates a weekly progress report.
   *
   * @param weekStartDate - Start date of the week (YYYY-MM-DD)
   * @param projectIds - Optional project IDs to filter
   * @returns Weekly report data
   */
  async generateWeeklyReport(weekStartDate: string, projectIds?: string[]): Promise<import('@/types/reports').WeeklyReportResponse> {
    const body: any = { week_start_date: weekStartDate };
    if (projectIds && projectIds.length > 0) {
      body.project_ids = projectIds;
    }
    return this.request<import('@/types/reports').WeeklyReportResponse>('/api/reports/weekly', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // === Weekly Recurring Tasks ===

  /**
   * Fetches weekly recurring task templates.
   *
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @param category - Optional category filter
   * @param isActive - Optional active status filter
   * @returns Array of recurring task templates
   */
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
    return this.request<WeeklyRecurringTask>(`/api/weekly-recurring-tasks/${taskId}/`);
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
    return this.request<WeeklyRecurringTask>(`/api/weekly-recurring-tasks/${taskId}/`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
  }

  async deleteWeeklyRecurringTask(taskId: string): Promise<void> {
    return this.request<void>(`/api/weekly-recurring-tasks/${taskId}/`, {
      method: 'DELETE',
    });
  }

  // === Work Sessions ===

  /**
   * Start a new work session for a task.
   * Only one active session per user is allowed.
   *
   * @param data - Session start data including task_id and planned_checkout_at
   * @returns The created work session
   */
  async startWorkSession(data: WorkSessionStartRequest): Promise<WorkSession> {
    return this.request<WorkSession>('/api/work-sessions/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Checkout (end) the current active session.
   * Creates a log entry automatically.
   *
   * @param data - Checkout data including decision and optional KPT
   * @returns The updated session with generated log
   */
  async checkoutWorkSession(data: WorkSessionCheckoutRequest): Promise<WorkSessionWithReschedule> {
    return this.request<WorkSessionWithReschedule>('/api/work-sessions/checkout', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // === Reschedule API (Issue #227) ===

  /**
   * Get pending reschedule suggestions.
   *
   * @returns Array of pending reschedule suggestions
   */
  async getPendingRescheduleSuggestions(): Promise<RescheduleSuggestion[]> {
    return this.request<RescheduleSuggestion[]>('/api/reschedule/suggestions');
  }

  /**
   * Get a specific reschedule suggestion.
   *
   * @param suggestionId - The suggestion ID
   * @returns The reschedule suggestion
   */
  async getRescheduleSuggestion(suggestionId: string): Promise<RescheduleSuggestion> {
    return this.request<RescheduleSuggestion>(`/api/reschedule/suggestions/${suggestionId}`);
  }

  /**
   * Accept a reschedule suggestion.
   *
   * @param suggestionId - The suggestion ID to accept
   * @param reason - Optional reason for accepting
   * @returns The updated suggestion
   */
  async acceptRescheduleSuggestion(
    suggestionId: string,
    reason?: string
  ): Promise<RescheduleSuggestion> {
    const body: RescheduleDecisionRequest = reason ? { reason } : {};
    return this.request<RescheduleSuggestion>(
      `/api/reschedule/suggestions/${suggestionId}/accept`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * Reject a reschedule suggestion.
   *
   * @param suggestionId - The suggestion ID to reject
   * @param reason - Optional reason for rejecting
   * @returns The updated suggestion
   */
  async rejectRescheduleSuggestion(
    suggestionId: string,
    reason?: string
  ): Promise<RescheduleSuggestion> {
    const body: RescheduleDecisionRequest = reason ? { reason } : {};
    return this.request<RescheduleSuggestion>(
      `/api/reschedule/suggestions/${suggestionId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * Get reschedule decision history.
   *
   * @param limit - Maximum results (default: 50)
   * @returns Array of reschedule decisions
   */
  async getRescheduleDecisionHistory(limit: number = 50): Promise<RescheduleDecision[]> {
    return this.request<RescheduleDecision[]>(`/api/reschedule/decisions?limit=${limit}`);
  }

  /**
   * Get the current active session for the authenticated user.
   *
   * @returns The active session or null if none exists
   */
  async getCurrentWorkSession(): Promise<WorkSession | null> {
    return this.request<WorkSession | null>('/api/work-sessions/current');
  }

  /**
   * Get session history for the authenticated user.
   *
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @returns Array of work sessions
   */
  async getWorkSessionHistory(skip: number = 0, limit: number = 20): Promise<WorkSession[]> {
    return this.request<WorkSession[]>(`/api/work-sessions/history?skip=${skip}&limit=${limit}`);
  }

  /**
   * Get sessions for a specific task.
   *
   * @param taskId - The task ID
   * @param skip - Pagination offset (default: 0)
   * @param limit - Maximum results (default: 20)
   * @returns Array of work sessions for the task
   */
  async getWorkSessionsByTask(
    taskId: string,
    skip: number = 0,
    limit: number = 20
  ): Promise<WorkSession[]> {
    return this.request<WorkSession[]>(
      `/api/work-sessions/task/${taskId}?skip=${skip}&limit=${limit}`
    );
  }

  /**
   * Update a work session's KPT fields.
   *
   * @param sessionId - The session ID to update
   * @param data - KPT update data
   * @returns The updated work session
   */
  async updateWorkSession(
    sessionId: string,
    data: WorkSessionUpdateRequest
  ): Promise<WorkSession> {
    return this.request<WorkSession>(`/api/work-sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get unresponsive session for the authenticated user (Issue #228).
   * Returns the oldest unresponsive session that needs checkout.
   *
   * @returns Unresponsive session or null if none exists
   */
  async getUnresponsiveSession(): Promise<WorkSession | null> {
    return this.request<WorkSession | null>('/api/work-sessions/unresponsive');
  }

  /**
   * Pause the current active session.
   * Time spent while paused is not counted towards actual work time.
   *
   * @returns The paused work session
   */
  async pauseWorkSession(): Promise<WorkSession> {
    return this.request<WorkSession>('/api/work-sessions/pause', {
      method: 'POST',
    });
  }

  /**
   * Resume a paused session.
   * Optionally extends planned_checkout_at by the pause duration.
   *
   * @param data - Resume options including extend_checkout flag
   * @returns The resumed work session
   */
  async resumeWorkSession(data: WorkSessionResumeRequest = {}): Promise<WorkSession> {
    return this.request<WorkSession>('/api/work-sessions/resume', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // === Context Notes API methods ===

  /**
   * Get or create a note for a project.
   *
   * @param projectId - The project UUID
   * @returns The context note
   */
  async getProjectNote(projectId: string): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/projects/${projectId}`);
  }

  /**
   * Update a project's note.
   *
   * @param projectId - The project UUID
   * @param data - Note update data
   * @returns The updated context note
   */
  async updateProjectNote(projectId: string, data: ContextNoteUpdate): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get or create a note for a goal.
   *
   * @param goalId - The goal UUID
   * @returns The context note
   */
  async getGoalNote(goalId: string): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/goals/${goalId}`);
  }

  /**
   * Update a goal's note.
   *
   * @param goalId - The goal UUID
   * @param data - Note update data
   * @returns The updated context note
   */
  async updateGoalNote(goalId: string, data: ContextNoteUpdate): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/goals/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get or create a note for a task.
   *
   * @param taskId - The task UUID
   * @returns The context note
   */
  async getTaskNote(taskId: string): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/tasks/${taskId}`);
  }

  /**
   * Update a task's note.
   *
   * @param taskId - The task UUID
   * @param data - Note update data
   * @returns The updated context note
   */
  async updateTaskNote(taskId: string, data: ContextNoteUpdate): Promise<ContextNote> {
    return this.request<ContextNote>(`/api/notes/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

export const apiClient = new ApiClient();

// === Convenience API wrappers ===

/**
 * Project API convenience wrapper.
 * Provides simplified methods for project CRUD operations.
 */
export const projectsApi = {
  getAll: (skip?: number, limit?: number, sortOptions?: SortOptions) =>
    apiClient.getProjects(skip, limit, sortOptions),
  getById: (id: string) => apiClient.getProject(id),
  create: (data: ProjectCreate) => apiClient.createProject(data),
  update: (id: string, data: ProjectUpdate) => apiClient.updateProject(id, data),
  delete: (id: string) => apiClient.deleteProject(id),
};

/**
 * Goals API convenience wrapper.
 * Provides methods for goal CRUD and dependency operations.
 */
export const goalsApi = {
  getByProject: (projectId: string, skip?: number, limit?: number, sortOptions?: SortOptions) =>
    apiClient.getGoalsByProject(projectId, skip, limit, sortOptions),
  getById: (id: string) => apiClient.getGoal(id),
  create: (data: GoalCreate) => apiClient.createGoal(data),
  update: (id: string, data: GoalUpdate) => apiClient.updateGoal(id, data),
  delete: (id: string) => apiClient.deleteGoal(id),
  addDependency: (data: GoalDependencyCreate) => apiClient.addGoalDependency(data),
  getDependencies: (goalId: string) => apiClient.getGoalDependencies(goalId),
  deleteDependency: (dependencyId: string) => apiClient.deleteGoalDependency(dependencyId),
};

/**
 * Tasks API convenience wrapper.
 * Provides methods for task CRUD and dependency operations.
 */
export const tasksApi = {
  getByGoal: (goalId: string, skip?: number, limit?: number, sortOptions?: SortOptions) =>
    apiClient.getTasksByGoal(goalId, skip, limit, sortOptions),
  getByProject: (projectId: string, skip?: number, limit?: number, sortOptions?: SortOptions) =>
    apiClient.getTasksByProject(projectId, skip, limit, sortOptions),
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

/**
 * AI Planning API convenience wrapper.
 * Provides methods for AI-powered task planning and workload analysis.
 */
export const aiPlanningApi = {
  generateWeeklyPlan: (request: WeeklyPlanRequest) => apiClient.generateWeeklyPlan(request),
  analyzeWorkload: (projectIds?: string[]) => apiClient.analyzeWorkload(projectIds),
  suggestPriorities: (projectId?: string) => apiClient.suggestTaskPriorities(projectId),
  testIntegration: () => apiClient.testAIIntegration(),
};

/**
 * Scheduling API convenience wrapper.
 * Provides methods for daily schedule optimization.
 */
export const schedulingApi = {
  optimizeDaily: (request: ScheduleRequest) => apiClient.optimizeDailySchedule(request),
  save: (scheduleData: ScheduleResult & { date: string; generated_at: string }) => apiClient.saveDailySchedule(scheduleData),
  getByDate: (date: string) => apiClient.getDailySchedule(date),
  list: (skip?: number, limit?: number) => apiClient.listDailySchedules(skip, limit),
  test: () => apiClient.testScheduler(),
  getWeeklyScheduleOptions: () => apiClient.getWeeklyScheduleOptions(),
};

/**
 * Logs API convenience wrapper.
 * Provides methods for work log CRUD operations.
 */
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

/**
 * Progress API convenience wrapper.
 * Provides methods for fetching progress metrics.
 */
export const progressApi = {
  getProject: (projectId: string) => apiClient.getProjectProgress(projectId),
  getGoal: (goalId: string) => apiClient.getGoalProgress(goalId),
  getTask: (taskId: string) => apiClient.getTaskProgress(taskId),
};

/**
 * Weekly Schedule API convenience wrapper.
 * Provides methods for managing saved weekly schedules.
 */
export const weeklyScheduleApi = {
  getAll: (skip?: number, limit?: number) => apiClient.getWeeklySchedules(skip, limit),
  getByWeek: (weekStartDate: string) => apiClient.getWeeklySchedule(weekStartDate),
  save: (weekStartDate: string, scheduleData: any) => apiClient.saveWeeklySchedule(weekStartDate, scheduleData),
  delete: (weekStartDate: string) => apiClient.deleteWeeklySchedule(weekStartDate),
};

/**
 * Weekly Recurring Tasks API convenience wrapper.
 * Provides methods for managing recurring task templates.
 */
export const weeklyRecurringTasksApi = {
  getAll: (skip?: number, limit?: number, category?: string, isActive?: boolean) =>
    apiClient.getWeeklyRecurringTasks(skip, limit, category, isActive),
  getActive: () => apiClient.getWeeklyRecurringTasks(undefined, undefined, undefined, true),
  getById: (taskId: string) => apiClient.getWeeklyRecurringTask(taskId),
  create: (taskData: WeeklyRecurringTaskCreate) => apiClient.createWeeklyRecurringTask(taskData),
  update: (taskId: string, taskData: WeeklyRecurringTaskUpdate) => apiClient.updateWeeklyRecurringTask(taskId, taskData),
  delete: (taskId: string) => apiClient.deleteWeeklyRecurringTask(taskId),
};

/**
 * Timeline API convenience wrapper.
 * Provides methods for timeline visualization data.
 */
export const timelineApi = {
  getProjectTimeline: (projectId: string, startDate?: string, endDate?: string, timeUnit?: string, weeklyWorkHours?: number, sortOptions?: SortOptions) =>
    apiClient.getProjectTimeline(projectId, startDate, endDate, timeUnit, weeklyWorkHours, sortOptions),
  getOverview: (startDate?: string, endDate?: string) =>
    apiClient.getTimelineOverview(startDate, endDate),
};

/**
 * Reports API convenience wrapper.
 * Provides methods for generating progress reports.
 */
export const reportsApi = {
  generateWeeklyReport: (weekStartDate: string, projectIds?: string[]) =>
    apiClient.generateWeeklyReport(weekStartDate, projectIds),
};

/**
 * Work Sessions API convenience wrapper.
 * Provides methods for Runner/Focus mode session management.
 */
export const workSessionsApi = {
  start: (data: WorkSessionStartRequest) => apiClient.startWorkSession(data),
  checkout: (data: WorkSessionCheckoutRequest) => apiClient.checkoutWorkSession(data),
  getCurrent: () => apiClient.getCurrentWorkSession(),
  getHistory: (skip?: number, limit?: number) => apiClient.getWorkSessionHistory(skip, limit),
  getByTask: (taskId: string, skip?: number, limit?: number) =>
    apiClient.getWorkSessionsByTask(taskId, skip, limit),
  update: (sessionId: string, data: WorkSessionUpdateRequest) =>
    apiClient.updateWorkSession(sessionId, data),
  getUnresponsive: () => apiClient.getUnresponsiveSession(),
  pause: () => apiClient.pauseWorkSession(),
  resume: (data?: WorkSessionResumeRequest) => apiClient.resumeWorkSession(data),
};

/**
 * Reschedule API convenience wrapper (Issue #227).
 * Provides methods for managing reschedule suggestions.
 */
export const rescheduleApi = {
  getPendingSuggestions: () => apiClient.getPendingRescheduleSuggestions(),
  getSuggestion: (suggestionId: string) => apiClient.getRescheduleSuggestion(suggestionId),
  acceptSuggestion: (suggestionId: string, reason?: string) =>
    apiClient.acceptRescheduleSuggestion(suggestionId, reason),
  rejectSuggestion: (suggestionId: string, reason?: string) =>
    apiClient.rejectRescheduleSuggestion(suggestionId, reason),
  getDecisionHistory: (limit?: number) => apiClient.getRescheduleDecisionHistory(limit),
};

/**
 * Context Notes API convenience wrapper.
 * Provides methods for managing rich text notes on projects, goals, and tasks.
 */
export const notesApi = {
  getProjectNote: (projectId: string) => apiClient.getProjectNote(projectId),
  updateProjectNote: (projectId: string, data: ContextNoteUpdate) =>
    apiClient.updateProjectNote(projectId, data),
  getGoalNote: (goalId: string) => apiClient.getGoalNote(goalId),
  updateGoalNote: (goalId: string, data: ContextNoteUpdate) =>
    apiClient.updateGoalNote(goalId, data),
  getTaskNote: (taskId: string) => apiClient.getTaskNote(taskId),
  updateTaskNote: (taskId: string, data: ContextNoteUpdate) =>
    apiClient.updateTaskNote(taskId, data),
};

// === Helper functions ===

// Export helper function for getting secure API URL
export const getSecureApiUrl = (): string => {
  const baseUrl = getApiEndpoint();
  const secureUrl = ensureHttps(baseUrl);
  safeLog('debug', `🔗 getSecureApiUrl: ${baseUrl} -> ${secureUrl}`);
  return secureUrl;
};

// Export helper function for getting properly constructed API URL for fetch calls
export const getApiUrl = (): string => {
  const baseUrl = getApiEndpoint();
  safeLog('debug', `🔒 getApiUrl: returning ${baseUrl}`);
  return baseUrl;
};

// Secure fetch wrapper that enforces HTTPS and includes fallback functionality
export const secureFetch = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
  safeLog('debug', `🛡️ secureFetch called for endpoint: ${endpoint}`);

  // Use the enhanced fetch with fallback
  return fetchWithFallback(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: appConfig.api.timeout,
    maxRetries: appConfig.api.retryAttempts,
    retryDelay: appConfig.api.retryDelay,
  });
};
