'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { AppHeader } from '@/components/layout/app-header';
import { TaskDetail } from '@/components/tasks/task-detail';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useGoal } from '@/hooks/use-goals-query';
import { useProject } from '@/hooks/use-project-query';
import { useAllTasksByGoal, useTask } from '@/hooks/use-tasks-query';

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

/**
 * The task on a page of its own: the same detail as the side panel, with room
 * for a long note. Lists open the panel; this page is for links and long edits.
 */
export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const goalId = params.goalId as string;
  const taskId = params.taskId as string;

  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: goal, isLoading: goalLoading } = useGoal(goalId);
  const {
    data: task,
    isLoading: taskLoading,
    error: taskError,
    refetch: refetchTask,
  } = useTask(taskId);
  // The edit dialog offers the goal's other tasks as dependencies.
  const { data: goalTasks = [] } = useAllTasksByGoal(goalId);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || projectLoading || goalLoading || taskLoading || !isAuthenticated) {
    return (
      <PageShell>
        <Spinner />
      </PageShell>
    );
  }

  const goalPath = `/projects/${projectId}/goals/${goalId}`;

  if (taskError || !task) {
    const taskErrorMessage =
      taskError instanceof Error ? taskError.message : 'タスクが見つかりません';

    return (
      <PageShell>
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-sm text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              タスクを読み込めませんでした
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{taskErrorMessage}</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button onClick={() => refetchTask()}>再試行</Button>
              <Button variant="outline" onClick={() => router.push(goalPath)}>
                ゴールに戻る
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <Button variant="outline" size="sm" asChild>
            <Link href={goalPath}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              ゴールに戻る
            </Link>
          </Button>
          <nav aria-label="パンくず" className="text-sm text-gray-500 dark:text-gray-400">
            <Link href="/projects" className="hover:text-blue-600">
              Projects
            </Link>
            {' / '}
            <Link href={`/projects/${projectId}`} className="hover:text-blue-600">
              {project?.title || 'Project'}
            </Link>
            {' / '}
            <Link href={goalPath} className="hover:text-blue-600">
              {goal?.title || 'Goal'}
            </Link>
            {' / '}
            <span className="text-gray-700 dark:text-gray-300">{task.title}</span>
          </nav>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <TaskDetail taskId={taskId} availableTasks={goalTasks} variant="page" />
        </div>
      </div>
    </PageShell>
  );
}
