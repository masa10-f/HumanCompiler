'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Inbox, Plus, RefreshCw } from 'lucide-react';
import { QuickTaskCard } from './quick-task-card';
import { QuickTaskFormDialog } from './quick-task-form-dialog';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { toast } from '@/hooks/use-toast';
import { log } from '@/lib/logger';
import { quickTasksApi } from '@/lib/api';
import type { QuickTask } from '@/types/quick-task';

interface QuickTaskListProps {
  /** Maximum number of tasks to display */
  limit?: number;
  /** Whether to show the header with title and add button */
  showHeader?: boolean;
  /** Callback when a task is converted to a regular task */
  onConvertToTask?: (task: QuickTask) => void;
}

export function QuickTaskList({
  limit = 50,
  showHeader = true,
  onConvertToTask,
}: QuickTaskListProps) {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<QuickTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<QuickTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await quickTasksApi.getAll(0, limit);
      // Filter out completed/cancelled tasks for display
      const activeTasks = result.filter(
        (task) => task.status !== 'completed' && task.status !== 'cancelled'
      );
      setTasks(activeTasks);
    } catch (err) {
      log.error('Failed to fetch quick tasks', err, { component: 'QuickTaskList' });
      setError('クイックタスクの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleTaskCreated = (task: QuickTask) => {
    setTasks((prev) => [task, ...prev]);
  };

  const handleTaskUpdated = (updatedTask: QuickTask) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === updatedTask.id ? updatedTask : task))
    );
    setEditingTask(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTask) return;

    setIsDeleting(true);
    try {
      await quickTasksApi.delete(deletingTask.id);
      setTasks((prev) => prev.filter((task) => task.id !== deletingTask.id));
      toast({
        title: 'クイックタスクを削除しました',
        description: `「${deletingTask.title}」が削除されました。`,
      });
    } catch (err) {
      log.error('Failed to delete quick task', err, {
        component: 'QuickTaskList',
        taskId: deletingTask.id,
      });
      toast({
        title: 'エラー',
        description: 'クイックタスクの削除に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeletingTask(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-destructive">{error}</div>
          <div className="text-center mt-2">
            <Button variant="outline" onClick={fetchTasks}>
              再試行
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        {showHeader && (
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Inbox className="h-5 w-5" />
              クイックタスク
              {tasks.length > 0 && (
                <span className="text-sm text-muted-foreground">({tasks.length})</span>
              )}
            </CardTitle>
            <QuickTaskFormDialog onSuccess={handleTaskCreated}>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                追加
              </Button>
            </QuickTaskFormDialog>
          </CardHeader>
        )}
        <CardContent className={showHeader ? 'pt-0' : 'p-4'}>
          {tasks.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>クイックタスクがありません</p>
              <p className="text-sm mt-2">
                プロジェクトに属さない雑多なタスクを素早く登録できます
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <QuickTaskCard
                  key={task.id}
                  task={task}
                  onEdit={setEditingTask}
                  onDelete={setDeletingTask}
                  onConvert={onConvertToTask}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {editingTask && (
        <QuickTaskFormDialog
          task={editingTask}
          onSuccess={handleTaskUpdated}
        >
          <span style={{ display: 'none' }} />
        </QuickTaskFormDialog>
      )}

      {/* Delete Confirmation */}
      <ConfirmationModal
        isOpen={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={handleDeleteConfirm}
        title="クイックタスクの削除"
        description={`「${deletingTask?.title}」を削除しますか？この操作は取り消せません。`}
        confirmText="削除"
        variant="destructive"
        loading={isDeleting}
      />
    </>
  );
}
