'use client'

import { memo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GoalStatusDropdown } from './goal-status-dropdown'
import { GoalDependencies } from './goal-dependencies'
import { GoalEditDialog } from './goal-edit-dialog'
import { GoalDeleteDialog } from './goal-delete-dialog'
import type { Goal } from '@/types/goal'

interface GoalCardProps {
  goal: Goal
  projectId: string
  onNavigate: (goalId: string) => void
}

export const GoalCard = memo(function GoalCard({
  goal,
  projectId,
  onNavigate,
}: GoalCardProps) {
  return (
    <Card
      className="hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => onNavigate(goal.id)}
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
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600">見積時間: {goal.estimate_hours}h</div>
            <div className="text-xs text-gray-500">
              {new Date(goal.created_at).toLocaleDateString('ja-JP')}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">依存関係:</div>
            <GoalDependencies goalId={goal.id} projectId={projectId} />
          </div>

          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <GoalEditDialog goal={goal}>
              <Button variant="outline" size="sm">
                編集
              </Button>
            </GoalEditDialog>
            <GoalDeleteDialog goal={goal}>
              <Button variant="outline" size="sm">
                削除
              </Button>
            </GoalDeleteDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
