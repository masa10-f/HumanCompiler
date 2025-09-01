'use client';

import { useEffect, useState, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProject } from '@/hooks/use-project-query';
import { useGoalsByProject } from '@/hooks/use-goals-query';
import { useQuery } from '@tanstack/react-query';
import { progressApi, goalsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GoalFormDialog } from '@/components/goals/goal-form-dialog';
import { GoalEditDialog } from '@/components/goals/goal-edit-dialog';
import { GoalDeleteDialog } from '@/components/goals/goal-delete-dialog';
import { ProjectProgressCard } from '@/components/progress/progress-card';
import { ArrowLeft, Plus, GitBranch } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Goal, GoalStatus } from '@/types/goal';
import { Project, ProjectStatus } from '@/types/project';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGoalStatusIcon,
  getGoalStatusLabel,
  getAllGoalStatuses
} from '@/constants/goal-status';
import {
  getProjectStatusIcon,
  getProjectStatusLabel,
  getAllProjectStatuses
} from '@/constants/project-status';
import { useUpdateProject } from '@/hooks/use-project-query';
import { AppHeader } from '@/components/layout/app-header';

interface ProjectDetailPageProps {
  params: {
    id: string;
  };
}

// Component to display and manage project status
const ProjectStatusDropdown = memo(function ProjectStatusDropdown({ project }: { project: Project }) {
  const updateProjectMutation = useUpdateProject();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    if (newStatus === project.status || isUpdating) return;

    setIsUpdating(true);
    try {
      await updateProjectMutation.mutateAsync({
        id: project.id,
        data: { status: newStatus }
      });

      toast({
        title: 'ステータスを更新しました',
        description: `プロジェクトのステータスを「${getProjectStatusLabel(newStatus)}」に変更しました。`,
      });
    } catch (error) {
      let errorMessage = 'ステータスの更新に失敗しました。';
      let errorTitle = 'エラー';

      const errorStatus = (error as { response?: { status?: number } })?.response?.status;

      if (errorStatus === 404) {
        errorTitle = 'プロジェクトが見つかりません';
        errorMessage = '更新対象のプロジェクトが削除されている可能性があります。';
      } else if (errorStatus === 403) {
        errorTitle = '権限エラー';
        errorMessage = 'このプロジェクトを更新する権限がありません。';
      } else if (errorStatus === 422) {
        errorTitle = '入力エラー';
        errorMessage = '無効なステータス値です。ページを再読み込みしてください。';
      } else if (errorStatus && errorStatus >= 500) {
        errorTitle = 'サーバーエラー';
        errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。';
      } else if (!navigator.onLine) {
        errorTitle = 'ネットワークエラー';
        errorMessage = 'インターネット接続を確認してください。';
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const currentStatus = project.status || 'pending';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          disabled={isUpdating}
        >
          {getProjectStatusIcon(currentStatus)}
          <span className="text-sm">{getProjectStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getAllProjectStatuses().map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() => handleStatusChange(status)}
            className={currentStatus === status ? 'bg-gray-100' : ''}
          >
            <div className="flex items-center gap-2">
              {getProjectStatusIcon(status)}
              <span>{getProjectStatusLabel(status)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// Component to display and manage goal status
const GoalStatusDropdown = memo(function GoalStatusDropdown({ goal }: { goal: Goal }) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: GoalStatus) => {
      return goalsApi.update(goal.id, { status: newStatus });
    },
    onMutate: async (newStatus: GoalStatus) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['goals', 'project', goal.project_id] });
      await queryClient.cancelQueries({ queryKey: ['goal', goal.id] });

      // Snapshot the previous value for rollback
      const previousGoals = queryClient.getQueryData(['goals', 'project', goal.project_id]);
      const previousGoal = queryClient.getQueryData(['goal', goal.id]);

      // Optimistically update to the new value
      queryClient.setQueryData(['goals', 'project', goal.project_id], (old: any) => {
        if (old) {
          return old.map((g: Goal) =>
            g.id === goal.id ? { ...g, status: newStatus } : g
          );
        }
        return old;
      });

      queryClient.setQueryData(['goal', goal.id], (old: Goal | undefined) => {
        if (old) {
          return { ...old, status: newStatus };
        }
        return old;
      });

      // Return context for potential rollback
      return { previousGoals, previousGoal };
    },
    onSuccess: (data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['goals', 'project', goal.project_id] });
      queryClient.invalidateQueries({ queryKey: ['goal', goal.id] });
      toast({
        title: 'ステータスを更新しました',
        description: `ゴールのステータスを「${getGoalStatusLabel(newStatus)}」に変更しました。`,
      });
      setIsUpdating(false);
    },
    onError: (error: any, newStatus: GoalStatus, context: any) => {
      // Rollback optimistic updates
      if (context?.previousGoals) {
        queryClient.setQueryData(['goals', 'project', goal.project_id], context.previousGoals);
      }
      if (context?.previousGoal) {
        queryClient.setQueryData(['goal', goal.id], context.previousGoal);
      }

      let errorMessage = 'ステータスの更新に失敗しました。';
      let errorTitle = 'エラー';

      if (error?.response?.status === 404) {
        errorTitle = 'ゴールが見つかりません';
        errorMessage = '更新対象のゴールが削除されている可能性があります。';
      } else if (error?.response?.status === 403) {
        errorTitle = '権限エラー';
        errorMessage = 'このゴールを更新する権限がありません。';
      } else if (error?.response?.status === 422) {
        errorTitle = '入力エラー';
        errorMessage = '無効なステータス値です。ページを再読み込みしてください。';
      } else if (error?.response?.status >= 500) {
        errorTitle = 'サーバーエラー';
        errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。';
      } else if (!navigator.onLine) {
        errorTitle = 'ネットワークエラー';
        errorMessage = 'インターネット接続を確認してください。';
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: 'destructive',
      });
      setIsUpdating(false);
    },
  });

  const handleStatusChange = (newStatus: GoalStatus) => {
    if (newStatus !== goal.status && !isUpdating) {
      setIsUpdating(true);
      updateStatusMutation.mutate(newStatus);
    }
  };

  const currentStatus = goal.status || 'pending';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
          disabled={isUpdating}
        >
          {getGoalStatusIcon(currentStatus)}
          <span className="text-sm">{getGoalStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getAllGoalStatuses().map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleStatusChange(status);
            }}
            className={currentStatus === status ? 'bg-gray-100' : ''}
          >
            <div className="flex items-center gap-2">
              {getGoalStatusIcon(status)}
              <span>{getGoalStatusLabel(status)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// Component to display goal dependencies
function GoalDependencies({ goalId, projectId }: { goalId: string; projectId: string }) {
  const { data: dependencies = [] } = useQuery({
    queryKey: ['goalDependencies', goalId],
    queryFn: () => goalsApi.getDependencies(goalId),
  });

  const { data: allGoals = [] } = useGoalsByProject(projectId);

  if (dependencies.length === 0) {
    return <span className="text-sm text-muted-foreground">なし</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <GitBranch className="h-4 w-4 text-blue-500" />
        <span className="text-sm text-muted-foreground">
          {dependencies.length}件
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {dependencies.map((dep) => {
          const dependsOnGoal = allGoals.find(g => g.id === dep.depends_on_goal_id);
          return (
            <Badge key={dep.id} variant="outline" className="text-xs">
              {dependsOnGoal?.title || '不明'}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { user, loading: authLoading } = useAuth();
  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch: refetchProject
  } = useProject(params.id);

  const {
    data: goals = [],
    isLoading: goalsLoading,
    error: goalsError,
    refetch: refetchGoals
  } = useGoalsByProject(params.id);

  const { data: projectProgress } = useQuery({
    queryKey: ['progress', 'project', params.id],
    queryFn: () => progressApi.getProject(params.id),
    enabled: !!project,
  });

  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (projectLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <div className="text-lg">プロジェクトを読み込み中...</div>
        </div>
      </div>
    );
  }

  if (projectError || (!projectLoading && !project)) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            エラー: {projectError?.message || 'プロジェクトが見つかりません'}
          </div>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => refetchProject()}>再試行</Button>
            <Button variant="outline" onClick={() => router.push('/projects')}>プロジェクト一覧に戻る</Button>
          </div>
        </div>
      </div>
    );
  }

  // Return early if project is not loaded yet
  if (!project) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/projects')}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          プロジェクト一覧
        </Button>
      </div>

      {/* Project Info */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">{project.title}</h1>
          <ProjectStatusDropdown project={project} />
        </div>
        <p className="text-gray-600 mb-4">
          {project.description || 'プロジェクトの説明がありません'}
        </p>
        <div className="text-sm text-gray-500">
          作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}
          {project.updated_at !== project.created_at && (
            <span className="ml-4">
              更新日: {new Date(project.updated_at).toLocaleDateString('ja-JP')}
            </span>
          )}
        </div>
      </div>

      {/* Progress Section */}
      {projectProgress && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">進捗状況</h2>
          <ProjectProgressCard progress={projectProgress} />
        </div>
      )}

      {/* Goals Section */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">ゴール一覧</h2>
            <p className="text-gray-600 mt-2">このプロジェクトの目標を管理します。</p>
          </div>
          <GoalFormDialog projectId={params.id}>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              新規ゴール作成
            </Button>
          </GoalFormDialog>
        </div>

        {goalsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg">ゴールを読み込み中...</div>
          </div>
        ) : goalsError ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-red-600 mb-4">エラー: {goalsError.message}</div>
                <Button onClick={() => refetchGoals()}>再試行</Button>
              </div>
            </CardContent>
          </Card>
        ) : goals.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>ゴールがまだありません</CardTitle>
              <CardDescription>
                新しいゴールを作成してプロジェクトを開始しましょう。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoalFormDialog projectId={params.id}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  最初のゴールを作成
                </Button>
              </GoalFormDialog>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {goals.map((goal) => (
              <Card
                key={goal.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/projects/${params.id}/goals/${goal.id}`)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <CardTitle className="line-clamp-1 flex-1">{goal.title}</CardTitle>
                    <GoalStatusDropdown goal={goal} />
                  </div>
                  <CardDescription className="line-clamp-2">
                    {goal.description || 'ゴールの説明がありません'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-gray-600">
                        見積時間: {goal.estimate_hours}h
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(goal.created_at).toLocaleDateString('ja-JP')}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">依存関係:</div>
                      <GoalDependencies goalId={goal.id} projectId={params.id} />
                    </div>

                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <GoalEditDialog goal={goal}>
                        <Button variant="outline" size="sm">
                          編集
                        </Button>
                      </GoalEditDialog>
                      <GoalDeleteDialog goal={goal}>
                        <Button variant="outline" size="sm">
                          削除
                        </Button>
                      </GoalDeleteDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
