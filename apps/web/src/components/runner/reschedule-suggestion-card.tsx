/**
 * Reschedule Suggestion Card for Runner UI (Issue #227)
 *
 * Displayed after checkout when schedule changes are detected.
 * Shows a summary of changes and provides accept/reject actions.
 */

'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RescheduleSuggestion } from '@/types/reschedule';
import { CHANGE_TYPE_LABELS, CHANGE_TYPE_COLORS } from '@/types/reschedule';
import { RescheduleDiffModal } from './reschedule-diff-modal';

interface RescheduleSuggestionCardProps {
  suggestion: RescheduleSuggestion;
  onAccept: (suggestionId: string, reason?: string) => Promise<void>;
  onReject: (suggestionId: string, reason?: string) => Promise<void>;
  isAccepting?: boolean;
  isRejecting?: boolean;
}

export function RescheduleSuggestionCard({
  suggestion,
  onAccept,
  onReject,
  isAccepting = false,
  isRejecting = false,
}: RescheduleSuggestionCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const diff = suggestion.diff;
  const isPending = suggestion.status === 'pending';

  if (!diff || !diff.has_significant_changes) {
    return null;
  }

  const handleAccept = async () => {
    await onAccept(suggestion.id);
  };

  const handleReject = async () => {
    await onReject(suggestion.id);
  };

  return (
    <>
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <CardTitle className="text-lg">スケジュール調整の提案</CardTitle>
          </div>
          <CardDescription>
            チェックアウトに基づいて、本日のスケジュールを調整できます
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-3">
          {/* Change summary badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {diff.pushed_tasks.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'font-medium',
                  CHANGE_TYPE_COLORS.pushed.bg,
                  CHANGE_TYPE_COLORS.pushed.text,
                  CHANGE_TYPE_COLORS.pushed.border
                )}
              >
                {CHANGE_TYPE_LABELS.pushed}: {diff.pushed_tasks.length}件
              </Badge>
            )}
            {diff.removed_tasks.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'font-medium',
                  CHANGE_TYPE_COLORS.removed.bg,
                  CHANGE_TYPE_COLORS.removed.text,
                  CHANGE_TYPE_COLORS.removed.border
                )}
              >
                {CHANGE_TYPE_LABELS.removed}: {diff.removed_tasks.length}件
              </Badge>
            )}
            {diff.added_tasks.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'font-medium',
                  CHANGE_TYPE_COLORS.added.bg,
                  CHANGE_TYPE_COLORS.added.text,
                  CHANGE_TYPE_COLORS.added.border
                )}
              >
                {CHANGE_TYPE_LABELS.added}: {diff.added_tasks.length}件
              </Badge>
            )}
            {diff.reordered_tasks.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'font-medium',
                  CHANGE_TYPE_COLORS.reordered.bg,
                  CHANGE_TYPE_COLORS.reordered.text,
                  CHANGE_TYPE_COLORS.reordered.border
                )}
              >
                {CHANGE_TYPE_LABELS.reordered}: {diff.reordered_tasks.length}件
              </Badge>
            )}
          </div>

          {/* Expandable preview */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-muted-foreground"
            onClick={() => setShowDetails(!showDetails)}
          >
            <span>変更の詳細を見る</span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          {showDetails && (
            <div className="mt-3 space-y-2 text-sm">
              {/* Pushed tasks */}
              {diff.pushed_tasks.length > 0 && (
                <div>
                  <p className="font-medium text-orange-700 dark:text-orange-400">
                    後ろにずれたタスク:
                  </p>
                  <ul className="ml-4 list-disc">
                    {diff.pushed_tasks.map((item) => (
                      <li key={item.task_id}>{item.task_title}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Removed tasks */}
              {diff.removed_tasks.length > 0 && (
                <div>
                  <p className="font-medium text-gray-600 dark:text-gray-400">
                    延期されたタスク:
                  </p>
                  <ul className="ml-4 list-disc">
                    {diff.removed_tasks.map((item) => (
                      <li key={item.task_id}>{item.task_title}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Added tasks */}
              {diff.added_tasks.length > 0 && (
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">
                    追加されたタスク:
                  </p>
                  <ul className="ml-4 list-disc">
                    {diff.added_tasks.map((item) => (
                      <li key={item.task_id}>{item.task_title}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reordered tasks */}
              {diff.reordered_tasks.length > 0 && (
                <div>
                  <p className="font-medium text-yellow-700 dark:text-yellow-400">
                    順序が変わったタスク:
                  </p>
                  <ul className="ml-4 list-disc">
                    {diff.reordered_tasks.map((item) => (
                      <li key={item.task_id}>{item.task_title}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                variant="link"
                size="sm"
                className="p-0 h-auto"
                onClick={() => setShowModal(true)}
              >
                詳細を表示
              </Button>
            </div>
          )}
        </CardContent>

        {isPending && (
          <CardFooter className="flex gap-2 pt-0">
            <Button
              onClick={handleAccept}
              disabled={isAccepting || isRejecting}
              className="flex-1"
            >
              {isAccepting ? (
                '処理中...'
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  採用する
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={isAccepting || isRejecting}
              className="flex-1"
            >
              {isRejecting ? (
                '処理中...'
              ) : (
                <>
                  <X className="h-4 w-4 mr-1" />
                  今回は採用しない
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>

      <RescheduleDiffModal
        open={showModal}
        onOpenChange={setShowModal}
        suggestion={suggestion}
      />
    </>
  );
}
