'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GoalFormDialog } from './goal-form-dialog'
import { GoalCard } from './goal-card'
import { Plus } from 'lucide-react'
import type { Goal } from '@/types/goal'

interface GoalListProps {
  projectId: string
  goals: Goal[]
  isLoading: boolean
  error: Error | null
  onRefetch: () => void
  onNavigateToGoal: (goalId: string) => void
}

export function GoalList({
  projectId,
  goals,
  isLoading,
  error,
  onRefetch,
  onNavigateToGoal,
}: GoalListProps) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">ゴール一覧</h2>
          <p className="text-gray-600 mt-2">このプロジェクトの目標を管理します。</p>
        </div>
        <GoalFormDialog projectId={projectId}>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            新規ゴール作成
          </Button>
        </GoalFormDialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-lg">ゴールを読み込み中...</div>
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-red-600 mb-4">エラー: {error.message}</div>
              <Button onClick={onRefetch}>再試行</Button>
            </div>
          </CardContent>
        </Card>
      ) : goals.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>ゴールがまだありません</CardTitle>
            <CardDescription>
              新しいゴールを作成してプロジェクトを開始しましょう。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoalFormDialog projectId={projectId}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                最初のゴールを作成
              </Button>
            </GoalFormDialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              allGoals={goals}
              onNavigate={onNavigateToGoal}
            />
          ))}
        </div>
      )}
    </div>
  )
}
