'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTasks } from '@/hooks/use-tasks';
import type { Task } from '@/types/task';

interface TaskDeleteDialogProps {
  task: Task;
  children: React.ReactNode;
}

export function TaskDeleteDialog({ task, children }: TaskDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { deleteTask } = useTasks(task.goal_id);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteTask(task.id);
      setOpen(false);
    } catch (error) {
      console.error('Failed to delete task:', error);
    } finally {
      setIsDeleting(false);
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
            disabled={isDeleting}
          >
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? '削除中...' : '削除'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
