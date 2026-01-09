'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatDuration } from '@/types/runner';
import { useCountdown } from '@/hooks/use-countdown';
import { cn } from '@/lib/utils';

interface CountdownTimerProps {
  remainingSeconds: number;
  isOverdue: boolean;
  startedAt: string;
  plannedCheckoutAt: string;
}

export function CountdownTimer({
  remainingSeconds,
  isOverdue,
  startedAt,
  plannedCheckoutAt,
}: CountdownTimerProps) {
  const { progressPercent } = useCountdown(plannedCheckoutAt, startedAt);

  // Format times for display
  const startTime = new Date(startedAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = new Date(plannedCheckoutAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Determine color based on time remaining
  const getTimerColor = () => {
    if (isOverdue) return 'text-red-600 dark:text-red-400';
    if (remainingSeconds < 5 * 60) return 'text-yellow-600 dark:text-yellow-400'; // <5 min
    return 'text-gray-900 dark:text-white';
  };

  return (
    <Card className={cn(isOverdue && 'border-red-500 dark:border-red-400')}>
      <CardContent className="pt-6 space-y-4">
        {/* Main timer display */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1">
            {isOverdue ? '超過時間' : '残り時間'}
          </p>
          <p
            className={cn(
              'text-5xl font-mono font-bold tracking-tight',
              getTimerColor()
            )}
          >
            {formatDuration(remainingSeconds)}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress
            value={Math.min(progressPercent, 100)}
            className="h-2"
            // indicatorClassName={getProgressColor()}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>開始: {startTime}</span>
            <span>予定終了: {endTime}</span>
          </div>
        </div>

        {/* Warning message */}
        {isOverdue && (
          <p className="text-center text-sm text-red-600 dark:text-red-400 font-medium">
            予定時間を超過しています。チェックアウトしてください。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
