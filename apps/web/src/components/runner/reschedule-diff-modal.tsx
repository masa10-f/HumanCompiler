/**
 * Reschedule Diff Modal for detailed schedule change view (Issue #227)
 *
 * Shows a detailed breakdown of schedule changes with visual indicators:
 * - Pushed (orange): Tasks pushed back due to overrun
 * - Added (green): New tasks added to fill time
 * - Removed (gray): Tasks deferred to later
 * - Reordered (yellow): Tasks that changed position
 */

'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, ArrowDown, Plus, Minus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RescheduleSuggestion, ScheduleDiffItem, ScheduleChangeType } from '@/types/reschedule';
import { CHANGE_TYPE_LABELS, CHANGE_TYPE_COLORS } from '@/types/reschedule';

interface RescheduleDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: RescheduleSuggestion;
}

const changeTypeIcons: Record<ScheduleChangeType, typeof ArrowDown> = {
  pushed: ArrowDown,
  added: Plus,
  removed: Minus,
  reordered: RefreshCw,
};

function DiffItemRow({ item, showSlotChange = true }: { item: ScheduleDiffItem; showSlotChange?: boolean }) {
  const Icon = changeTypeIcons[item.change_type as ScheduleChangeType];
  const colors = CHANGE_TYPE_COLORS[item.change_type as ScheduleChangeType];

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border',
        colors.bg,
        colors.border
      )}
    >
      <div className={cn('mt-0.5', colors.text)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('font-medium', colors.text)}>{item.task_title}</span>
          {showSlotChange && item.original_slot_index !== null && item.new_slot_index !== null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              スロット {item.original_slot_index + 1}
              <ArrowRight className="h-3 w-3" />
              {item.new_slot_index + 1}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{item.reason}</p>
      </div>
    </div>
  );
}

function DiffSection({
  title,
  items,
  changeType,
  showSlotChange = true,
}: {
  title: string;
  items: ScheduleDiffItem[];
  changeType: ScheduleChangeType;
  showSlotChange?: boolean;
}) {
  if (items.length === 0) return null;

  const colors = CHANGE_TYPE_COLORS[changeType];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            'font-medium',
            colors.bg,
            colors.text,
            colors.border
          )}
        >
          {title}
        </Badge>
        <span className="text-sm text-muted-foreground">{items.length}件</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <DiffItemRow key={item.task_id} item={item} showSlotChange={showSlotChange} />
        ))}
      </div>
    </div>
  );
}

export function RescheduleDiffModal({
  open,
  onOpenChange,
  suggestion,
}: RescheduleDiffModalProps) {
  const diff = suggestion.diff;

  if (!diff) {
    return null;
  }

  const triggerLabel =
    suggestion.trigger_type === 'checkout' ? 'チェックアウト' : '超過回復';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>スケジュール変更の詳細</DialogTitle>
          <DialogDescription>
            {triggerLabel}時のデータに基づく調整内容
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-4">
          <div className="space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className={cn('p-2 rounded-lg', CHANGE_TYPE_COLORS.pushed.bg)}>
                <div className={cn('text-lg font-bold', CHANGE_TYPE_COLORS.pushed.text)}>
                  {diff.pushed_tasks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {CHANGE_TYPE_LABELS.pushed}
                </div>
              </div>
              <div className={cn('p-2 rounded-lg', CHANGE_TYPE_COLORS.removed.bg)}>
                <div className={cn('text-lg font-bold', CHANGE_TYPE_COLORS.removed.text)}>
                  {diff.removed_tasks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {CHANGE_TYPE_LABELS.removed}
                </div>
              </div>
              <div className={cn('p-2 rounded-lg', CHANGE_TYPE_COLORS.added.bg)}>
                <div className={cn('text-lg font-bold', CHANGE_TYPE_COLORS.added.text)}>
                  {diff.added_tasks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {CHANGE_TYPE_LABELS.added}
                </div>
              </div>
              <div className={cn('p-2 rounded-lg', CHANGE_TYPE_COLORS.reordered.bg)}>
                <div className={cn('text-lg font-bold', CHANGE_TYPE_COLORS.reordered.text)}>
                  {diff.reordered_tasks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {CHANGE_TYPE_LABELS.reordered}
                </div>
              </div>
            </div>

            {/* Detailed sections */}
            <DiffSection
              title={CHANGE_TYPE_LABELS.pushed}
              items={diff.pushed_tasks}
              changeType="pushed"
            />

            <DiffSection
              title={CHANGE_TYPE_LABELS.removed}
              items={diff.removed_tasks}
              changeType="removed"
              showSlotChange={false}
            />

            <DiffSection
              title={CHANGE_TYPE_LABELS.added}
              items={diff.added_tasks}
              changeType="added"
              showSlotChange={false}
            />

            <DiffSection
              title={CHANGE_TYPE_LABELS.reordered}
              items={diff.reordered_tasks}
              changeType="reordered"
            />

            {diff.total_changes === 0 && (
              <p className="text-center text-muted-foreground py-8">
                変更はありません
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
