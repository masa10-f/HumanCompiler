'use client';

import React, { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useTasksByGoal } from '@/hooks/use-tasks-query';
import { useGoal } from '@/hooks/use-goals-query';
import { useProject } from '@/hooks/use-project-query';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '@/lib/api';
import { useTaskActualMinutes } from '@/hooks/use-logs-query';
import { useUpdateTask } from '@/hooks/use-tasks-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { TaskEditDialog } from '@/components/tasks/task-edit-dialog';
import { TaskDeleteDialog } from '@/components/tasks/task-delete-dialog';
import { TaskLogsMemoPanel } from '@/components/tasks/task-logs-memo-panel';
import { LogFormDialog } from '@/components/logs/log-form-dialog';
import { ArrowLeft, Plus, Clock, Calendar, GitBranch } from 'lucide-react';
import { taskStatusLabels, taskStatusColors, workTypeLabels, workTypeColors, taskPriorityLabels, taskPriorityColors } from '@/types/task';
import type { TaskStatus, Task } from '@/types/task';
import { log } from '@/lib/logger';
import { AppHeader } from '@/components/layout/app-header';

// Component to display actual time for a task
function TaskActualTime({ taskId }: { taskId: string }) {
  const { totalHours } = useTaskActualMinutes(taskId);

  return (
    <div className="flex items-center gap-1">
      <Clock className="h-3 w-3 text-green-600" />
      {totalHours.toFixed(1)}h
    </div>
  );
}

// Component for inline status editing
function TaskStatusSelect({ task }: { task: Task }) {
  const updateTaskMutation = useUpdateTask();

  const handleStatusChange = async (newStatus: TaskStatus) => {
    try {
      await updateTaskMutation.mutateAsync({
        id: task.id,
        data: { status: newStatus }
      });
    } catch (error) {
      log.error('Failed to update task status', error, {
        component: 'TaskStatusSelect',
        taskId: task.id,
        newStatus
      });
    }
  };

  return (
    <Select value={task.status} onValueChange={handleStatusChange} disabled={updateTaskMutation.isPending}>
      <SelectTrigger className="w-auto min-w-[100px] h-auto p-1">
        <SelectValue>
          <Badge className={taskStatusColors[task.status]}>
            {taskStatusLabels[task.status]}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(taskStatusLabels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            <Badge className={taskStatusColors[value as TaskStatus]}>
              {label}
            </Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function GoalDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const goalId = params.goalId as string;

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks
  } = useTasksByGoal(goalId);

  const {
    data: goal,
    isLoading: goalLoading,
    error: goalError,
    refetch: refetchGoal
  } = useGoal(goalId);

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch: refetchProject
  } = useProject(id);

  // Get goal progress data for actual work hours
  const { data: goalProgress } = useQuery({
    queryKey: ['progress', 'goal', goalId],
    queryFn: () => progressApi.getGoal(goalId),
    enabled: !!goal,
  });

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

  if (goalLoading || projectLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <div className="text-lg">データを読み込み中...</div>
        </div>
      </div>
    );
  }

  if (goalError || projectError || (!goalLoading && !goal) || (!projectLoading && !project)) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            エラー: {goalError?.message || projectError?.message || 'データが見つかりません'}
          </div>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => { refetchGoal(); refetchProject(); }}>再試行</Button>
            <Button variant="outline" onClick={() => router.push(`/projects/${id}`)}>プロジェクトに戻る</Button>
          </div>
        </div>
      </div>
    );
  }

  // Return early if data is not loaded yet
  if (!goal || !project) return null;

  const completedTasks = tasks.filter(task => task.status === 'completed').length;

  // Debug: Log tasks data to understand the structure
  log.debug('Tasks data for goal detail', {
    goalId: goalId,
    tasksData: tasks.map(t => ({
      id: t.id,
      title: t.title,
      estimate_hours: t.estimate_hours,
      type: typeof t.estimate_hours
    }))
  });

  // Ensure estimate_hours is treated as number and fix potential string concatenation issues
  const totalEstimateHours = tasks.reduce((sum, task) => {
    const hours = typeof task.estimate_hours === 'string'
      ? parseFloat(task.estimate_hours)
      : task.estimate_hours || 0;
    log.debug('Task hours calculation', {
      taskTitle: task.title,
      hours,
      originalType: typeof task.estimate_hours,
      goalId: goalId
    });
    return sum + hours;
  }, 0);

  const completedEstimateHours = tasks
    .filter(task => task.status === 'completed')
    .reduce((sum, task) => {
      const hours = typeof task.estimate_hours === 'string'
        ? parseFloat(task.estimate_hours)
        : task.estimate_hours || 0;
      return sum + hours;
    }, 0);

  // Get actual hours from goal progress API
  const totalActualHours = goalProgress ? goalProgress.actual_minutes / 60 : 0;

  log.debug('Goal detail calculated values', {
    goalId: goalId,
    totalEstimateHours,
    completedEstimateHours,
    totalActualHours
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/projects/${id}`)}
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
                  <div className="text-2xl font-bold">{totalActualHours.toFixed(1)}h / {totalEstimateHours.toFixed(1)}h</div>
                  <div className="text-xs text-gray-500">実績 / 見積時間</div>
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
          <TaskFormDialog goalId={goalId}>
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
                <div className="text-red-600 mb-4">エラー: {tasksError.message}</div>
                <Button onClick={() => refetchTasks()}>再試行</Button>
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
              <TaskFormDialog goalId={goalId}>
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
                    <TableHead>作業種別</TableHead>
                    <TableHead>優先度</TableHead>
                    <TableHead>依存関係</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>見積時間</TableHead>
                    <TableHead>実績時間</TableHead>
                    <TableHead>締切日</TableHead>
                    <TableHead>作成日</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <React.Fragment key={task.id}>
                      <TableRow>
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
                          <Badge className={workTypeColors[task.work_type || 'light_work']}>
                            {workTypeLabels[task.work_type || 'light_work']}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={taskPriorityColors[task.priority || 3]}>
                            {taskPriorityLabels[task.priority || 3]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {task.dependencies && task.dependencies.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <GitBranch className="h-4 w-4 text-blue-500" />
                                <span className="text-sm text-muted-foreground">
                                  {task.dependencies.length}件
                                </span>
                              </div>
                              <div className="flex -space-x-2" title={`依存タスク: ${task.dependencies.map(d => d.depends_on_task?.title || '不明').join(', ')}`}>
                                {task.dependencies.slice(0, 3).map((dep, index) => (
                                  <div
                                    key={dep.id}
                                    className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 border border-white text-xs"
                                    title={dep.depends_on_task?.title || '不明なタスク'}
                                  >
                                    {index + 1}
                                  </div>
                                ))}
                                {task.dependencies.length > 3 && (
                                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 border border-white text-xs">
                                    +{task.dependencies.length - 3}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">なし</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <TaskStatusSelect task={task} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {task.estimate_hours}h
                          </div>
                        </TableCell>
                        <TableCell>
                          <TaskActualTime taskId={task.id} />
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
                          <div className="flex gap-1">
                            <LogFormDialog
                              taskId={task.id}
                              taskTitle={task.title}
                              trigger={
                                <Button variant="outline" size="sm">
                                  時間記録
                                </Button>
                              }
                            />
                            <TaskEditDialog task={task} availableTasks={tasks}>
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
                      <TableRow>
                        <TableCell colSpan={10} className="p-0">
                          <TaskLogsMemoPanel task={task} />
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
