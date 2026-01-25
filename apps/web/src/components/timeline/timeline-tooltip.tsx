"use client"

import React from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { X, Target, Clock, Calendar, CheckCircle, AlertTriangle, XCircle, Circle, TrendingUp, FileText, Link2 } from 'lucide-react'
import type { LayoutGoal, LayoutTaskSegment } from '@/lib/timeline/types'

interface TimelineTooltipProps {
  goal: LayoutGoal | null
  task: LayoutTaskSegment | null
  position: { x: number; y: number }
  onClose: () => void
}

// Modern status configurations
const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle,
    label: '完了',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    progressColor: 'bg-gradient-to-r from-emerald-400 to-emerald-600',
  },
  in_progress: {
    icon: TrendingUp,
    label: '進行中',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    progressColor: 'bg-gradient-to-r from-blue-400 to-blue-600',
  },
  cancelled: {
    icon: XCircle,
    label: '中止',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    progressColor: 'bg-gradient-to-r from-red-400 to-red-600',
  },
  pending: {
    icon: Circle,
    label: '未着手',
    color: 'text-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    progressColor: 'bg-gradient-to-r from-slate-300 to-slate-500',
  },
} as const

export function TimelineTooltip({
  goal,
  task,
  position,
  onClose
}: TimelineTooltipProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    try {
      return format(parseISO(dateString), 'yyyy年MM月dd日', { locale: ja })
    } catch {
      return null
    }
  }

  const formatTime = (dateString: string | null) => {
    if (!dateString) return null
    try {
      return format(parseISO(dateString), 'MM/dd HH:mm', { locale: ja })
    } catch {
      return null
    }
  }

  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
  }

  // Position tooltip to avoid screen edges with better margin
  const adjustedPosition = {
    x: Math.max(20, Math.min(position.x, window.innerWidth - 360)),
    y: Math.max(20, Math.min(position.y - 10, window.innerHeight - 300))
  }

  return (
    <div
      className="fixed z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translate(-50%, -100%)'
      }}
    >
      {/* Glassmorphism container */}
      <div className="relative bg-white/95 backdrop-blur-xl border border-slate-200/80 rounded-2xl shadow-2xl shadow-slate-900/10 overflow-hidden max-w-sm">
        {/* Gradient accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 hover:bg-slate-100 rounded-lg transition-colors group z-10"
          aria-label="閉じる"
        >
          <X className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
        </button>

        {/* Goal Tooltip Content */}
        {goal && (
          <div className="p-5 pt-6">
            {/* Header */}
            <div className="flex items-start gap-3 mb-4 pr-8">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/20 shrink-0">
                <Target className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg text-slate-800 leading-tight">{goal.title}</h3>
                {goal.originalGoal.description && (
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                    {goal.originalGoal.description}
                  </p>
                )}
              </div>
            </div>

            {/* Status & Progress */}
            <div className="space-y-4">
              {/* Status badge */}
              {(() => {
                const config = getStatusConfig(goal.status)
                const StatusIcon = config.icon
                return (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">ステータス</span>
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.bg} ${config.border} border`}>
                      <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
                      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                    </div>
                  </div>
                )
              })()}

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">進捗</span>
                  <span className="text-lg font-bold text-slate-800">
                    {Math.round(goal.progress * 100)}%
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getStatusConfig(goal.status).progressColor}`}
                    style={{ width: `${goal.progress * 100}%` }}
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-xs">見積時間</span>
                  </div>
                  <p className="text-base font-semibold text-slate-800">
                    {goal.originalGoal.estimate_hours}時間
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="text-xs">タスク数</span>
                  </div>
                  <p className="text-base font-semibold text-slate-800">
                    {goal.originalGoal.tasks.length}個
                  </p>
                </div>
              </div>

              {/* Dates */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {formatDate(goal.originalGoal.start_date) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      開始日
                    </span>
                    <span className="text-slate-700 font-medium">
                      {formatDate(goal.originalGoal.start_date)}
                    </span>
                  </div>
                )}
                {formatDate(goal.originalGoal.end_date) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      終了日
                    </span>
                    <span className="text-slate-700 font-medium">
                      {formatDate(goal.originalGoal.end_date)}
                    </span>
                  </div>
                )}
              </div>

              {/* Dependencies */}
              {goal.originalGoal.dependencies.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-sm text-slate-500 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    依存関係
                  </span>
                  <Badge className="bg-purple-50 text-purple-700 border-purple-200">
                    {goal.originalGoal.dependencies.length}個
                  </Badge>
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-400">
                  作成: {formatTime(goal.originalGoal.created_at) || '不明'} · 更新: {formatTime(goal.originalGoal.updated_at) || '不明'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Task Tooltip Content */}
        {task && (
          <div className="p-5 pt-6">
            {/* Header */}
            <div className="flex items-start gap-3 mb-4 pr-8">
              <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20 shrink-0">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg text-slate-800 leading-tight">{task.title}</h3>
                {task.originalTask.description && (
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                    {task.originalTask.description}
                  </p>
                )}
              </div>
            </div>

            {/* Status & Progress */}
            <div className="space-y-4">
              {/* Status badge */}
              {(() => {
                const config = getStatusConfig(task.originalTask.status)
                const StatusIcon = config.icon
                return (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">ステータス</span>
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.bg} ${config.border} border`}>
                      <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
                      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                    </div>
                  </div>
                )
              })()}

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">進捗</span>
                  <span className="text-lg font-bold text-slate-800">
                    {Math.round(task.progress * 100)}%
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getStatusConfig(task.originalTask.status).progressColor}`}
                    style={{ width: `${task.progress * 100}%` }}
                  />
                </div>
              </div>

              {/* Time stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-xs">見積時間</span>
                  </div>
                  <p className="text-base font-semibold text-slate-800">
                    {task.originalTask.estimate_hours}時間
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="text-xs">実績時間</span>
                  </div>
                  <p className="text-base font-semibold text-slate-800">
                    {task.originalTask.actual_hours}時間
                  </p>
                </div>
              </div>

              {/* Due date & logs */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {task.originalTask.due_date && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      期限
                    </span>
                    <span className="text-slate-700 font-medium">
                      {formatDate(task.originalTask.due_date)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    ログ
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {task.originalTask.logs_count}件
                  </Badge>
                </div>
              </div>

              {/* Timestamps */}
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-400">
                  作成: {formatTime(task.originalTask.created_at) || '不明'} · 更新: {formatTime(task.originalTask.updated_at) || '不明'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bottom arrow indicator */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-r border-b border-slate-200/80 rotate-45" />
      </div>
    </div>
  )
}
