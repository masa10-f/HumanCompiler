'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatDuration } from '@/types/runner';
import { useCountdown } from '@/hooks/use-countdown';
import { cn } from '@/lib/utils';
import { Pause } from 'lucide-react';

interface CountdownTimerProps {
  remainingSeconds: number;
  isOverdue: boolean;
  isPaused: boolean;
  startedAt: string;
  plannedCheckoutAt: string;
  pausedAt?: string | null;
}

export function CountdownTimer({
  remainingSeconds,
  isOverdue,
  isPaused,
  startedAt,
  plannedCheckoutAt,
  pausedAt,
}: CountdownTimerProps) {
  const { progressPercent } = useCountdown(plannedCheckoutAt, startedAt, pausedAt);

  // Format times for display
  const startTime = new Date(startedAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = new Date(plannedCheckoutAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Determine color based on time remaining and pause state
  const getTimerColor = () => {
    if (isPaused) return 'text-amber-600 dark:text-amber-400';
    if (isOverdue) return 'text-red-600 dark:text-red-400';
    if (remainingSeconds < 5 * 60) return 'text-yellow-600 dark:text-yellow-400'; // <5 min
    return 'text-gray-900 dark:text-white';
  };

  // Determine border color
  const getBorderClass = () => {
    if (isPaused) return 'border-amber-500 dark:border-amber-400';
    if (isOverdue) return 'border-red-500 dark:border-red-400';
    return '';
  };

  return (
    <Card className={cn(getBorderClass())}>
      <CardContent className="pt-6 space-y-4">
        {/* Main timer display */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            {isPaused && <Pause className="h-3 w-3" />}
            {isPaused ? '一時停止中' : isOverdue ? '超過時間' : '残り時間'}
          </p>
          <p
            className={cn(
              'text-5xl font-mono font-bold tracking-tight',
              getTimerColor(),
              isPaused && 'animate-pulse'
            )}
          >
            {formatDuration(remainingSeconds)}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress
            value={Math.min(progressPercent, 100)}
            className={cn('h-2', isPaused && 'opacity-50')}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>開始: {startTime}</span>
            <span>予定終了: {endTime}</span>
          </div>
        </div>

        {/* Status messages */}
        {isPaused && (
          <p className="text-center text-sm text-amber-600 dark:text-amber-400 font-medium">
            セッションは一時停止中です。再開ボタンを押して作業を続けてください。
          </p>
        )}
        {isOverdue && !isPaused && (
          <p className="text-center text-sm text-red-600 dark:text-red-400 font-medium">
            予定時間を超過しています。チェックアウトしてください。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
