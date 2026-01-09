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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import type { DailySchedule } from '@/types/api-responses';

type Assignment = DailySchedule['plan_json']['assignments'][number];

interface StartSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: Assignment[];
  isStarting: boolean;
  onStart: (
    taskId: string,
    plannedCheckoutAt: string,
    plannedOutcome?: string
  ) => Promise<void>;
}

export function StartSessionDialog({
  open,
  onOpenChange,
  candidates,
  isStarting,
  onStart,
}: StartSessionDialogProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [duration, setDuration] = useState<number>(60); // minutes
  const [plannedOutcome, setPlannedOutcome] = useState('');

  // Get selected task info
  const selectedTask = candidates.find((c) => c.task_id === selectedTaskId);

  // Calculate planned checkout time
  const calculateCheckoutTime = (): string => {
    const now = new Date();
    const checkoutTime = new Date(now.getTime() + duration * 60 * 1000);
    return checkoutTime.toISOString();
  };

  const handleStart = async () => {
    if (!selectedTaskId) return;
    await onStart(
      selectedTaskId,
      calculateCheckoutTime(),
      plannedOutcome || undefined
    );
    // Reset form
    setSelectedTaskId('');
    setDuration(60);
    setPlannedOutcome('');
  };

  const handleClose = () => {
    setSelectedTaskId('');
    setDuration(60);
    setPlannedOutcome('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>セッション開始</DialogTitle>
          <DialogDescription>
            作業するタスクを選択し、チェックアウト時間を設定してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Task selection */}
          <div className="space-y-3">
            <Label>タスク選択</Label>
            <RadioGroup
              value={selectedTaskId}
              onValueChange={setSelectedTaskId}
              className="space-y-2"
            >
              {candidates.map((assignment) => (
                <div
                  key={assignment.task_id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center space-x-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={() => setSelectedTaskId(assignment.task_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedTaskId(assignment.task_id);
                    }
                  }}
                >
                  <RadioGroupItem
                    value={assignment.task_id}
                    id={assignment.task_id}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor={assignment.task_id}
                      className="font-medium text-sm cursor-pointer"
                    >
                      {assignment.task_title}
                    </label>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        {assignment.start_time} ({assignment.duration_hours}h)
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Duration setting */}
          <div className="space-y-3">
            <Label htmlFor="duration">作業時間（分）</Label>
            <div className="flex items-center gap-4">
              <Input
                id="duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-24"
              />
              <div className="flex gap-2">
                {[25, 50, 60, 90, 120].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={duration === mins ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDuration(mins)}
                  >
                    {mins}分
                  </Button>
                ))}
              </div>
            </div>
            {selectedTask && (
              <p className="text-xs text-muted-foreground">
                予定: {selectedTask.duration_hours}時間（{selectedTask.duration_hours * 60}分）
              </p>
            )}
          </div>

          {/* Planned outcome */}
          <div className="space-y-3">
            <Label htmlFor="planned-outcome">今回の目標（任意）</Label>
            <Textarea
              id="planned-outcome"
              placeholder="このセッションで達成したいことを書いてください"
              value={plannedOutcome}
              onChange={(e) => setPlannedOutcome(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isStarting}>
            キャンセル
          </Button>
          <Button
            onClick={handleStart}
            disabled={!selectedTaskId || isStarting}
          >
            {isStarting ? '開始中...' : '開始'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
