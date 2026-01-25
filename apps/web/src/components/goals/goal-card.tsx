'use client'

import { memo, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GoalStatusDropdown } from './goal-status-dropdown'
import { GoalDependencies } from './goal-dependencies'
import { GoalEditDialog } from './goal-edit-dialog'
import { GoalDeleteDialog } from './goal-delete-dialog'
import type { Goal } from '@/types/goal'

interface GoalCardProps {
  goal: Goal
  allGoals: Goal[]
  onNavigate: (goalId: string) => void
}

export const GoalCard = memo(function GoalCard({
  goal,
  allGoals,
  onNavigate,
}: GoalCardProps) {
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
        <div className="flex justify-between items-start mb-2">
          <CardTitle className="line-clamp-1 flex-1">{goal.title}</CardTitle>
          <GoalStatusDropdown goal={goal} />
        </div>
        <CardDescription className="line-clamp-2">
          {goal.description || 'ゴールの説明がありません'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-info/10 text-info font-medium">
                見積: {goal.estimate_hours}h
              </span>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              {new Date(goal.created_at).toLocaleDateString('ja-JP')}
            </div>
          </div>

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
