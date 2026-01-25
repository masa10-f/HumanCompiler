"use client"

import React, { useState, useRef, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Download, Calendar, Clock, Target, CheckCircle, AlertTriangle, Circle, XCircle, TrendingUp, Layers, ChevronRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineTask } from '@/types/timeline'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { getJSTDateString } from '@/lib/date-utils'
import { logger } from '@/lib/logger'

interface ProjectTimelineProps {
  projectId: string
  data: ProjectTimelineData | null
  isLoading: boolean
  error?: string | null
  onRefresh: () => void
  onTimeUnitChange: (unit: string) => void
  onDateRangeChange: (_startDate: Date, _endDate: Date) => void
}

// Modern status configurations
const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle,
    label: '完了',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    gradient: 'from-emerald-400 to-emerald-600',
    ring: 'ring-emerald-500/20',
    dot: 'bg-emerald-500',
  },
  in_progress: {
    icon: TrendingUp,
    label: '進行中',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    gradient: 'from-blue-400 to-blue-600',
    ring: 'ring-blue-500/20',
    dot: 'bg-blue-500',
  },
  cancelled: {
    icon: XCircle,
    label: '中止',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    gradient: 'from-red-400 to-red-600',
    ring: 'ring-red-500/20',
    dot: 'bg-red-500',
  },
  pending: {
    icon: Circle,
    label: '未着手',
    color: 'text-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    gradient: 'from-slate-300 to-slate-500',
    ring: 'ring-slate-500/10',
    dot: 'bg-slate-400',
  },
} as const

export function ProjectTimeline({
  projectId: _projectId,
  data,
  isLoading,
  error,
  onRefresh: _onRefresh,
  onTimeUnitChange,
  onDateRangeChange: _onDateRangeChange
}: ProjectTimelineProps) {
  const [timeUnit, setTimeUnit] = useState('day')
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set())
  const timelineRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const handleTimeUnitChange = useCallback((unit: string) => {
    setTimeUnit(unit)
    onTimeUnitChange(unit)
  }, [onTimeUnitChange])

  const toggleGoalExpansion = useCallback((goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev)
      if (next.has(goalId)) {
        next.delete(goalId)
      } else {
        next.add(goalId)
      }
      return next
    })
  }, [])

  const downloadTimeline = async () => {
    if (!timelineRef.current || !data) return

    try {
      // Use html2canvas to capture the timeline as image
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(timelineRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: false
      })

      // Download as PNG
      const link = document.createElement('a')
      link.download = `${data.project.title}_timeline_${getJSTDateString()}.png`
      link.href = canvas.toDataURL()
      link.click()

      toast({
        title: "タイムライン画像をダウンロードしました",
        description: "プロジェクトタイムラインが画像として保存されました。",
      })
    } catch (error) {
      logger.error('Download failed', error instanceof Error ? error : new Error(String(error)), { component: 'ProjectTimeline' })
      toast({
        title: "ダウンロードに失敗しました",
        description: "画像の生成中にエラーが発生しました。",
        variant: "destructive",
      })
    }
  }

  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
  }

  const formatDate = (dateString: string) => {
    return format(parseISO(dateString), 'M/d', { locale: ja })
  }

  const formatDateLong = (dateString: string) => {
    return format(parseISO(dateString), 'yyyy年MM月dd日', { locale: ja })
  }

  // Memoize expensive date calculations
  const timelineCalculations = useMemo(() => {
    if (!data) return null

    const timelineStartDate = parseISO(data.timeline.start_date)
    const timelineEndDate = parseISO(data.timeline.end_date)

    return {
      startDate: timelineStartDate,
      endDate: timelineEndDate,
      totalDays: differenceInDays(timelineEndDate, timelineStartDate)
    }
  }, [data])

  const calculateTaskWidth = useCallback((task: TimelineTask) => {
    if (!timelineCalculations) return 100

    const taskStart = parseISO(task.created_at)
    // Use JST date as default if no due date is specified
    const taskEnd = task.due_date ? parseISO(task.due_date) : parseISO(getJSTDateString() + 'T23:59:59+09:00')
    const taskDays = differenceInDays(taskEnd, taskStart)

    if (timelineCalculations.totalDays <= 0) return 100
    return Math.max((taskDays / timelineCalculations.totalDays) * 100, 10) // Minimum 10% width
  }, [timelineCalculations])

  const calculateTaskPosition = useCallback((task: TimelineTask) => {
    if (!timelineCalculations) return 0

    const taskStart = parseISO(task.created_at)
    const daysSinceStart = differenceInDays(taskStart, timelineCalculations.startDate)

    if (timelineCalculations.totalDays <= 0) return 0
    return Math.max((daysSinceStart / timelineCalculations.totalDays) * 100, 0)
  }, [timelineCalculations])

  // Loading state with modern skeleton
  if (isLoading) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">プロジェクトタイムライン</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-slate-200 to-slate-100 rounded-xl animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 bg-gradient-to-r from-slate-200 to-slate-100 rounded-lg w-1/3 animate-pulse" />
                    <div className="h-3 bg-gradient-to-r from-slate-200 to-slate-100 rounded w-1/4 animate-pulse" />
                  </div>
                </div>
                <div className="ml-14 space-y-2">
                  {[...Array(2)].map((_, j) => (
                    <div key={j} className="h-16 bg-gradient-to-r from-slate-100 to-slate-50 rounded-xl animate-pulse" style={{ animationDelay: `${(i * 2 + j) * 100}ms` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-red-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">プロジェクトタイムライン</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-lg font-medium text-red-600 mb-2">エラーが発生しました</p>
            <p className="text-sm text-slate-600">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // No data state
  if (!data) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">プロジェクトタイムライン</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-slate-500">タイムラインデータが見つかりません。</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50 overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-semibold text-slate-800">{data.project.title}</span>
                <p className="text-sm font-normal text-slate-500 mt-0.5">プロジェクトタイムライン</p>
              </div>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={timeUnit} onValueChange={handleTimeUnitChange}>
                <SelectTrigger className="w-28 bg-white border-slate-200 shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">日単位</SelectItem>
                  <SelectItem value="week">週単位</SelectItem>
                  <SelectItem value="month">月単位</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={downloadTimeline}
                size="sm"
                className="bg-slate-800 hover:bg-slate-900 shadow-md"
              >
                <Download className="w-4 h-4 mr-2" />
                画像
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">
                {formatDateLong(data.timeline.start_date)} - {formatDateLong(data.timeline.end_date)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Target className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">{data.goals.length}個のゴール</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">{data.goals.reduce((sum, g) => sum + g.tasks.length, 0)}個のタスク</span>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Timeline Visualization */}
      <div ref={timelineRef} className="bg-gradient-to-br from-white to-slate-50 p-6 rounded-2xl border-0 shadow-lg">
        <div className="space-y-6">
          {data.goals.map((goal) => {
            const config = getStatusConfig(goal.status)
            const StatusIcon = config.icon
            const isExpanded = expandedGoals.has(goal.id) || goal.tasks.length <= 3

            return (
              <div key={goal.id} className="group">
                {/* Goal Header */}
                <div
                  className={`flex items-center gap-4 p-4 rounded-xl bg-white border ${config.border} shadow-sm hover:shadow-md transition-all cursor-pointer`}
                  onClick={() => toggleGoalExpansion(goal.id)}
                >
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${config.gradient} shadow-lg ring-4 ${config.ring}`}>
                    <StatusIcon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg text-slate-800 truncate">{goal.title}</h3>
                      <Badge className={`${config.bg} ${config.color} ${config.border} border shrink-0`}>
                        {config.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {goal.estimate_hours}時間
                      </span>
                      <span>作成: {formatDate(goal.created_at)}</span>
                      <span className="flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5" />
                        {goal.tasks.length}タスク
                      </span>
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </div>

                {/* Tasks */}
                {isExpanded && goal.tasks.length > 0 && (
                  <div className="mt-3 ml-6 pl-6 border-l-2 border-slate-100 space-y-3">
                    {goal.tasks.map((task) => {
                      const taskConfig = getStatusConfig(task.status)
                      const TaskIcon = taskConfig.icon

                      return (
                        <div
                          key={task.id}
                          className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm hover:shadow-md hover:border-slate-200 transition-all"
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${taskConfig.bg} shrink-0 mt-0.5`}>
                              <TaskIcon className={`w-4 h-4 ${taskConfig.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">{task.title}</span>
                                <Badge
                                  className="text-xs px-2 py-0.5"
                                  style={{
                                    backgroundColor: task.status_color + '20',
                                    color: task.status_color,
                                    borderColor: task.status_color + '40'
                                  }}
                                >
                                  {task.progress_percentage}%
                                </Badge>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-slate-500 mt-1.5">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  予定 {task.estimate_hours}h / 実績 {task.actual_hours}h
                                </span>
                                {task.due_date && (
                                  <span className="flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    期限: {formatDate(task.due_date)}
                                  </span>
                                )}
                              </div>

                              {/* Progress bar */}
                              <div className="mt-3 space-y-1">
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${task.progress_percentage}%`,
                                      background: `linear-gradient(90deg, ${task.status_color}ee, ${task.status_color}aa)`
                                    }}
                                  />
                                </div>

                                {/* Timeline position indicator */}
                                <div className="h-1.5 bg-slate-50 rounded-full relative overflow-hidden">
                                  <div
                                    className="absolute h-full rounded-full transition-all"
                                    style={{
                                      background: `linear-gradient(90deg, ${task.status_color}60, ${task.status_color}30)`,
                                      left: `${calculateTaskPosition(task)}%`,
                                      width: `${calculateTaskWidth(task)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Collapsed indicator */}
                {!isExpanded && goal.tasks.length > 3 && (
                  <div className="mt-2 ml-6 pl-6 border-l-2 border-slate-100">
                    <button
                      onClick={() => toggleGoalExpansion(goal.id)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      他 {goal.tasks.length} 件のタスクを表示
                    </button>
                  </div>
                )}

                {/* No tasks message */}
                {goal.tasks.length === 0 && (
                  <div className="mt-3 ml-6 pl-6 border-l-2 border-slate-100">
                    <p className="text-sm text-slate-400 py-2">タスクが設定されていません</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Timeline Legend */}
        <Separator className="my-8" />
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600" />
            <span className="text-sm text-emerald-700 font-medium">完了</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-400 to-blue-600" />
            <span className="text-sm text-blue-700 font-medium">進行中</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-400 to-amber-600" />
            <span className="text-sm text-amber-700 font-medium">50%以上</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600" />
            <span className="text-sm text-yellow-700 font-medium">80%以上</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500" />
            <span className="text-sm text-slate-600 font-medium">未着手</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-400 to-red-600" />
            <span className="text-sm text-red-700 font-medium">中止</span>
          </div>
        </div>
      </div>
    </div>
  )
}
