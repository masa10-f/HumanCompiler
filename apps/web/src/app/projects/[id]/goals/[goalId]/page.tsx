'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useAllTasksByGoal } from '@/hooks/use-tasks-query';
import { useGoal } from '@/hooks/use-goals-query';
import { useProject } from '@/hooks/use-project-query';
import { useGoalNote } from '@/hooks/use-notes';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '@/lib/api';
import { useBatchLogsQuery } from '@/hooks/use-logs-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { GoalTaskList } from '@/components/tasks/goal-task-list';
import { ContextNotePanel } from '@/components/notes/context-note-panel';
import { GoalTaskAssistantDialog } from '@/components/ai/goal-task-assistant-dialog';
import { ArrowLeft, Plus, Clock, FileText, Loader2, AlertCircle, Sparkles, CalendarDays } from 'lucide-react';
import { SortBy, SortOrder } from '@/types/sort';
import type { SortOptions } from '@/types/sort';
import { AppHeader } from '@/components/layout/app-header';
import { safeFormatJapaneseDate } from '@/lib/date-utils';

export default function GoalDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const goalId = params.goalId as string;
  const [taskSortOptions, setTaskSortOptions] = useState<SortOptions>({
    sortBy: SortBy.STATUS,
    sortOrder: SortOrder.ASC,
  });

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks
  } = useAllTasksByGoal(goalId, taskSortOptions);

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

  const {
    note: goalNote,
    loading: noteLoading,
    saving: noteSaving,
    error: noteError,
    updateNote,
    refetch: refetchNote,
  } = useGoalNote(goalId);

  // Get goal progress data for actual work hours
  const { data: goalProgress } = useQuery({
    queryKey: ['progress', 'goal', goalId],
    queryFn: () => progressApi.getGoal(goalId),
    enabled: !!goal,
  });

  const taskIds = useMemo(() => tasks.map(task => task.id), [tasks]);
  const {
    data: logsByTask = {},
    isLoading: logsLoading,
    error: logsError,
  } = useBatchLogsQuery(taskIds);

  const taskActualMinutesById = useMemo(() => {
    return Object.fromEntries(
      taskIds.map(taskId => {
        const logs = logsByTask[taskId] || [];
        const totalMinutes = logs.reduce((sum, logEntry) => sum + (logEntry.actual_minutes || 0), 0);
        return [taskId, totalMinutes];
      })
    );
  }, [taskIds, logsByTask]);

  const { completedTasks, totalEstimateHours, completedEstimateHours } = useMemo(() => {
    return tasks.reduce(
      (totals, task) => {
        const estimateHours = task.estimate_hours || 0;

        totals.totalEstimateHours += estimateHours;

        if (task.status === 'completed') {
          totals.completedTasks += 1;
          totals.completedEstimateHours += estimateHours;
        }

        return totals;
      },
      {
        completedTasks: 0,
        totalEstimateHours: 0,
        completedEstimateHours: 0,
      }
    );
  }, [tasks]);

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

  // Get actual hours from goal progress API
  const totalActualHours = goalProgress ? goalProgress.actual_minutes / 60 : 0;

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
        {goal.due_date && (
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <CalendarDays className="h-4 w-4" />
            期限: {safeFormatJapaneseDate(goal.due_date)}
          </div>
        )}

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
                  <div className="text-xs text-gray-500">完了タスク ({completedEstimateHours.toFixed(1)}h)</div>
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

      {/* Goal Notes Section */}
      <div className="mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              ゴールノート
            </CardTitle>
          </CardHeader>
          <CardContent>
            {noteLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : noteError ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <AlertCircle className="h-6 w-6 text-red-500 mb-2" />
                <p className="text-sm text-red-600 mb-2">ノートの読み込みに失敗しました</p>
                <Button variant="outline" size="sm" onClick={() => refetchNote()}>
                  再試行
                </Button>
              </div>
            ) : (
              <ContextNotePanel
                content={goalNote?.content || ''}
                onUpdate={(content) => updateNote({ content, content_type: 'html' })}
                saving={noteSaving}
                placeholder="ゴールに関するメモや背景情報を記録..."
                updatedAt={goalNote?.updated_at}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tasks Section */}
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">タスク一覧</h2>
            <p className="text-gray-600 mt-2">このゴールのタスクを管理します。</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SortDropdown
              currentSort={taskSortOptions}
              onSortChange={setTaskSortOptions}
              sortFields={[
                { value: SortBy.STATUS, label: 'ステータス' },
                { value: SortBy.PRIORITY, label: '優先度' },
                { value: SortBy.TITLE, label: 'タスク名' },
                { value: SortBy.CREATED_AT, label: '作成日' },
                { value: SortBy.UPDATED_AT, label: '更新日' },
              ]}
            />
            <GoalTaskAssistantDialog
              projectId={id}
              goalId={goalId}
              mode="goal_tasks"
              title="AIでタスク案"
              defaultMessage="ゴールノートと既存タスクをもとに、達成に必要なタスクを提案してください。重複しそうなものは避けてください。"
              onApplied={() => {
                refetchTasks();
                refetchGoal();
              }}
            >
              <Button variant="outline">
                <Sparkles className="h-4 w-4 mr-2" />
                AI提案
              </Button>
            </GoalTaskAssistantDialog>
            <TaskFormDialog goalId={goalId}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規タスク作成
              </Button>
            </TaskFormDialog>
          </div>
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
              <div className="flex flex-wrap gap-2">
                <GoalTaskAssistantDialog
                  projectId={id}
                  goalId={goalId}
                  mode="goal_tasks"
                  title="AIでタスク案"
                  defaultMessage="ゴールノートをもとに、最初に作るべきタスクを提案してください。"
                  onApplied={() => {
                    refetchTasks();
                    refetchGoal();
                  }}
                >
                  <Button variant="outline">
                    <Sparkles className="h-4 w-4 mr-2" />
                    AI提案
                  </Button>
                </GoalTaskAssistantDialog>
                <TaskFormDialog goalId={goalId}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    最初のタスクを作成
                  </Button>
                </TaskFormDialog>
              </div>
            </CardContent>
          </Card>
        ) : (
          <GoalTaskList
            tasks={tasks}
            projectId={id}
            goalId={goalId}
            logsByTask={logsByTask}
            logsLoading={logsLoading}
            logsError={logsError}
            actualMinutesByTask={taskActualMinutesById}
          />
        )}
        </div>
      </div>
    </div>
  );
}
