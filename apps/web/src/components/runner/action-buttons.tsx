'use client';

import { Button } from '@/components/ui/button';
import { LogOut, Pause, Play } from 'lucide-react';
import type { RunnerSessionStatus } from '@/types/runner';

interface ActionButtonsProps {
  sessionStatus: RunnerSessionStatus;
  isCheckingOut: boolean;
  isPausing: boolean;
  isResuming: boolean;
  onCheckout: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function ActionButtons({
  sessionStatus,
  isCheckingOut,
  isPausing,
  isResuming,
  onCheckout,
  onPause,
  onResume,
}: ActionButtonsProps) {
  const isOverdue = sessionStatus === 'overdue';
  const isPaused = sessionStatus === 'paused';
  const isProcessing = isCheckingOut || isPausing || isResuming;

  return (
    <div className="flex flex-col gap-2">
      {/* Primary action - Checkout or Resume */}
      {isPaused ? (
        <Button
          size="lg"
          variant="default"
          className="w-full min-h-[48px] text-lg"
          onClick={onResume}
          disabled={isProcessing}
        >
          <Play className="h-5 w-5 mr-2" />
          {isResuming ? '処理中...' : '再開'}
        </Button>
      ) : (
        <Button
          size="lg"
          variant={isOverdue ? 'destructive' : 'default'}
          className="w-full min-h-[48px] text-lg"
          onClick={onCheckout}
          disabled={isProcessing}
        >
          <LogOut className="h-5 w-5 mr-2" />
          {isCheckingOut ? '処理中...' : 'チェックアウト'}
        </Button>
      )}

      {/* Secondary actions */}
      <div className="flex gap-2">
        {isPaused ? (
          <Button
            size="lg"
            variant="outline"
            className="flex-1 min-h-[48px]"
            onClick={onCheckout}
            disabled={isProcessing}
          >
            <LogOut className="h-4 w-4 mr-2" />
            チェックアウト
          </Button>
        ) : (
          <Button
            size="lg"
            variant="outline"
            className="flex-1 min-h-[48px]"
            onClick={onPause}
            disabled={isProcessing}
          >
            <Pause className="h-4 w-4 mr-2" />
            {isPausing ? '処理中...' : '一時停止'}
          </Button>
        )}
      </div>
    </div>
  );
}
