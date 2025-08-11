'use client';

import { useState } from 'react';
import { log } from '@/lib/logger';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
    try {
      await deleteTaskMutation.mutateAsync(task.id);

      toast({
        title: 'タスクを削除しました',
        description: `「${task.title}」が正常に削除されました。`,
      });

      setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>タスクの削除</DialogTitle>
          <DialogDescription>
            本当に「{task.title}」を削除しますか？この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleteTaskMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteTaskMutation.isPending}
          >
            {deleteTaskMutation.isPending ? '削除中...' : '削除'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
