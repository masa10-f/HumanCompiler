// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatDigestHours, getGoalDigest } from '@/lib/goal-digest'
import type { GoalProgress } from '@/types/progress'

interface GoalDigestProps {
  estimateHours: number
  /** Undefined while project progress is loading or unavailable. */
  progress?: GoalProgress
}

/**
 * Compact summary of how far a goal has come: task completion rate,
 * logged time against the estimate and the estimate still left.
 */
export function GoalDigest({ estimateHours, progress }: GoalDigestProps) {
  if (!progress) {
    return (
      <div className="text-sm text-muted-foreground">
        見積 {formatDigestHours(Number(estimateHours) || 0)}h
      </div>
    )
  }

  const digest = getGoalDigest(progress, estimateHours)

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">達成率</span>
        {digest.completionRate === null ? (
          <span className="text-xs text-muted-foreground">タスク未登録</span>
        ) : (
          <span className="font-semibold tabular-nums">{digest.completionRate}%</span>
        )}
      </div>
      <Progress
        value={digest.completionRate ?? 0}
        className="h-2"
        aria-label="タスク達成率"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {digest.totalTasks > 0 && (
          <span className="tabular-nums">
            {digest.completedTasks}/{digest.totalTasks} タスク完了
          </span>
        )}
        <span
          className={cn(
            'tabular-nums',
            digest.isOverEstimate && 'font-medium text-destructive',
          )}
        >
          実績 {formatDigestHours(digest.actualHours)}h / 見積{' '}
          {formatDigestHours(digest.estimateHours)}h
        </span>
        {digest.remainingEstimateHours > 0 && (
          <span className="tabular-nums">
            残り {formatDigestHours(digest.remainingEstimateHours)}h
          </span>
        )}
      </div>
    </div>
  )
}
