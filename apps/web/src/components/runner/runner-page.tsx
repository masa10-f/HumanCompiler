'use client';

import { useAuth } from '@/hooks/use-auth';
import { useRunner } from '@/hooks/use-runner';
import { AppHeader } from '@/components/layout/app-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionDisplay } from './session-display';
import { CountdownTimer } from './countdown-timer';
import { ActionButtons } from './action-buttons';
import { TaskSwitcher } from './task-switcher';
import { StartSessionDialog } from './start-session-dialog';
import { CheckoutDialog } from './checkout-dialog';
import { BreakDialog } from './break-dialog';
import { NotificationBanner } from './notification-banner';
import { useState } from 'react';
import { Play, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function RunnerPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    session,
    sessionDetails,
    sessionStatus,
    remainingSeconds,
    isOverdue,
    nextCandidates,
    todaySchedule,
    isLoading,
    isStarting,
    isCheckingOut,
    startSession,
    checkout,
    currentNotification,
    dismissNotification,
    snoozeSession,
    isSnoozing,
    snoozeCount,
    maxSnoozeCount,
  } = useRunner();

  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [breakDialogOpen, setBreakDialogOpen] = useState(false);
  const [selectedNextTaskId, setSelectedNextTaskId] = useState<string | null>(null);

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AppHeader currentPage="runner" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              ログインしてください
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Data loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AppHeader currentPage="runner" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  // No schedule warning
  const hasSchedule = (todaySchedule?.plan_json?.assignments?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="runner" />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Play className="h-6 w-6" />
            Runner
          </h1>
          {sessionStatus === 'overdue' && (
            <span className="px-3 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full text-sm font-medium">
              超過中
            </span>
          )}
        </div>

        {/* No schedule alert */}
        {!hasSchedule && !session && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              本日のスケジュールがありません。日次計画ページでスケジュールを作成してください。
            </AlertDescription>
          </Alert>
        )}

        {/* Session active state */}
        {session && sessionDetails && (
          <>
            {/* Notification banner */}
            {currentNotification && (
              <NotificationBanner
                notification={currentNotification}
                onDismiss={dismissNotification}
                onSnooze={snoozeSession}
                onCheckout={() => setCheckoutDialogOpen(true)}
                isSnoozing={isSnoozing}
                snoozeCount={snoozeCount}
                maxSnoozeCount={maxSnoozeCount}
              />
            )}

            {/* Current task display */}
            <SessionDisplay
              session={session}
              task={sessionDetails.task}
              goal={sessionDetails.goal}
              project={sessionDetails.project}
              isOverdue={isOverdue}
            />

            {/* Countdown timer */}
            <CountdownTimer
              remainingSeconds={remainingSeconds}
              isOverdue={isOverdue}
              startedAt={session.started_at}
              plannedCheckoutAt={session.planned_checkout_at}
            />

            {/* Action buttons */}
            <ActionButtons
              sessionStatus={sessionStatus}
              isCheckingOut={isCheckingOut}
              onCheckout={() => setCheckoutDialogOpen(true)}
              onBreak={() => setBreakDialogOpen(true)}
            />

            {/* Next candidates */}
            {nextCandidates.length > 0 && (
              <TaskSwitcher
                candidates={nextCandidates}
                onSelect={(taskId) => {
                  setSelectedNextTaskId(taskId);
                  setCheckoutDialogOpen(true);
                }}
              />
            )}
          </>
        )}

        {/* Idle state - no active session */}
        {!session && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">タスクを開始</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasSchedule ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    本日のスケジュールからタスクを選択して作業を開始します。
                  </p>
                  <TaskSwitcher
                    candidates={nextCandidates}
                    onSelect={() => setStartDialogOpen(true)}
                    isSelectionMode
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  スケジュールがないため、タスクを開始できません。
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dialogs */}
        <StartSessionDialog
          open={startDialogOpen}
          onOpenChange={setStartDialogOpen}
          candidates={todaySchedule?.plan_json?.assignments ?? []}
          isStarting={isStarting}
          onStart={async (taskId, plannedCheckoutAt, plannedOutcome) => {
            try {
              await startSession(taskId, plannedCheckoutAt, plannedOutcome);
              setStartDialogOpen(false);
            } catch (error) {
              console.error('Start session failed:', error);
            }
          }}
        />

        <CheckoutDialog
          open={checkoutDialogOpen}
          onOpenChange={(open) => {
            setCheckoutDialogOpen(open);
            if (!open) setSelectedNextTaskId(null);
          }}
          session={session}
          sessionDetails={sessionDetails}
          isCheckingOut={isCheckingOut}
          selectedNextTaskId={selectedNextTaskId}
          onCheckout={async (decision, options) => {
            try {
              await checkout(decision, options);
              setCheckoutDialogOpen(false);
              setSelectedNextTaskId(null);
            } catch (error) {
              console.error('Checkout failed:', error);
            }
          }}
        />

        <BreakDialog
          open={breakDialogOpen}
          onOpenChange={setBreakDialogOpen}
          isProcessing={isCheckingOut}
          onConfirm={async () => {
            try {
              await checkout('break');
              setBreakDialogOpen(false);
            } catch (error) {
              console.error('Break checkout failed:', error);
            }
          }}
        />
      </main>
    </div>
  );
}
