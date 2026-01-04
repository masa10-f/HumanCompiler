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
} from '@/constants/goal-status'
import { ApiError } from '@/lib/errors'
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
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['goals', 'project', goal.project_id] })
      queryClient.invalidateQueries({ queryKey: ['goal', goal.id] })
      toast({
        title: 'ステータスを更新しました',
        description: `ゴールのステータスを「${getGoalStatusLabel(newStatus)}」に変更しました。`,
      })
      setIsUpdating(false)
    },
    onError: (error: Error, _newStatus: GoalStatus, context: GoalStatusMutationContext | undefined) => {
      // Rollback optimistic updates
      if (context?.previousGoals) {
        queryClient.setQueryData(['goals', 'project', goal.project_id], context.previousGoals)
      }
      if (context?.previousGoal) {
        queryClient.setQueryData(['goal', goal.id], context.previousGoal)
      }

      let errorMessage = 'ステータスの更新に失敗しました。'
      let errorTitle = 'エラー'

      const errorStatus = error instanceof ApiError ? error.statusCode : undefined

      if (errorStatus === 404) {
        errorTitle = 'ゴールが見つかりません'
        errorMessage = '更新対象のゴールが削除されている可能性があります。'
      } else if (errorStatus === 403) {
        errorTitle = '権限エラー'
        errorMessage = 'このゴールを更新する権限がありません。'
      } else if (errorStatus === 422) {
        errorTitle = '入力エラー'
        errorMessage = '無効なステータス値です。ページを再読み込みしてください。'
      } else if (errorStatus && errorStatus >= 500) {
        errorTitle = 'サーバーエラー'
        errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。'
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        errorTitle = 'ネットワークエラー'
        errorMessage = 'インターネット接続を確認してください。'
      }

      toast({
        title: errorTitle,
        description: errorMessage,
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
          disabled={isUpdating}
        >
          {getGoalStatusIcon(currentStatus)}
          <span className="text-sm">{getGoalStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getAllGoalStatuses().map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              handleStatusChange(status)
            }}
            className={currentStatus === status ? 'bg-gray-100' : ''}
          >
            <div className="flex items-center gap-2">
              {getGoalStatusIcon(status)}
              <span>{getGoalStatusLabel(status)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
