"use client"

import React from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { X, Target, Clock, Calendar, CheckCircle, AlertTriangle } from 'lucide-react'
import type { LayoutGoal, LayoutTaskSegment } from '@/lib/timeline/types'

interface TimelineTooltipProps {
  goal: LayoutGoal | null
  task: LayoutTaskSegment | null
  position: { x: number; y: number }
  onClose: () => void
}

export function TimelineTooltip({
  goal,
  task,
  position,
  onClose
}: TimelineTooltipProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '未設定'
    try {
      return format(parseISO(dateString), 'yyyy年MM月dd日', { locale: ja })
    } catch {
      return '無効な日付'
    }
  }

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '未設定'
    try {
      return format(parseISO(dateString), 'MM/dd HH:mm', { locale: ja })
    } catch {
      return '無効な日付'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'in_progress':
        return <AlertTriangle className="w-4 h-4 text-blue-500" />
      case 'cancelled':
        return <X className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return '完了'
      case 'in_progress':
        return '進行中'
      case 'cancelled':
        return '中止'
      default:
        return '未着手'
    }
  }

  // Position tooltip to avoid screen edges
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 320),
    y: Math.min(position.y, window.innerHeight - 200)
  }

  return (
    <div
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-sm"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translate(-50%, -100%)'
      }}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded"
      >
        <X className="w-4 h-4 text-gray-400" />
      </button>

      {/* Goal Tooltip */}
      {goal && (
        <div className="space-y-3">
          <div className="pr-8">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-lg">{goal.title}</h3>
            </div>

            {goal.originalGoal.description && (
              <p className="text-sm text-gray-600 mb-3">
                {goal.originalGoal.description}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">ステータス</span>
                <div className="flex items-center gap-2">
                  {getStatusIcon(goal.status)}
                  <Badge variant="outline">
                    {getStatusLabel(goal.status)}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">進捗</span>
                <span className="text-sm font-medium">
                  {Math.round(goal.progress * 100)}%
                </span>
              </div>

              <Progress value={goal.progress * 100} className="h-2" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">見積時間</span>
                <span className="text-sm font-medium">
                  {goal.originalGoal.estimate_hours}時間
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">開始日</span>
                <span className="text-sm">
                  {formatDate(goal.originalGoal.start_date)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">終了日</span>
                <span className="text-sm">
                  {formatDate(goal.originalGoal.end_date)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">タスク数</span>
                <span className="text-sm font-medium">
                  {goal.originalGoal.tasks.length}個
                </span>
              </div>

              {goal.originalGoal.dependencies.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">依存関係</span>
                  <Badge variant="secondary">
                    {goal.originalGoal.dependencies.length}個
                  </Badge>
                </div>
              )}

              <div className="text-xs text-gray-400 pt-2 border-t">
                作成: {formatTime(goal.originalGoal.created_at)} |
                更新: {formatTime(goal.originalGoal.updated_at)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Tooltip */}
      {task && (
        <div className="space-y-3">
          <div className="pr-8">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <h3 className="font-semibold text-lg">{task.title}</h3>
            </div>

            {task.originalTask.description && (
              <p className="text-sm text-gray-600 mb-3">
                {task.originalTask.description}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">ステータス</span>
                <div className="flex items-center gap-2">
                  {getStatusIcon(task.originalTask.status)}
                  <Badge variant="outline">
                    {getStatusLabel(task.originalTask.status)}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">進捗</span>
                <span className="text-sm font-medium">
                  {Math.round(task.progress * 100)}%
                </span>
              </div>

              <Progress value={task.progress * 100} className="h-2" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">見積時間</span>
                <span className="text-sm font-medium">
                  {task.originalTask.estimate_hours}時間
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">実績時間</span>
                <span className="text-sm font-medium">
                  {task.originalTask.actual_hours}時間
                </span>
              </div>

              {task.originalTask.due_date && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    期限
                  </span>
                  <span className="text-sm">
                    {formatDate(task.originalTask.due_date)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">ログ数</span>
                <Badge variant="outline">
                  {task.originalTask.logs_count}件
                </Badge>
              </div>

              <div className="text-xs text-gray-400 pt-2 border-t">
                作成: {formatTime(task.originalTask.created_at)} |
                更新: {formatTime(task.originalTask.updated_at)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
