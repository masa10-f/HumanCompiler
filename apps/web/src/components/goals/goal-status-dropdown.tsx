'use client'

import { memo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { goalsApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getGoalStatusIcon,
  getGoalStatusLabel,
  getAllGoalStatuses,
  GOAL_STATUS_CONFIG,
} from '@/constants/goal-status'
import { getStatusUpdateError } from '@/lib/status-error-handler'
import type { Goal, GoalStatus } from '@/types/goal'

interface GoalStatusDropdownProps {
  goal: Goal
}

interface GoalStatusMutationContext {
  previousGoals: Goal[] | undefined
  previousGoal: Goal | undefined
}

export const GoalStatusDropdown = memo(function GoalStatusDropdown({
  goal,
}: GoalStatusDropdownProps) {
  const queryClient = useQueryClient()
  const [isUpdating, setIsUpdating] = useState(false)

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: GoalStatus) => {
      return goalsApi.update(goal.id, { status: newStatus })
    },
    onMutate: async (newStatus: GoalStatus) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['goals', 'project', goal.project_id] })
      await queryClient.cancelQueries({ queryKey: ['goal', goal.id] })

      // Snapshot the previous value for rollback
      const previousGoals = queryClient.getQueryData<Goal[]>(['goals', 'project', goal.project_id])
      const previousGoal = queryClient.getQueryData<Goal>(['goal', goal.id])

      // Optimistically update to the new value
      queryClient.setQueryData<Goal[]>(['goals', 'project', goal.project_id], (old) => {
        if (old) {
          return old.map((g) => (g.id === goal.id ? { ...g, status: newStatus } : g))
        }
        return old
      })

      queryClient.setQueryData(['goal', goal.id], (old: Goal | undefined) => {
        if (old) {
          return { ...old, status: newStatus }
        }
        return old
      })

      // Return context for potential rollback
      return { previousGoals, previousGoal }
    },
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['goals', 'project', goal.project_id] })
      queryClient.invalidateQueries({ queryKey: ['goal', goal.id] })
      toast({
        title: 'ステータスを更新しました',
        description: `ゴールのステータスを「${getGoalStatusLabel(newStatus)}」に変更しました。`,
      })
      setIsUpdating(false)
    },
    onError: (error: Error, _, context: GoalStatusMutationContext | undefined) => {
      // Rollback optimistic updates
      if (context?.previousGoals) {
        queryClient.setQueryData(['goals', 'project', goal.project_id], context.previousGoals)
      }
      if (context?.previousGoal) {
        queryClient.setQueryData(['goal', goal.id], context.previousGoal)
      }

      const { title, message } = getStatusUpdateError(error, 'goal')
      toast({
        title,
        description: message,
        variant: 'destructive',
      })
      setIsUpdating(false)
    },
  })

  const handleStatusChange = (newStatus: GoalStatus) => {
    if (newStatus !== goal.status && !isUpdating) {
      setIsUpdating(true)
      updateStatusMutation.mutate(newStatus)
    }
  }

  const currentStatus = goal.status || 'pending'

  const statusConfig = GOAL_STATUS_CONFIG[currentStatus as keyof typeof GOAL_STATUS_CONFIG] || GOAL_STATUS_CONFIG.pending

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${statusConfig.bgClassName} ${statusConfig.className} hover:opacity-80 border border-current/20`}
          onClick={(e) => e.stopPropagation()}
          disabled={isUpdating}
        >
          {getGoalStatusIcon(currentStatus)}
          <span>{getGoalStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {getAllGoalStatuses().map((status) => {
          const config = GOAL_STATUS_CONFIG[status]
          const isSelected = currentStatus === status
          return (
            <DropdownMenuItem
              key={status}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                handleStatusChange(status)
              }}
              className={`${isSelected ? config.bgClassName : ''} ${config.className} cursor-pointer`}
            >
              <div className="flex items-center gap-2">
                {getGoalStatusIcon(status)}
                <span>{getGoalStatusLabel(status)}</span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
