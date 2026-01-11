/**
 * Dialog shown when user returns with an unresponsive session (Issue #228)
 *
 * This dialog cannot be dismissed without completing checkout.
 * It forces the user to address their overdue session before continuing.
 */

'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock } from 'lucide-react';
import type { WorkSession } from '@/types/work-session';

interface UnresponsiveDialogProps {
  /** The unresponsive session that needs checkout */
  session: WorkSession;
  /** How many minutes overdue the session is */
  overdueMinutes: number;
  /** Callback when user clicks checkout */
  onCheckout: () => void;
  /** Whether checkout is being processed */
  isProcessing?: boolean;
}

export function UnresponsiveDialog({
  session,
  overdueMinutes,
  onCheckout,
  isProcessing = false,
}: UnresponsiveDialogProps) {
  // Format overdue time
  const formatOverdueTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes}分`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours}時間`;
    }
    return `${hours}時間${mins}分`;
  };

  // Get task title if available
  const taskTitle = session.task?.title || 'タスク';

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-6 w-6" />
            <AlertDialogTitle>未応答セッションがあります</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  予定時刻から{' '}
                  <strong className="text-red-600 dark:text-red-400">
                    {formatOverdueTime(overdueMinutes)}
                  </strong>{' '}
                  超過しています
                </span>
              </div>

              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium">{taskTitle}</p>
                {session.planned_outcome && (
                  <p className="text-xs text-muted-foreground mt-1">
                    目標: {session.planned_outcome}
                  </p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                作業を続行するにはチェックアウトを完了してください。
                振り返り（KPT）を記録して、次の作業に進みましょう。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="destructive"
            onClick={onCheckout}
            disabled={isProcessing}
            className="w-full"
          >
            {isProcessing ? '処理中...' : '今すぐチェックアウト'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
