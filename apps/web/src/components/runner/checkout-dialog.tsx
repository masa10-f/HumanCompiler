'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WorkSession, SessionDecision, ContinueReason } from '@/types/work-session';
import {
  SESSION_DECISION_LABELS,
  CONTINUE_REASON_LABELS,
} from '@/types/work-session';
import type { CurrentSessionDetails, CheckoutOptions } from '@/types/runner';
import { EMPTY_KPT, KptFields, type KptValues } from '@/components/work-records/kpt-fields';
import {
  RemainingEstimateField,
  remainingHoursError,
} from '@/components/work-records/remaining-estimate-field';

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkSession | null;
  sessionDetails: CurrentSessionDetails | null;
  isCheckingOut: boolean;
  selectedNextTaskId?: string | null;
  onCheckout: (decision: SessionDecision, options?: CheckoutOptions) => Promise<void>;
}

export function CheckoutDialog({
  open,
  onOpenChange,
  session,
  sessionDetails,
  isCheckingOut,
  selectedNextTaskId,
  onCheckout,
}: CheckoutDialogProps) {
  const [decision, setDecision] = useState<SessionDecision>('switch');
  const [continueReason, setContinueReason] = useState<ContinueReason | ''>('');
  const [kpt, setKpt] = useState<KptValues>(EMPTY_KPT);
  const [remainingHours, setRemainingHours] = useState<number | undefined>(undefined);

  // KPT validation for continue decision
  const hasAtLeastOneKpt =
    kpt.keep.trim() !== '' || kpt.problem.trim() !== '' || kpt.try.trim() !== '';
  // A finished task has nothing left, whatever the field says.
  const completing = decision === 'complete';
  const remainingError = completing ? undefined : remainingHoursError(remainingHours);

  // Calculate elapsed work time
  const elapsedMinutes = session
    ? Math.floor(
        (Date.now() - new Date(session.started_at).getTime()) / (1000 * 60)
      )
    : 0;
  const elapsedHours = (elapsedMinutes / 60).toFixed(1);

  const resetForm = () => {
    setDecision('switch');
    setContinueReason('');
    setKpt(EMPTY_KPT);
    setRemainingHours(undefined);
  };

  const handleCheckout = async () => {
    const options: CheckoutOptions = {};

    if (decision === 'continue' && continueReason) {
      options.continue_reason = continueReason;
    }

    if (decision === 'switch' && selectedNextTaskId) {
      options.next_task_id = selectedNextTaskId;
    }

    if (kpt.keep) options.kpt_keep = kpt.keep;
    if (kpt.problem) options.kpt_problem = kpt.problem;
    if (kpt.try) options.kpt_try = kpt.try;

    if (!completing && remainingHours !== undefined) {
      options.remaining_estimate_hours = remainingHours;
    }

    await onCheckout(decision, options);
    resetForm();
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  if (!session || !sessionDetails) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>チェックアウト</DialogTitle>
          <DialogDescription>
            作業を記録し、次のアクションを選択してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Session summary */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 space-y-2">
            <p className="font-medium">{sessionDetails.task.title}</p>
            <p className="text-sm text-muted-foreground">
              作業時間: {elapsedHours}時間（{elapsedMinutes}分）
            </p>
          </div>

          {/* Decision selection */}
          <div className="space-y-3">
            <Label>次のアクション</Label>
            <RadioGroup
              value={decision}
              onValueChange={(v: string) => setDecision(v as SessionDecision)}
              className="grid grid-cols-2 gap-2"
            >
              {(Object.keys(SESSION_DECISION_LABELS) as SessionDecision[]).map(
                (key) => (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    onClick={() => setDecision(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDecision(key);
                      }
                    }}
                  >
                    <RadioGroupItem value={key} id={`decision-${key}`} />
                    <label
                      htmlFor={`decision-${key}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {SESSION_DECISION_LABELS[key]}
                    </label>
                  </div>
                )
              )}
            </RadioGroup>
          </div>

          {/* Continue reason (only for continue) */}
          {decision === 'continue' && (
            <div className="space-y-3">
              <Label htmlFor="continue-reason">継続理由</Label>
              <Select
                value={continueReason}
                onValueChange={(v) => setContinueReason(v as ContinueReason)}
              >
                <SelectTrigger id="continue-reason">
                  <SelectValue placeholder="理由を選択" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTINUE_REASON_LABELS) as ContinueReason[]).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {CONTINUE_REASON_LABELS[key]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Remaining estimate: the same field a time record entered by hand has */}
          <div className="border-t pt-4">
            <RemainingEstimateField
              id="remaining-estimate"
              value={remainingHours}
              onChange={setRemainingHours}
              currentEstimateHours={sessionDetails.task.estimate_hours}
              disabled={completing}
              error={remainingError}
            />
          </div>

          {/* KPT reflection */}
          <div className="space-y-4 border-t pt-4">
            <p className="text-sm font-medium text-muted-foreground">
              振り返り{decision === 'continue' ? '（必須）' : '（任意）'}
            </p>
            {decision === 'continue' && !hasAtLeastOneKpt && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ※継続する場合、少なくとも1つのKPT項目を入力してください
              </p>
            )}
            <KptFields idPrefix="kpt" value={kpt} onChange={setKpt} />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isCheckingOut}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleCheckout}
            disabled={
              isCheckingOut ||
              Boolean(remainingError) ||
              (decision === 'continue' && !continueReason) ||
              (decision === 'continue' && !hasAtLeastOneKpt)
            }
          >
            {isCheckingOut ? '処理中...' : 'チェックアウト'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
