'use client'

import { memo, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GoalStatusDropdown } from './goal-status-dropdown'
import { GoalDependencies } from './goal-dependencies'
import { GoalDigest } from './goal-digest'
import { GoalEditDialog } from './goal-edit-dialog'
import { GoalDeleteDialog } from './goal-delete-dialog'
import { CalendarDays, GitBranch } from 'lucide-react'
import { safeFormatJapaneseDate } from '@/lib/date-utils'
import { getDueState, getDueStateLabel, type DueState } from '@/lib/goal-digest'
import { getBlockingGoalDependencies } from '@/lib/status-groups'
import { cn } from '@/lib/utils'
import type { Goal } from '@/types/goal'
import type { GoalProgress } from '@/types/progress'

const DUE_STATE_CLASSNAMES: Record<DueState['kind'], string> = {
  overdue: 'bg-destructive/10 text-destructive',
  today: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  soon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  later: 'bg-muted text-muted-foreground',
}

interface GoalCardProps {
  goal: Goal
  allGoals: Goal[]
  /** Progress for this goal from the project progress endpoint. */
  progress?: GoalProgress
  onNavigate: (goalId: string) => void
}

export const GoalCard = memo(function GoalCard({
  goal,
  allGoals,
  progress,
  onNavigate,
}: GoalCardProps) {
  const isOpen = goal.status === 'pending' || goal.status === 'in_progress'
  const dueState = isOpen ? getDueState(goal.due_date) : null
  const blockingCount = useMemo(
    () => (isOpen ? getBlockingGoalDependencies(goal, allGoals).length : 0),
    [allGoals, goal, isOpen],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Only handle keydown if the event originated from the card itself
      // This prevents hijacking keyboard interactions from child elements (buttons, dropdowns)
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        onNavigate(goal.id)
      }
    },
    [goal.id, onNavigate]
  )

  return (
    <Card
      className="hover:shadow-lg transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      onClick={() => onNavigate(goal.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`ゴール: ${goal.title}`}
    >
      <CardHeader>
        <div className="mb-2 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <CardTitle className="line-clamp-2 min-w-0 flex-1">{goal.title}</CardTitle>
          <div className="shrink-0">
            <GoalStatusDropdown goal={goal} />
          </div>
        </div>
        <CardDescription className="line-clamp-2">
          {goal.description || 'ゴールの説明がありません'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {goal.due_date && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  期限: {safeFormatJapaneseDate(goal.due_date)}
                </span>
              )}
              {dueState && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2.5 py-1 font-medium',
                    DUE_STATE_CLASSNAMES[dueState.kind],
                  )}
                >
                  {getDueStateLabel(dueState)}
                </span>
              )}
              {blockingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/10 px-2.5 py-1 font-medium text-orange-700 dark:text-orange-300">
                  <GitBranch className="h-3.5 w-3.5" />
                  依存待ち {blockingCount}件
                </span>
              )}
            </div>
            <div className="ml-auto text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              {new Date(goal.created_at).toLocaleDateString('ja-JP')}
            </div>
          </div>

          <GoalDigest estimateHours={goal.estimate_hours} progress={progress} />

          <div>
            <div className="text-xs text-muted-foreground mb-2 font-medium">依存関係:</div>
            <GoalDependencies goalId={goal.id} allGoals={allGoals} />
          </div>

          <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
            <GoalEditDialog goal={goal}>
              <Button variant="outline" size="sm" className="flex-1">
                編集
              </Button>
            </GoalEditDialog>
            <GoalDeleteDialog goal={goal}>
              <Button variant="outline" size="sm" className="flex-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50">
                削除
              </Button>
            </GoalDeleteDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
