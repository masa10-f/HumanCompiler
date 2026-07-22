'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useWorkSessionResumeContext } from '@/hooks/use-work-sessions';
import type { SwitchDisposition } from '@/types/work-session';
import type { TaskWorkspaceItem } from '@/types/task';

interface TaskSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskWorkspaceItem | null;
  isSwitching: boolean;
  onSwitch: (
    taskId: string,
    disposition: SwitchDisposition,
    note: string | undefined,
    plannedCheckoutAt: string,
    plannedOutcome?: string,
  ) => Promise<void>;
}

export function TaskSwitchDialog({
  open,
  onOpenChange,
  task,
  isSwitching,
  onSwitch,
}: TaskSwitchDialogProps) {
  const [disposition, setDisposition] = useState<SwitchDisposition>('pause');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState(60);
  const [outcome, setOutcome] = useState('');
  const resumeContext = useWorkSessionResumeContext(task?.id);

  useEffect(() => {
    if (!open) {
      setDisposition('pause');
      setNote('');
      setDuration(60);
      setOutcome('');
    }
  }, [open]);
  if (!task) return null;
  const noteRequired = disposition !== 'complete';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>「{task.title}」へ切り替える</DialogTitle>
          <DialogDescription>
            現在のセッションを記録してから、次のセッションを開始します。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {resumeContext.data && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                前回の中断（{new Date(resumeContext.data.interrupted_at).toLocaleString('ja-JP')}）: {resumeContext.data.interruption_note}
                {resumeContext.data.remaining_estimate_hours != null &&
                  `（残り ${resumeContext.data.remaining_estimate_hours}h）`}
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>現在のタスクの扱い</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['complete', '完了'],
                ['pause', '一時停止して切替'],
                ['defer', '後回し'],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={disposition === value ? 'default' : 'outline'}
                  onClick={() => setDisposition(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {noteRequired && (
            <div className="space-y-2">
              <Label htmlFor="interruption-note">中断メモ</Label>
              <Textarea
                id="interruption-note"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="次回どこから再開するかを記録"
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="switch-duration">次の作業時間（分）</Label>
              <Input
                id="switch-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-outcome">次の目標（任意）</Label>
              <Input
                id="switch-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            disabled={isSwitching || duration < 5 || (noteRequired && !note.trim())}
            onClick={async () => {
              const checkout = new Date(Date.now() + duration * 60 * 1000).toISOString();
              await onSwitch(
                task.id,
                disposition,
                noteRequired ? note.trim() : undefined,
                checkout,
                outcome.trim() || undefined,
              );
              onOpenChange(false);
            }}
          >
            {isSwitching ? '切替中...' : '記録して切替'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
