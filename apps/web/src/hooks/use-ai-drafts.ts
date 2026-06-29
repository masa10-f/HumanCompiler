import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiPlanningApi } from '@/lib/api';
import { goalKeys } from '@/hooks/use-goals-query';
import { taskKeys } from '@/hooks/use-tasks-query';
import { queryKeys } from '@/lib/query-keys';
import type {
  GoalTaskDraftApplyRequest,
  GoalTaskDraftApplyResponse,
  GoalTaskDraftRequest,
} from '@/types/ai-drafts';

export function useGenerateGoalTaskDraft() {
  return useMutation({
    mutationFn: (request: GoalTaskDraftRequest) =>
      aiPlanningApi.generateGoalTaskDraft(request),
  });
}

export function useStartGoalTaskDraftJob() {
  return useMutation({
    mutationFn: (request: GoalTaskDraftRequest) =>
      aiPlanningApi.startGoalTaskDraftJob(request),
  });
}

export function useApplyGoalTaskDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: GoalTaskDraftApplyRequest) =>
      aiPlanningApi.applyGoalTaskDraft(request),
    onSuccess: (response: GoalTaskDraftApplyResponse, request) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.byProject(request.project_id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.byProject(request.project_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.project(request.project_id) });

      const goalIds = new Set<string>();
      if (request.goal_id) {
        goalIds.add(request.goal_id);
      }
      response.created_goals.forEach((goal) => {
        goalIds.add(goal.id);
        queryClient.setQueryData(goalKeys.detail(goal.id), goal);
      });
      response.created_tasks.forEach((task) => {
        goalIds.add(task.goal_id);
        queryClient.setQueryData(taskKeys.detail(task.id), task);
      });
      goalIds.forEach((goalId) => {
        queryClient.invalidateQueries({ queryKey: taskKeys.byGoal(goalId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.progress.goal(goalId) });
      });
      if (request.task_id) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(request.task_id) });
      }
    },
  });
}
