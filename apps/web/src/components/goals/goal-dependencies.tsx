'use client'

import { useQuery } from '@tanstack/react-query'
import { goalsApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { GitBranch } from 'lucide-react'
import type { Goal } from '@/types/goal'

interface GoalDependenciesProps {
  goalId: string
  allGoals: Goal[]
}

export function GoalDependencies({ goalId, allGoals }: GoalDependenciesProps) {
  const { data: dependencies = [] } = useQuery({
    queryKey: ['goalDependencies', goalId],
    queryFn: () => goalsApi.getDependencies(goalId),
  })

  if (dependencies.length === 0) {
    return <span className="text-sm text-muted-foreground">なし</span>
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <GitBranch className="h-4 w-4 text-blue-500" />
        <span className="text-sm text-muted-foreground">{dependencies.length}件</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {dependencies.map((dep) => {
          const dependsOnGoal = allGoals.find((g) => g.id === dep.depends_on_goal_id)
          return (
            <Badge key={dep.id} variant="outline" className="text-xs">
              {dependsOnGoal?.title || '不明'}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}
