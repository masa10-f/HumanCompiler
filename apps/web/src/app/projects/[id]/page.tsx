'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProject } from '@/hooks/use-project-query';
import { useGoalsByProject } from '@/hooks/use-goals-query';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoalFormDialog } from '@/components/goals/goal-form-dialog';
import { GoalEditDialog } from '@/components/goals/goal-edit-dialog';
import { GoalDeleteDialog } from '@/components/goals/goal-delete-dialog';
import { ProjectProgressCard } from '@/components/progress/progress-card';
import { ArrowLeft, Plus } from 'lucide-react';

interface ProjectDetailPageProps {
  params: {
    id: string;
  };
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
        <h1 className="text-3xl font-bold mb-2">{project.title}</h1>
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
                  <CardTitle className="line-clamp-1">{goal.title}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {goal.description || 'ゴールの説明がありません'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-sm text-gray-600">
                      見積時間: {goal.estimate_hours}h
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(goal.created_at).toLocaleDateString('ja-JP')}
                    </div>
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
