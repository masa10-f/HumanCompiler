'use client';

import { useAuth } from '@/hooks/use-auth';
import { useRunner } from '@/hooks/use-runner';
import { useReschedule } from '@/hooks/use-reschedule';
import { AppHeader } from '@/components/layout/app-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SessionDisplay } from './session-display';
import { CountdownTimer } from './countdown-timer';
import { ActionButtons } from './action-buttons';
import { TaskSwitcher } from './task-switcher';
import { TaskNotesSection } from './task-notes-section';
import { StartSessionDialog } from './start-session-dialog';
import { ManualTaskSelectDialog } from './manual-task-select-dialog';
import { CheckoutDialog } from './checkout-dialog';
import { PauseDialog } from './pause-dialog';
import { ResumeDialog } from './resume-dialog';
import { NotificationBanner } from './notification-banner';
import { RescheduleSuggestionCard } from './reschedule-suggestion-card';
import { useState } from 'react';
import { Play, AlertCircle, Pause, FolderOpen, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatDuration } from '@/types/runner';
import type { RescheduleSuggestion } from '@/types/reschedule';

export function RunnerPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    session,
    sessionDetails,
    sessionStatus,
    remainingSeconds,
    isOverdue,
    isPaused,
    nextCandidates,
    todaySchedule,
    isLoading,
    isStarting,
    isCheckingOut,
    isPausing,
    isResuming,
    startSession,
    checkout,
    pauseSession,
    resumeSession,
    currentNotification,
    dismissNotification,
    snoozeSession,
    isSnoozing,
    snoozeCount,
    maxSnoozeCount,
  } = useRunner();

  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [manualTaskDialogOpen, setManualTaskDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [selectedNextTaskId, setSelectedNextTaskId] = useState<string | null>(null);

  // Issue #227: Reschedule suggestion state
  const [lastRescheduleSuggestion, setLastRescheduleSuggestion] = useState<RescheduleSuggestion | null>(null);
  const {
    acceptSuggestion,
    rejectSuggestion,
    isAccepting,
    isRejecting,
  } = useReschedule();

  // Calculate paused duration for resume dialog
  const pausedDuration = session?.paused_at
    ? formatDuration(
        Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000)
      )
    : '0:00:00';

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
          {sessionStatus === 'paused' && (
            <span className="px-3 py-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 rounded-full text-sm font-medium flex items-center gap-1">
              <Pause className="h-3 w-3" />
              一時停止中
            </span>
          )}
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

            {/* Task notes */}
            <TaskNotesSection taskId={sessionDetails.task.id} />

            {/* Countdown timer */}
            <CountdownTimer
              remainingSeconds={remainingSeconds}
              isOverdue={isOverdue}
              isPaused={isPaused}
              startedAt={session.started_at}
              plannedCheckoutAt={session.planned_checkout_at}
              pausedAt={session.paused_at}
            />

            {/* Action buttons */}
            <ActionButtons
              sessionStatus={sessionStatus}
              isCheckingOut={isCheckingOut}
              isPausing={isPausing}
              isResuming={isResuming}
              onCheckout={() => setCheckoutDialogOpen(true)}
              onPause={() => setPauseDialogOpen(true)}
              onResume={() => setResumeDialogOpen(true)}
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
          <>
            {/* Issue #227: Reschedule suggestion after checkout */}
            {lastRescheduleSuggestion && lastRescheduleSuggestion.status === 'pending' && (
              <RescheduleSuggestionCard
                suggestion={lastRescheduleSuggestion}
                onAccept={async (suggestionId) => {
                  await acceptSuggestion(suggestionId);
                  setLastRescheduleSuggestion(null);
                }}
                onReject={async (suggestionId) => {
                  await rejectSuggestion(suggestionId);
                  setLastRescheduleSuggestion(null);
                }}
                isAccepting={isAccepting}
                isRejecting={isRejecting}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">タスクを開始</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Action buttons for starting session */}
                <div className="flex gap-3">
                  <Button
                    onClick={() => setStartDialogOpen(true)}
                    disabled={!hasSchedule}
                    className="flex-1"
                    variant="default"
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    スケジュールから選択
                  </Button>
                  <Button
                    onClick={() => setManualTaskDialogOpen(true)}
                    className="flex-1"
                    variant="outline"
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    手動でタスクを選択
                  </Button>
                </div>

                {hasSchedule ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      本日のスケジュールからタスクを選択するか、手動でタスクを選択して作業を開始できます。
                    </p>
                    <TaskSwitcher
                      candidates={nextCandidates}
                      onSelect={() => setStartDialogOpen(true)}
                      isSelectionMode
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    本日のスケジュールがありません。「手動でタスクを選択」からタスクを選んで作業を開始できます。
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Dialogs */}
        <StartSessionDialog
          open={startDialogOpen}
          onOpenChange={setStartDialogOpen}
          candidates={todaySchedule?.plan_json?.assignments ?? []}
          isStarting={isStarting}
          onStart={async (taskId, plannedCheckoutAt, plannedOutcome) => {
            try {
              await startSession(taskId, plannedCheckoutAt, plannedOutcome, false);
              setStartDialogOpen(false);
            } catch (error) {
              console.error('Start session failed:', error);
            }
          }}
        />

        <ManualTaskSelectDialog
          open={manualTaskDialogOpen}
          onOpenChange={setManualTaskDialogOpen}
          isStarting={isStarting}
          onStart={async (taskId, plannedCheckoutAt, plannedOutcome, isManualExecution) => {
            try {
              await startSession(taskId, plannedCheckoutAt, plannedOutcome, isManualExecution);
              setManualTaskDialogOpen(false);
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
              const rescheduleSuggestion = await checkout(decision, options);
              setCheckoutDialogOpen(false);
              setSelectedNextTaskId(null);
              // Issue #227: Save reschedule suggestion for display
              if (rescheduleSuggestion) {
                setLastRescheduleSuggestion(rescheduleSuggestion);
              }
            } catch (error) {
              console.error('Checkout failed:', error);
            }
          }}
        />

        <PauseDialog
          open={pauseDialogOpen}
          onOpenChange={setPauseDialogOpen}
          isProcessing={isPausing}
          onConfirm={async () => {
            try {
              await pauseSession();
              setPauseDialogOpen(false);
            } catch (error) {
              console.error('Pause failed:', error);
            }
          }}
        />

        <ResumeDialog
          open={resumeDialogOpen}
          onOpenChange={setResumeDialogOpen}
          isProcessing={isResuming}
          pausedDuration={pausedDuration}
          onConfirm={async (extendCheckout) => {
            try {
              await resumeSession(extendCheckout);
              setResumeDialogOpen(false);
            } catch (error) {
              console.error('Resume failed:', error);
            }
          }}
        />
      </main>
    </div>
  );
}
