'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useTasks } from '@/hooks/use-tasks';
import { goalsApi, projectsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { TaskEditDialog } from '@/components/tasks/task-edit-dialog';
import { TaskDeleteDialog } from '@/components/tasks/task-delete-dialog';
import { ArrowLeft, Plus, Clock, Calendar } from 'lucide-react';
import { taskStatusLabels, taskStatusColors } from '@/types/task';
import type { Goal } from '@/types/goal';
import type { Project } from '@/types/project';

interface GoalDetailPageProps {
  params: {
    id: string;
    goalId: string;
  };
}

export default function GoalDetailPage({ params }: GoalDetailPageProps) {
  const { user, loading: authLoading } = useAuth();
  const { tasks, loading: tasksLoading, error: tasksError, refetch } = useTasks(params.goalId);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalError, setGoalError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!params.goalId || !params.id) return;
      
      try {
        setGoalLoading(true);
        setGoalError(null);
        console.log('[GoalDetail] Fetching data for goal:', params.goalId, 'project:', params.id);
        
        // Fetch goal and project data
        const [goalData, projectData] = await Promise.all([
          goalsApi.getById(params.goalId),
          projectsApi.getById(params.id)
        ]);
        
        console.log('[GoalDetail] Data fetched successfully:', { goalData, projectData });
        setGoal(goalData);
        setProject(projectData);
      } catch (err) {
        console.error('[GoalDetail] Error fetching data:', err);
        setGoalError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setGoalLoading(false);
      }
    };

    if (user) {
      fetchData();
    }
  }, [params.goalId, params.id, user]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (goalLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <div className="text-lg">ゴールを読み込み中...</div>
        </div>
      </div>
    );
  }

  if (goalError || !goal || !project) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">エラー: {goalError || 'ゴールが見つかりません'}</div>
          <Button onClick={() => router.push(`/projects/${params.id}`)}>プロジェクトに戻る</Button>
        </div>
      </div>
    );
  }

  const completedTasks = tasks.filter(task => task.status === 'completed').length;
  const totalHours = tasks.reduce((sum, task) => sum + task.estimate_hours, 0);
  const completedHours = tasks
    .filter(task => task.status === 'completed')
    .reduce((sum, task) => sum + task.estimate_hours, 0);

  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/projects/${params.id}`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          プロジェクトに戻る
        </Button>
      </div>

      {/* Goal Info */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <span>{project.title}</span>
          <span>›</span>
          <span>ゴール</span>
        </div>
        <h1 className="text-3xl font-bold mb-2">{goal.title}</h1>
        <p className="text-gray-600 mb-4">
          {goal.description || 'ゴールの説明がありません'}
        </p>
        
        {/* Goal Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                <div>
                  <div className="text-2xl font-bold">{goal.estimate_hours}h</div>
                  <div className="text-xs text-gray-500">見積時間</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-green-600 rounded-full" />
                <div>
                  <div className="text-2xl font-bold">{completedTasks}</div>
                  <div className="text-xs text-gray-500">完了タスク</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-gray-400 rounded-full" />
                <div>
                  <div className="text-2xl font-bold">{tasks.length}</div>
                  <div className="text-xs text-gray-500">総タスク数</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-600" />
                <div>
                  <div className="text-2xl font-bold">{completedHours}h / {totalHours}h</div>
                  <div className="text-xs text-gray-500">実績時間</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tasks Section */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">タスク一覧</h2>
            <p className="text-gray-600 mt-2">このゴールのタスクを管理します。</p>
          </div>
          <TaskFormDialog goalId={params.goalId}>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              新規タスク作成
            </Button>
          </TaskFormDialog>
        </div>

        {tasksLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg">タスクを読み込み中...</div>
          </div>
        ) : tasksError ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-red-600 mb-4">エラー: {tasksError}</div>
                <Button onClick={refetch}>再試行</Button>
              </div>
            </CardContent>
          </Card>
        ) : tasks.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>タスクがまだありません</CardTitle>
              <CardDescription>
                新しいタスクを作成してゴールを実現しましょう。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TaskFormDialog goalId={params.goalId}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  最初のタスクを作成
                </Button>
              </TaskFormDialog>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>タスク名</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>見積時間</TableHead>
                    <TableHead>締切日</TableHead>
                    <TableHead>作成日</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{task.title}</div>
                          {task.description && (
                            <div className="text-sm text-gray-500 line-clamp-1">
                              {task.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={taskStatusColors[task.status]}>
                          {taskStatusLabels[task.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {task.estimate_hours}h
                        </div>
                      </TableCell>
                      <TableCell>
                        {task.due_date ? (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(task.due_date).toLocaleDateString('ja-JP')}
                          </div>
                        ) : (
                          <span className="text-gray-400">未設定</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-500">
                          {new Date(task.created_at).toLocaleDateString('ja-JP')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <TaskEditDialog task={task}>
                            <Button variant="outline" size="sm">
                              編集
                            </Button>
                          </TaskEditDialog>
                          <TaskDeleteDialog task={task}>
                            <Button variant="outline" size="sm">
                              削除
                            </Button>
                          </TaskDeleteDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}