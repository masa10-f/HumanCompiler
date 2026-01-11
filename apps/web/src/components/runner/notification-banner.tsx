/**
 * In-app notification banner for Runner UI (Issue #228)
 *
 * Shows checkout reminder notifications with different urgency levels:
 * - Light: 5 min before checkout (dismissable)
 * - Strong: At checkout time (non-dismissable)
 * - Overdue: Past due (urgent, non-dismissable)
 */

'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Bell, Clock, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationLevel, NotificationMessage } from '@/types/notification';

interface NotificationBannerProps {
  notification: NotificationMessage;
  onDismiss: () => void;
  onSnooze: () => void;
  onCheckout: () => void;
  snoozeDisabled?: boolean;
  snoozeCount?: number;
  maxSnoozeCount?: number;
  isSnoozing?: boolean;
}

/**
 * Configuration for each notification level
 */
const levelConfig: Record<
  NotificationLevel,
  {
    icon: typeof Bell;
    variant: 'default' | 'destructive';
    className: string;
    showDismiss: boolean;
    showSnooze: boolean;
  }
> = {
  light: {
    icon: Clock,
    variant: 'default',
    className:
      'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
    showDismiss: true,
    showSnooze: true,
  },
  strong: {
    icon: Bell,
    variant: 'default',
    className:
      'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 animate-pulse',
    showDismiss: false,
    showSnooze: true,
  },
  overdue: {
    icon: AlertTriangle,
    variant: 'destructive',
    className: 'animate-bounce',
    showDismiss: false,
    showSnooze: false,
  },
};

export function NotificationBanner({
  notification,
  onDismiss,
  onSnooze,
  onCheckout,
  snoozeDisabled = false,
  snoozeCount = 0,
  maxSnoozeCount = 2,
  isSnoozing = false,
}: NotificationBannerProps) {
  const config = levelConfig[notification.level];
  const Icon = config.icon;

  // Check if snooze is available
  const canSnooze =
    config.showSnooze &&
    !snoozeDisabled &&
    snoozeCount < maxSnoozeCount;

  return (
    <Alert
      variant={config.variant}
      className={cn('relative mb-4', config.className)}
    >
      <Icon className="h-5 w-5" />
      <AlertTitle className="font-semibold">{notification.title}</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="text-sm">{notification.body}</p>

        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            size="sm"
            variant={notification.level === 'overdue' ? 'destructive' : 'default'}
            onClick={onCheckout}
          >
            チェックアウト
          </Button>

          {canSnooze && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSnooze}
              disabled={isSnoozing}
            >
              {isSnoozing ? '処理中...' : `スヌーズ (5分) ${snoozeCount}/${maxSnoozeCount}`}
            </Button>
          )}
        </div>

        {snoozeCount >= maxSnoozeCount && notification.level !== 'overdue' && (
          <p className="text-xs text-muted-foreground mt-2">
            スヌーズ上限に達しました
          </p>
        )}
      </AlertDescription>

      {config.showDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-2 right-2 h-6 w-6"
          onClick={onDismiss}
          aria-label="通知を閉じる"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </Alert>
  );
}
