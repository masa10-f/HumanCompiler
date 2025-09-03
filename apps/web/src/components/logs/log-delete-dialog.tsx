'use client';

import { useState } from 'react';
import { log as logger } from '@/lib/logger';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteLog } from '@/hooks/use-logs-query';
import { toast } from '@/hooks/use-toast';
import type { Log } from '@/types/log';

interface LogDeleteDialogProps {
  log: Log;
  children: React.ReactNode;
}

export function LogDeleteDialog({ log, children }: LogDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const deleteLogMutation = useDeleteLog();

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) {
      return `${mins}分`;
    }
    if (mins === 0) {
      return `${hours}時間`;
    }
    return `${hours}時間${mins}分`;
  };

  const handleDelete = async () => {
    try {
      await deleteLogMutation.mutateAsync(log.id);

      toast({
        title: '作業ログを削除しました',
        description: `${formatDuration(log.actual_minutes)}の記録が正常に削除されました。`,
      });

      setOpen(false);
    } catch (error) {
      logger.error('Failed to delete log', error, {
        component: 'LogDeleteDialog',
        logId: log.id,
        action: 'deleteLog'
      });

      toast({
        title: 'エラー',
        description: '作業ログの削除に失敗しました。再試行してください。',
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
          <DialogTitle>作業ログの削除</DialogTitle>
          <DialogDescription className="space-y-2">
            <div>本当にこの作業ログを削除しますか？この操作は取り消せません。</div>
            <div className="font-medium text-foreground">
              削除される記録: {formatDuration(log.actual_minutes)}
              {log.comment && (
                <div className="text-sm text-muted-foreground mt-1">
                  コメント: {log.comment}
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleteLogMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteLogMutation.isPending}
          >
            {deleteLogMutation.isPending ? '削除中...' : '削除'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
