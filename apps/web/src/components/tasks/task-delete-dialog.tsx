'use client';

import { useState } from 'react';
import { log } from '@/lib/logger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useDeleteTask } from '@/hooks/use-tasks-query';
import { toast } from '@/hooks/use-toast';
import type { Task } from '@/types/task';

interface TaskDeleteDialogProps {
  task: Task;
  children: React.ReactNode;
}

export function TaskDeleteDialog({ task, children }: TaskDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const deleteTaskMutation = useDeleteTask();

  const handleDelete = async () => {
    setOpen(false);

    try {
      await deleteTaskMutation.mutateAsync(task.id);

      toast({
        title: 'タスクを削除しました',
        description: `「${task.title}」が正常に削除されました。`,
      });
    } catch (error) {
      log.error('Failed to delete task', error, { component: 'TaskDeleteDialog', taskId: task.id, action: 'deleteTask' });

      toast({
        title: 'エラー',
        description: 'タスクの削除に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle>タスクの削除</AlertDialogTitle>
          <AlertDialogDescription>
            本当に「{task.title}」を削除しますか？この操作は取り消せません。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteTaskMutation.isPending}>
            キャンセル
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteTaskMutation.isPending}
            >
              {deleteTaskMutation.isPending ? '削除中...' : '削除'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
