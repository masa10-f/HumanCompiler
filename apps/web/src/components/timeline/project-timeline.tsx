"use client"

import React, { useState, useRef, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Download, Calendar, Clock, Target, CheckCircle, AlertCircle, Circle, XCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineTask } from '@/types/timeline'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ja } from 'date-fns/locale'

interface ProjectTimelineProps {
  projectId: string
  data: ProjectTimelineData | null
  isLoading: boolean
  error?: string | null
  onRefresh: () => void
  onTimeUnitChange: (unit: string) => void
  onDateRangeChange: (_startDate: Date, _endDate: Date) => void
}

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
  const timelineRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const handleTimeUnitChange = useCallback((unit: string) => {
    setTimeUnit(unit)
    onTimeUnitChange(unit)
  }, [onTimeUnitChange])

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
      link.download = `${data.project.title}_timeline_${format(new Date(), 'yyyy-MM-dd')}.png`
      link.href = canvas.toDataURL()
      link.click()

      toast({
        title: "タイムライン画像をダウンロードしました",
        description: "プロジェクトタイムラインが画像として保存されました。",
      })
    } catch (error) {
      console.error('Download failed:', error)
      toast({
        title: "ダウンロードに失敗しました",
        description: "画像の生成中にエラーが発生しました。",
        variant: "destructive",
      })
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'in_progress':
        return <AlertCircle className="w-4 h-4 text-blue-500" />
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Circle className="w-4 h-4 text-gray-400" />
    }
  }

  const formatDate = (dateString: string) => {
    return format(parseISO(dateString), 'MM/dd', { locale: ja })
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
    const taskEnd = task.due_date ? parseISO(task.due_date) : new Date()
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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-500 mb-2">エラーが発生しました</p>
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">タイムラインデータが見つかりません。</p>
        </CardContent>
      </Card>
    )
  }

  // Use memoized timeline calculations

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              プロジェクトタイムライン: {data.project.title}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={timeUnit} onValueChange={handleTimeUnitChange}>
                <SelectTrigger className="w-32">
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
                variant="outline"
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                画像ダウンロード
              </Button>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            期間: {formatDateLong(data.timeline.start_date)} ～ {formatDateLong(data.timeline.end_date)}
          </div>
        </CardHeader>
      </Card>

      {/* Timeline Visualization */}
      <div ref={timelineRef} className="bg-white p-6 rounded-lg border">
        <div className="space-y-8">
          {data.goals.map((goal) => (
            <div key={goal.id} className="space-y-4">
              {/* Goal Header */}
              <div className="flex items-center gap-3 pb-2 border-b">
                {getStatusIcon(goal.status)}
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{goal.title}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Target className="w-4 h-4" />
                      {goal.estimate_hours}時間
                    </span>
                    <span>作成: {formatDate(goal.created_at)}</span>
                    <Badge variant={goal.status === 'completed' ? 'default' : 'secondary'}>
                      {goal.status === 'completed' ? '完了' :
                       goal.status === 'in_progress' ? '進行中' :
                       goal.status === 'cancelled' ? '中止' : '未着手'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Tasks Timeline */}
              <div className="space-y-3 ml-8">
                {goal.tasks.length === 0 ? (
                  <p className="text-sm text-gray-400">タスクが設定されていません</p>
                ) : (
                  <div className="space-y-2">
                    {goal.tasks.map((task) => (
                      <div key={task.id} className="relative">
                        {/* Task Info */}
                        <div className="flex items-center gap-3 mb-2">
                          {getStatusIcon(task.status)}
                          <div className="flex-1">
                            <div className="font-medium">{task.title}</div>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                予定: {task.estimate_hours}h / 実際: {task.actual_hours}h
                              </span>
                              {task.due_date && (
                                <span>期限: {formatDate(task.due_date)}</span>
                              )}
                              <span>作成: {formatDate(task.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              style={{ backgroundColor: task.status_color, color: 'white', borderColor: task.status_color }}
                            >
                              {task.progress_percentage}%
                            </Badge>
                          </div>
                        </div>

                        {/* Task Progress Bar */}
                        <div className="ml-7">
                          <Progress
                            value={task.progress_percentage}
                            className="h-2"
                            style={{
                              backgroundColor: '#f1f5f9',
                            }}
                          />
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              backgroundColor: task.status_color,
                              width: `${task.progress_percentage}%`,
                              marginTop: '-8px'
                            }}
                          />
                        </div>

                        {/* Task Timeline Bar */}
                        <div className="mt-2 ml-7 relative">
                          <div className="h-1 bg-gray-100 rounded-full relative overflow-hidden">
                            <div
                              className="absolute h-full rounded-full transition-all"
                              style={{
                                backgroundColor: task.status_color,
                                left: `${calculateTaskPosition(task)}%`,
                                width: `${calculateTaskWidth(task)}%`,
                                opacity: 0.7
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Timeline Legend */}
        <Separator className="my-6" />
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-500"></div>
            <span>完了</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500"></div>
            <span>進行中</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-orange-500"></div>
            <span>50%以上</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-500"></div>
            <span>80%以上</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-400"></div>
            <span>未着手</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500"></div>
            <span>中止</span>
          </div>
        </div>
      </div>
    </div>
  )
}
