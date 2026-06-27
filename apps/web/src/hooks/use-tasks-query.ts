import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_TASK_PAGE_LIMIT, tasksApi } from '@/lib/api'
import type { QueryClient, Query } from '@tanstack/react-query'
import type { Task, TaskCreate, TaskUpdate, TaskDependency } from '@/types/task'
import type { SortOptions } from '@/types/sort'

/**
 * Query keys for task caching with React Query.
 * Provides consistent cache key structure for all task-related queries.
 */
export const taskKeys = {
  all: ['tasks'] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  byGoal: (goalId: string) => [...taskKeys.all, 'goal', goalId] as const,
  byProject: (projectId: string) => [...taskKeys.all, 'project', projectId] as const,
}

const isTaskGoalQuery = (query: Query) =>
  query.queryKey[0] === taskKeys.all[0] && query.queryKey[1] === 'goal'

const isTaskProjectQuery = (query: Query) =>
  query.queryKey[0] === taskKeys.all[0] && query.queryKey[1] === 'project'

const invalidateTaskCollections = (queryClient: QueryClient, goalId?: string) => {
  if (goalId) {
    queryClient.invalidateQueries({ queryKey: taskKeys.byGoal(goalId) })
  } else {
    queryClient.invalidateQueries({ predicate: isTaskGoalQuery })
  }

  queryClient.invalidateQueries({ predicate: isTaskProjectQuery })
}

const updateTaskInList = (
  data: unknown,
  taskId: string,
  updateTask: (task: Task) => Task
) => {
  if (!Array.isArray(data)) {
    return data
  }

  return data.map((task) => {
    if (!task || typeof task !== 'object' || (task as Task).id !== taskId) {
      return task
    }

    return updateTask(task as Task)
  })
}

const updateTaskCaches = (
  queryClient: QueryClient,
  task: Task,
  updateTask: (task: Task) => Task
) => {
  queryClient.setQueryData<Task>(taskKeys.detail(task.id), (cachedTask) =>
    updateTask(cachedTask ?? task)
  )

  queryClient.setQueriesData(
    { queryKey: taskKeys.byGoal(task.goal_id) },
    (data) => updateTaskInList(data, task.id, updateTask)
  )

  queryClient.setQueriesData(
    { predicate: isTaskProjectQuery },
    (data) => updateTaskInList(data, task.id, updateTask)
  )
}

/**
 * Fetches tasks for a specific goal with pagination and sorting.
 *
 * @param goalId - The goal UUID to fetch tasks for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 100)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with task array
 */
export function useTasksByGoal(goalId: string, skip = 0, limit = DEFAULT_TASK_PAGE_LIMIT, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: [...taskKeys.byGoal(goalId), 'page', skip, limit, sortKey],
    queryFn: () => tasksApi.getByGoal(goalId, skip, limit, sortOptions),
    enabled: !!goalId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Fetches every task for a goal by walking the paginated API.
 *
 * @param goalId - The goal UUID to fetch tasks for
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with the complete task array
 */
export function useAllTasksByGoal(goalId: string, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';

  return useQuery({
    queryKey: [...taskKeys.byGoal(goalId), 'all', DEFAULT_TASK_PAGE_LIMIT, sortKey],
    queryFn: async () => {
      const tasks: Task[] = [];
      let skip = 0;

      while (true) {
        const page = await tasksApi.getByGoal(goalId, skip, DEFAULT_TASK_PAGE_LIMIT, sortOptions);
        tasks.push(...page);

        if (page.length < DEFAULT_TASK_PAGE_LIMIT) {
          return tasks;
        }

        skip += DEFAULT_TASK_PAGE_LIMIT;
      }
    },
    enabled: !!goalId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Fetches tasks for a specific project with pagination and sorting.
 *
 * @param projectId - The project UUID to fetch tasks for
 * @param skip - Number of records to skip (default: 0)
 * @param limit - Maximum records to return (default: 100)
 * @param sortOptions - Optional sorting configuration
 * @returns UseQueryResult with task array
 */
export function useTasksByProject(projectId: string, skip = 0, limit = DEFAULT_TASK_PAGE_LIMIT, sortOptions?: SortOptions) {
  const sortKey = sortOptions ? `sort-${sortOptions.sortBy}-${sortOptions.sortOrder}` : 'default';
  return useQuery({
    queryKey: [...taskKeys.byProject(projectId), 'page', skip, limit, sortKey],
    queryFn: () => tasksApi.getByProject(projectId, skip, limit, sortOptions),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Fetches a single task by ID.
 *
 * @param taskId - The task UUID to fetch
 * @returns UseQueryResult with task data
 */
export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => tasksApi.getById(taskId),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Mutation hook for creating a new task.
 * Automatically invalidates task cache for the goal on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskData: TaskCreate) => tasksApi.create(taskData),
    onSuccess: (newTask: Task) => {
      invalidateTaskCollections(queryClient, newTask.goal_id)

      // Add the new task to cache
      queryClient.setQueryData(
        taskKeys.detail(newTask.id),
        newTask
      )
    },
  })
}

/**
 * Mutation hook for updating a task.
 * Updates cache and invalidates task collections on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaskUpdate }) =>
      tasksApi.update(id, data),
    onSuccess: (updatedTask: Task) => {
      // Update the cached task
      queryClient.setQueryData(
        taskKeys.detail(updatedTask.id),
        updatedTask
      )

      // Invalidate task collections to reflect changes in goal and project views.
      invalidateTaskCollections(queryClient, updatedTask.goal_id)
    },
  })
}

/**
 * Mutation hook for deleting a task.
 * Removes from cache and invalidates task collections on success.
 *
 * @returns UseMutationResult with mutateAsync function
 */
export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => tasksApi.delete(taskId),
    onSuccess: (_, taskId) => {
      // Get the task from cache to know which goal to invalidate
      const cachedTask = queryClient.getQueryData<Task>(taskKeys.detail(taskId))
      const goalId = cachedTask?.goal_id

      // Remove task from cache immediately
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) })

      invalidateTaskCollections(queryClient, goalId)
    },
  })
}

/**
 * Mutation hook for adding a dependency to a task.
 * Keeps task detail/collection caches fresh and invalidates goal/project task views.
 */
export function useAddTaskDependency(task: Task, availableTasks: Task[] = []) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (dependsOnTaskId: string) => tasksApi.addDependency(task.id, dependsOnTaskId),
    onSuccess: (dependency: TaskDependency, dependsOnTaskId) => {
      const dependsOnTask = availableTasks.find((availableTask) => availableTask.id === dependsOnTaskId)
      const hydratedDependency: TaskDependency = {
        ...dependency,
        depends_on_task: dependency.depends_on_task ?? (dependsOnTask
          ? {
              id: dependsOnTask.id,
              title: dependsOnTask.title,
              status: dependsOnTask.status,
            }
          : null),
      }

      updateTaskCaches(queryClient, task, (cachedTask) => ({
        ...cachedTask,
        dependencies: [
          ...(cachedTask.dependencies ?? []).filter(
            (existingDependency) => existingDependency.id !== hydratedDependency.id
          ),
          hydratedDependency,
        ],
      }))

      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.id) })
      invalidateTaskCollections(queryClient, task.goal_id)
    },
  })
}

/**
 * Mutation hook for deleting a dependency from a task.
 * Keeps task detail/collection caches fresh and invalidates goal/project task views.
 */
export function useDeleteTaskDependency(task: Task) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (dependencyId: string) => tasksApi.deleteDependency(task.id, dependencyId),
    onSuccess: (_, dependencyId) => {
      updateTaskCaches(queryClient, task, (cachedTask) => ({
        ...cachedTask,
        dependencies: (cachedTask.dependencies ?? []).filter(
          (dependency) => dependency.id !== dependencyId
        ),
      }))

      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.id) })
      invalidateTaskCollections(queryClient, task.goal_id)
    },
  })
}
