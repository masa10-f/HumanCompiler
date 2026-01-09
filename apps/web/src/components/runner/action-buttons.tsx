'use client';

import { Button } from '@/components/ui/button';
import { LogOut, Coffee } from 'lucide-react';
import type { RunnerSessionStatus } from '@/types/runner';

interface ActionButtonsProps {
  sessionStatus: RunnerSessionStatus;
  isCheckingOut: boolean;
  onCheckout: () => void;
  onBreak: () => void;
}

export function ActionButtons({
  sessionStatus,
  isCheckingOut,
  onCheckout,
  onBreak,
}: ActionButtonsProps) {
  const isOverdue = sessionStatus === 'overdue';

  return (
    <div className="flex flex-col gap-2">
      {/* Primary action - Checkout */}
      <Button
        size="lg"
        variant={isOverdue ? 'destructive' : 'default'}
        className="w-full min-h-[48px] text-lg"
        onClick={onCheckout}
        disabled={isCheckingOut}
      >
        <LogOut className="h-5 w-5 mr-2" />
        {isCheckingOut ? '処理中...' : 'チェックアウト'}
      </Button>

      {/* Secondary actions */}
      <div className="flex gap-2">
        <Button
          size="lg"
          variant="outline"
          className="flex-1 min-h-[48px]"
          onClick={onBreak}
          disabled={isCheckingOut}
        >
          <Coffee className="h-4 w-4 mr-2" />
          休憩
        </Button>
      </div>
    </div>
  );
}
