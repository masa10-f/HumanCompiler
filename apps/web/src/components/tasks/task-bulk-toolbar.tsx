'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Layers3 } from 'lucide-react';

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
import { toast } from '@/hooks/use-toast';
import { tasksApi } from '@/lib/api';
import { getJSTDateString } from '@/lib/date-utils';
import type { Goal } from '@/types/goal';
import type {
  BulkTaskMutation,
  BulkTaskPreview,
  TaskStatus,
} from '@/types/task';

type BulkAction =
  | 'status'
  | 'priority'
  | 'due_date'
  | 'goal'
  | 'cancel'
  | 'daily_add'
  | 'daily_remove'
  | 'weekly_add'
  | 'weekly_remove'
  | 'natural';

function currentWeekStart(): string {
  const today = getJSTDateString();
  const date = new Date(`${today}T12:00:00+09:00`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

interface TaskBulkToolbarProps {
  selectedTaskIds: string[];
  goals: Goal[];
  onClear: () => void;
  onApplied: () => void;
}

export function TaskBulkToolbar({
  selectedTaskIds,
  goals,
  onClear,
  onApplied,
}: TaskBulkToolbarProps) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<BulkAction>('status');
  const [value, setValue] = useState('pending');
  const [targetDate, setTargetDate] = useState(getJSTDateString());
  const [instruction, setInstruction] = useState('');
  const [preview, setPreview] = useState<BulkTaskPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const weekStart = useMemo(currentWeekStart, []);

  if (selectedTaskIds.length === 0) return null;

  const buildMutations = (): BulkTaskMutation[] =>
    selectedTaskIds.map((taskId) => {
      const mutation: BulkTaskMutation = { task_id: taskId, patch: {}, plans: [] };
      if (action === 'status') mutation.patch = { status: value as TaskStatus };
      if (action === 'priority') mutation.patch = { priority: Number(value) };
      if (action === 'due_date') {
        mutation.patch = { due_date: value ? `${value}T00:00:00+09:00` : null };
      }
      if (action === 'goal') mutation.patch = { goal_id: value };
      if (action === 'cancel') mutation.patch = { status: 'cancelled' };
      if (action.startsWith('daily_') || action.startsWith('weekly_')) {
        const [scope, operation] = action.split('_') as [
          'daily' | 'weekly',
          'add' | 'remove',
        ];
        mutation.plans = [
          {
            scope,
            action: operation,
            target_date: targetDate,
          },
        ];
      }
      return mutation;
    });

  const runPreview = async () => {
    setIsPreviewing(true);
    try {
      const result =
        action === 'natural'
          ? await tasksApi.previewNaturalLanguage(instruction, selectedTaskIds)
          : await tasksApi.previewBulk(buildMutations());
      setPreview(result);
    } catch (error) {
      toast({
        title: '変更案を作成できませんでした',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <>
      <div className="sticky top-2 z-20 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-2 text-sm font-medium">
            <Layers3 className="h-4 w-4" />
            {selectedTaskIds.length}件選択
          </div>
          <select
            aria-label="一括操作"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={action}
            onChange={(event) => {
              const next = event.target.value as BulkAction;
              setAction(next);
              if (next === 'status') setValue('pending');
              if (next === 'priority') setValue('3');
              if (next === 'goal') setValue(goals[0]?.id ?? '');
              if (next === 'daily_add' || next === 'daily_remove')
                setTargetDate(getJSTDateString());
              if (next === 'weekly_add' || next === 'weekly_remove')
                setTargetDate(weekStart);
            }}
          >
            <option value="status">ステータス変更</option>
            <option value="priority">優先度変更</option>
            <option value="due_date">期限変更</option>
            <option value="goal">所属ゴール変更</option>
            <option value="daily_add">今日／指定日に追加</option>
            <option value="daily_remove">今日／指定日から除外</option>
            <option value="weekly_add">週次計画に追加</option>
            <option value="weekly_remove">週次計画から除外</option>
            <option value="cancel">キャンセル</option>
            <option value="natural">AIに自然言語で依頼</option>
          </select>

          {action === 'status' && (
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="pending">未着手</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
              <option value="cancelled">キャンセル</option>
            </select>
          )}
          {action === 'priority' && (
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
              {[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>P{priority}</option>)}
            </select>
          )}
          {action === 'goal' && (
            <select className="h-9 max-w-56 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
              {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          )}
          {action === 'due_date' && (
            <Input className="h-9 w-40" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {(action.startsWith('daily_') || action.startsWith('weekly_')) && (
            <Input className="h-9 w-40" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          )}
          {action === 'natural' && (
            <div className="relative min-w-64 flex-1">
              <Bot className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-9" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例: すべて来週に移して優先度を2にする" />
            </div>
          )}
          <Button size="sm" onClick={runPreview} disabled={isPreviewing || (action === 'natural' && !instruction.trim())}>
            {isPreviewing ? '確認中...' : '差分を確認'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>選択解除</Button>
        </div>
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.affected_count ?? 0}件の変更を適用しますか？</DialogTitle>
            <DialogDescription>内容を確認するまでデータは変更されません。</DialogDescription>
          </DialogHeader>
          {preview?.interpretation && <p className="rounded-md bg-muted p-3 text-sm">{preview.interpretation}</p>}
          <div className="space-y-2">
            {preview?.items.map((item) => (
              <div key={item.task_id} className="rounded-md border p-3">
                <div className="font-medium">{item.title}</div>
                {item.diffs.length === 0 ? (
                  <div className="mt-1 text-xs text-muted-foreground">変更なし</div>
                ) : item.diffs.map((diff) => (
                  <div key={diff.field} className="mt-1 text-xs">
                    {diff.field}: {String(diff.before ?? 'なし')} → {String(diff.after ?? 'なし')}
                  </div>
                ))}
              </div>
            ))}
            {preview?.warnings.map((warning) => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>戻る</Button>
            <Button
              disabled={isApplying || !preview || preview.affected_count === 0}
              onClick={async () => {
                if (!preview) return;
                setIsApplying(true);
                try {
                  await tasksApi.applyBulk({
                    mutations: preview.mutations,
                    expected_task_versions: preview.expected_task_versions,
                    expected_plan_versions: preview.expected_plan_versions,
                  });
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
                    queryClient.invalidateQueries({ queryKey: ['schedule'] }),
                  ]);
                  toast({ title: `${preview.affected_count}件を更新しました` });
                  setPreview(null);
                  onClear();
                  onApplied();
                } catch (error) {
                  toast({
                    title: '一括変更を適用できませんでした',
                    description: error instanceof Error ? error.message : undefined,
                    variant: 'destructive',
                  });
                } finally {
                  setIsApplying(false);
                }
              }}
            >
              {isApplying ? '適用中...' : '確認して適用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
