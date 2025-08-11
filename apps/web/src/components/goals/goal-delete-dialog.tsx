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
import { useDeleteGoal } from '@/hooks/use-goals-query';
import { toast } from '@/hooks/use-toast';
import type { Goal } from '@/types/goal';

interface GoalDeleteDialogProps {
  goal: Goal;
  children: React.ReactNode;
}

export function GoalDeleteDialog({ goal, children }: GoalDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const deleteGoalMutation = useDeleteGoal();

  const handleDelete = async () => {
    try {
      await deleteGoalMutation.mutateAsync(goal.id);

      toast({
        title: 'ゴールを削除しました',
        description: `「${goal.title}」が正常に削除されました。`,
      });

      setOpen(false);
    } catch (error) {
      log.error('Failed to delete goal', error, { component: 'GoalDeleteDialog', goalId: goal.id, action: 'deleteGoal' });

      toast({
        title: 'エラー',
        description: 'ゴールの削除に失敗しました。再試行してください。',
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
          <DialogTitle>ゴールの削除</DialogTitle>
          <DialogDescription>
            本当に「{goal.title}」を削除しますか？この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleteGoalMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteGoalMutation.isPending}
          >
            {deleteGoalMutation.isPending ? '削除中...' : '削除'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
