'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusGroupedList } from '@/components/ui/status-grouped-list'
import { GoalFormDialog } from './goal-form-dialog'
import { GoalCard } from './goal-card'
import { GoalTaskAssistantDialog } from '@/components/ai/goal-task-assistant-dialog'
import { Plus, Sparkles } from 'lucide-react'
import { groupGoalsByStatus } from '@/lib/status-groups'
import type { Goal } from '@/types/goal'
import type { ProjectProgress } from '@/types/progress'

interface GoalListProps {
  projectId: string
  goals: Goal[]
  /** Project progress; supplies the per-goal digest when available. */
  progress?: ProjectProgress
  isLoading: boolean
  error: Error | null
  onRefetch: () => void
  onNavigateToGoal: (goalId: string) => void
}

export function GoalList({
  projectId,
  goals,
  progress,
  isLoading,
  error,
  onRefetch,
  onNavigateToGoal,
}: GoalListProps) {
  const groups = useMemo(() => groupGoalsByStatus(goals), [goals])
  const progressByGoalId = useMemo(
    () => new Map(progress?.goals.map((goalProgress) => [goalProgress.goal_id, goalProgress])),
    [progress],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">ゴール一覧</h2>
          <p className="mt-2 text-muted-foreground">このプロジェクトの目標を管理します。</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <GoalTaskAssistantDialog
            projectId={projectId}
            mode="project_goals"
            title="AIでゴール・タスク案"
            defaultMessage="プロジェクトノートと既存のゴールをもとに、次に作るべきゴールと初期タスクを提案してください。"
            onApplied={onRefetch}
          >
            <Button variant="outline" className="w-full sm:w-auto">
              <Sparkles className="h-4 w-4 mr-2" />
              AI提案
            </Button>
          </GoalTaskAssistantDialog>
          <GoalFormDialog projectId={projectId}>
            <Button className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              新規ゴール作成
            </Button>
          </GoalFormDialog>
        </div>
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
            <div className="flex flex-wrap gap-2">
              <GoalTaskAssistantDialog
                projectId={projectId}
                mode="project_goals"
                title="AIでゴール・タスク案"
                defaultMessage="プロジェクトノートをもとに、最初に作るべきゴールと初期タスクを提案してください。"
                onApplied={onRefetch}
              >
                <Button variant="outline">
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI提案
                </Button>
              </GoalTaskAssistantDialog>
              <GoalFormDialog projectId={projectId}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  最初のゴールを作成
                </Button>
              </GoalFormDialog>
            </div>
          </CardContent>
        </Card>
      ) : (
        <StatusGroupedList
          groups={groups}
          storageKey="goals"
          itemsClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          renderItem={(goal) => (
            <GoalCard
              goal={goal}
              allGoals={goals}
              progress={progressByGoalId.get(goal.id)}
              onNavigate={onNavigateToGoal}
            />
          )}
        />
      )}
    </div>
  )
}
