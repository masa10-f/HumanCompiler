'use client'

import { useQuery } from '@tanstack/react-query'
import { goalsApi } from '@/lib/api'
import { useGoalsByProject } from '@/hooks/use-goals-query'
import { Badge } from '@/components/ui/badge'
import { GitBranch } from 'lucide-react'

interface GoalDependenciesProps {
  goalId: string
  projectId: string
}

export function GoalDependencies({ goalId, projectId }: GoalDependenciesProps) {
  const { data: dependencies = [] } = useQuery({
    queryKey: ['goalDependencies', goalId],
    queryFn: () => goalsApi.getDependencies(goalId),
  })

  const { data: allGoals = [] } = useGoalsByProject(projectId)

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
