'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { parseISO } from 'date-fns'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  Download,
  Flag,
  GitBranch,
  Layers3,
  RefreshCw,
  Target,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { computeTimelineLayout } from '@/lib/timeline/layout-engine'
import { logger } from '@/lib/logger'
import type {
  LayoutGoal,
  LayoutModel,
  LayoutTaskSegment,
  TimelineData,
  TimelineFilters,
} from '@/lib/timeline/types'
import { TimelineDependencyArrow } from './timeline-dependency-arrow'
import { TimelineGoalBar } from './timeline-goal-bar'
import { TimelineTooltip } from './timeline-tooltip'

interface TimelineVisualizerProps {
  data: TimelineData | null
  isLoading: boolean
  error?: string | null
  filters: TimelineFilters
  onFiltersChange: (filters: TimelineFilters) => void
  onRefresh: () => void
}

const CHART = {
  labelWidth: 330,
  rowHeight: 108,
  barHeight: 42,
  barOffsetY: 47,
  headerHeight: 72,
}

const RENDER_LIMITS = {
  goals: 100,
  taskSegments: 500,
}

const clampPercentage = (value: number) => Math.min(100, Math.max(0, value))

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

const shortDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
})

const longDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

const formatShortDate = (date: Date) => shortDateFormatter.format(date)
const formatLongDate = (value: string) =>
  longDateFormatter.format(new Date(value))

function ProgressDial({ percentage }: { percentage: number }) {
  const value = Math.round(clampPercentage(percentage))

  return (
    <div
      className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(#2563eb ${value * 3.6}deg, #e8edf5 0deg)`,
      }}
      role="img"
      aria-label={`プロジェクト進捗 ${value}%`}
    >
      <div className="absolute inset-[9px] rounded-full bg-white shadow-inner dark:bg-slate-950" />
      <div className="relative text-center">
        <div className="font-mono text-3xl font-semibold tracking-[-0.08em] text-slate-950 dark:text-white">
          {value}
          <span className="ml-0.5 text-base tracking-normal text-slate-500">
            %
          </span>
        </div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
          完了
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  tone?: 'slate' | 'blue' | 'emerald' | 'amber'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    emerald:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  }

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {value}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
          {detail}
        </p>
      </div>
    </div>
  )
}

export function TimelineVisualizer({
  data,
  isLoading,
  error,
  filters,
  onFiltersChange,
  onRefresh,
}: TimelineVisualizerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const [zoomLevel, setZoomLevel] = useState(1)
  const [selectedGoal, setSelectedGoal] = useState<LayoutGoal | null>(null)
  const [selectedTask, setSelectedTask] = useState<LayoutTaskSegment | null>(
    null,
  )
  const [liveRegionMessage, setLiveRegionMessage] = useState('')
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number
    y: number
  } | null>(null)

  const datasetSize = useMemo(
    () => ({
      goals: data?.goals.length ?? 0,
      tasks:
        data?.goals.reduce((count, goal) => count + goal.tasks.length, 0) ??
        0,
    }),
    [data],
  )
  const goalsAreCapped = datasetSize.goals > RENDER_LIMITS.goals
  const taskSegmentsAreCapped =
    datasetSize.tasks > RENDER_LIMITS.taskSegments
  const isLargeDataset = goalsAreCapped || taskSegmentsAreCapped

  const layoutModel = useMemo<LayoutModel | null>(() => {
    if (!data) return null
    try {
      const visibleGoals = data.goals.slice(0, RENDER_LIMITS.goals)
      const layoutData =
        visibleGoals.length === data.goals.length
          ? data
          : { ...data, goals: visibleGoals }
      const goalCount = visibleGoals.length

      if (data.goals.length > RENDER_LIMITS.goals) {
        logger.warn(
          'Timeline goal rendering capped for a large dataset',
          {
            totalGoals: data.goals.length,
            renderedGoals: RENDER_LIMITS.goals,
          },
          { component: 'TimelineVisualizer' },
        )
      }

      return computeTimelineLayout(layoutData, {
        canvas_width: Math.max(1440, 1120 + goalCount * 36),
        canvas_height: Math.max(
          320,
          goalCount * CHART.rowHeight + CHART.headerHeight + 48,
        ),
        row_height: CHART.rowHeight,
        goal_bar_height: CHART.barHeight,
        goal_bar_offset_y: CHART.barOffsetY,
        padding: {
          top: CHART.headerHeight,
          right: 88,
          bottom: 48,
          left: CHART.labelWidth,
        },
      })
    } catch (layoutError) {
      logger.error(
        'Timeline layout computation failed',
        layoutError instanceof Error
          ? layoutError
          : new Error(String(layoutError)),
        { component: 'TimelineVisualizer' },
      )
      return null
    }
  }, [data])

  const summary = useMemo(() => {
    if (!data) return null
    const tasks = data.goals.flatMap((goal) => goal.tasks)
    const totalHours = tasks.reduce(
      (sum, task) => sum + Math.max(0, task.estimate_hours),
      0,
    )
    const completedEquivalentHours = tasks.reduce(
      (sum, task) =>
        sum +
        Math.max(0, task.estimate_hours) *
          (clampPercentage(task.progress_percentage) / 100),
      0,
    )
    const completedTasks = tasks.filter(
      (task) => task.status === 'completed',
    ).length
    const activeTasks = tasks.filter(
      (task) => task.status === 'in_progress',
    ).length
    const now = Date.now()
    const overdueTasks = tasks.filter((task) => {
      if (
        !task.due_date ||
        task.status === 'completed' ||
        task.status === 'cancelled'
      )
        return false
      const due = Date.parse(task.due_date)
      return Number.isFinite(due) && due < now
    }).length
    const progress =
      totalHours > 0
        ? (completedEquivalentHours / totalHours) * 100
        : tasks.length > 0
          ? (completedTasks / tasks.length) * 100
          : 0

    return {
      tasks,
      totalHours,
      completedEquivalentHours,
      remainingHours: Math.max(0, totalHours - completedEquivalentHours),
      completedTasks,
      activeTasks,
      overdueTasks,
      progress,
    }
  }, [data])

  const timeAxisMarkers = useMemo(() => {
    if (!layoutModel) return []
    const startDate = parseISO(layoutModel.timeline.start_date)
    const endDate = parseISO(layoutModel.timeline.end_date)
    const dates: Date[] = []
    const endTime = endDate.getTime()
    const oneDay = 86_400_000

    if (filters.time_unit === 'month') {
      const cursor = new Date(startDate)
      while (cursor.getTime() <= endTime) {
        dates.push(new Date(cursor))
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
    } else {
      const stepMs = filters.time_unit === 'week' ? oneDay * 7 : oneDay
      for (
        let timestamp = startDate.getTime();
        timestamp <= endTime;
        timestamp += stepMs
      ) {
        dates.push(new Date(timestamp))
      }
    }

    const maxMarkers = 14
    const step = Math.max(1, Math.ceil(dates.length / maxMarkers))
    const chartWidth =
      layoutModel.dimensions.width -
      layoutModel.dimensions.padding.left -
      layoutModel.dimensions.padding.right

    return dates
      .filter((_, index) => index % step === 0)
      .map((date) => {
        const elapsedDays = (date.getTime() - startDate.getTime()) / 86_400_000
        const x =
          layoutModel.dimensions.padding.left +
          (elapsedDays / Math.max(1, layoutModel.timeline.total_days)) *
            chartWidth
        const label =
          filters.time_unit === 'month'
            ? new Intl.DateTimeFormat('ja-JP', {
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: 'short',
              }).format(date)
            : formatShortDate(date)
        return { x, label, date }
      })
  }, [filters.time_unit, layoutModel])

  const todayX = useMemo(() => {
    if (!layoutModel) return null
    const start = parseISO(layoutModel.timeline.start_date).getTime()
    const end = parseISO(layoutModel.timeline.end_date).getTime()
    const today = Date.now()
    if (today < start || today > end || end <= start) return null
    const chartWidth =
      layoutModel.dimensions.width -
      layoutModel.dimensions.padding.left -
      layoutModel.dimensions.padding.right
    return (
      layoutModel.dimensions.padding.left +
      ((today - start) / (end - start)) * chartWidth
    )
  }, [layoutModel])

  const updateFilters = useCallback(
    (patch: Partial<TimelineFilters>) => {
      onFiltersChange({ ...filters, ...patch })
    },
    [filters, onFiltersChange],
  )

  const getActivationPosition = useCallback(
    (event: React.SyntheticEvent<SVGGElement>) => {
      const nativeEvent = event.nativeEvent
      if (
        'clientX' in nativeEvent &&
        'clientY' in nativeEvent &&
        typeof nativeEvent.clientX === 'number' &&
        typeof nativeEvent.clientY === 'number' &&
        nativeEvent.clientX > 0
      ) {
        return { x: nativeEvent.clientX, y: nativeEvent.clientY }
      }

      const bounds = event.currentTarget.getBoundingClientRect()
      return { x: bounds.left + bounds.width / 2, y: bounds.top }
    },
    [],
  )

  const openGoal = useCallback(
    (goal: LayoutGoal, event: React.SyntheticEvent<SVGGElement>) => {
      event.stopPropagation()
      setSelectedGoal(goal)
      setSelectedTask(null)
      setTooltipPosition(getActivationPosition(event))
      setLiveRegionMessage(
        `ゴール「${goal.title}」を選択しました。進捗 ${Math.round(goal.progress * 100)}%。`,
      )
    },
    [getActivationPosition],
  )

  const openTask = useCallback(
    (task: LayoutTaskSegment, event: React.SyntheticEvent<SVGGElement>) => {
      event.stopPropagation()
      setSelectedTask(task)
      setSelectedGoal(null)
      setTooltipPosition(getActivationPosition(event))
      setLiveRegionMessage(
        `タスク「${task.title}」を選択しました。進捗 ${Math.round(task.progress * 100)}%。`,
      )
    },
    [getActivationPosition],
  )

  const closeTooltip = useCallback(() => {
    setSelectedGoal(null)
    setSelectedTask(null)
    setTooltipPosition(null)
    setLiveRegionMessage('詳細表示を閉じました。')
  }, [])

  const handleZoomIn = useCallback(() => {
    setZoomLevel((value) => {
      const next = Math.min(1.8, value + 0.1)
      setLiveRegionMessage(`表示倍率 ${Math.round(next * 100)}%。`)
      return next
    })
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel((value) => {
      const next = Math.max(0.7, value - 0.1)
      setLiveRegionMessage(`表示倍率 ${Math.round(next * 100)}%。`)
      return next
    })
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1)
    setLiveRegionMessage('表示倍率を100%に戻しました。')
  }, [])

  const handleTimelineKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!layoutModel) return

      if (event.key === 'Escape') {
        closeTooltip()
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        handleZoomIn()
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        handleZoomOut()
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        handleZoomReset()
        return
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

      event.preventDefault()
      const selectedGoalId =
        selectedGoal?.id ||
        layoutModel.goals.find((goal) =>
          goal.segments.some((segment) => segment.id === selectedTask?.id),
        )?.id
      const currentIndex = layoutModel.goals.findIndex(
        (goal) => goal.id === selectedGoalId,
      )
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : layoutModel.goals.length - 1
          : (currentIndex + direction + layoutModel.goals.length) %
            layoutModel.goals.length
      const nextGoal = layoutModel.goals[nextIndex]
      if (!nextGoal) return

      setSelectedGoal(nextGoal)
      setSelectedTask(null)
      setTooltipPosition(null)
      setLiveRegionMessage(
        `${nextIndex + 1}番目のゴール「${nextGoal.title}」。進捗 ${Math.round(nextGoal.progress * 100)}%。`,
      )
    },
    [
      closeTooltip,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      layoutModel,
      selectedGoal,
      selectedTask,
    ],
  )

  const downloadSVG = useCallback(() => {
    if (!svgRef.current || !data) return
    try {
      const source = new XMLSerializer().serializeToString(svgRef.current)
      const url = URL.createObjectURL(
        new Blob([source], { type: 'image/svg+xml;charset=utf-8' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${data.project.title}_timeline.svg`
      link.click()
      URL.revokeObjectURL(url)
      toast({
        title: 'タイムラインを書き出しました',
        description: 'SVG形式で保存しました。',
      })
    } catch (downloadError) {
      logger.error(
        'Timeline download failed',
        downloadError instanceof Error
          ? downloadError
          : new Error(String(downloadError)),
        { component: 'TimelineVisualizer' },
      )
      toast({
        title: '書き出しに失敗しました',
        description: 'もう一度お試しください。',
        variant: 'destructive',
      })
    }
  }, [data, toast])

  if (isLoading) {
    return (
      <div className="space-y-5" aria-label="タイムラインを読み込み中">
        <div className="h-48 animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800" />
        <div className="h-[460px] animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="overflow-hidden border-red-200 bg-red-50/70 shadow-none dark:border-red-900 dark:bg-red-950/30">
        <CardContent className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold">
            タイムラインを読み込めませんでした
          </h2>
          <p className="mt-2 max-w-lg text-sm text-slate-600 dark:text-slate-300">
            {error}
          </p>
          <Button onClick={onRefresh} className="mt-6">
            <RefreshCw className="mr-2 h-4 w-4" />
            再試行
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data || !summary) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="px-6 py-16 text-center text-sm text-slate-500">
          表示できるタイムラインデータがありません。
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveRegionMessage}
      </div>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.12),_transparent_38%),linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_18px_60px_-34px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.18),_transparent_38%),linear-gradient(135deg,#0f172a_0%,#020617_100%)] sm:p-7">
        <div className="flex min-w-0 flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center">
            <ProgressDial percentage={summary.progress} />
            <div className="min-w-0">
              <Badge className="border-0 bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300">
                PROJECT TIMELINE
              </Badge>
              <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {data.project.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                見積工数を基準に、各タスクの進捗を加重平均しています。
                <span className="ml-1 font-semibold text-slate-900 dark:text-white">
                  {formatHours(summary.completedEquivalentHours)} 完了相当 / 全{' '}
                  {formatHours(summary.totalHours)}
                </span>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatLongDate(
                    layoutModel?.timeline.start_date ??
                      data.timeline.start_date,
                  )}{' '}
                  —{' '}
                  {formatLongDate(
                    layoutModel?.timeline.end_date ?? data.timeline.end_date,
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />週{' '}
                  {data.project.weekly_work_hours}h
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:min-w-[610px]">
            <MetricCard
              icon={Target}
              label="残り工数"
              value={formatHours(summary.remainingHours)}
              detail={`全体 ${formatHours(summary.totalHours)}`}
              tone="blue"
            />
            <MetricCard
              icon={Check}
              label="完了タスク"
              value={`${summary.completedTasks} / ${summary.tasks.length}`}
              detail={`${summary.activeTasks}件が進行中`}
              tone="emerald"
            />
            <MetricCard
              icon={Flag}
              label="ゴール"
              value={`${data.goals.length}件`}
              detail={`${data.goals.filter((goal) => goal.status === 'completed').length}件完了`}
            />
            <MetricCard
              icon={AlertTriangle}
              label="期限超過"
              value={`${summary.overdueTasks}件`}
              detail={summary.overdueTasks ? '要確認' : '遅延なし'}
              tone={summary.overdueTasks ? 'amber' : 'slate'}
            />
          </div>
        </div>
      </section>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
              <Layers3 className="h-4 w-4 text-blue-600" />
              ロードマップ
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              バーを選択すると、ゴールやタスクの内訳を確認できます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.time_unit}
              onValueChange={(value) =>
                updateFilters({
                  time_unit: value as TimelineFilters['time_unit'],
                })
              }
            >
              <SelectTrigger
                className="h-9 w-[112px] rounded-xl bg-white dark:bg-slate-950"
                aria-label="時間軸"
              >
                <SelectValue
                  placeholder={
                    filters.time_unit === 'day'
                      ? '日単位'
                      : filters.time_unit === 'month'
                        ? '月単位'
                        : '週単位'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">日単位</SelectItem>
                <SelectItem value="week">週単位</SelectItem>
                <SelectItem value="month">月単位</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={
                filters.show_task_segments !== false &&
                !taskSegmentsAreCapped
                  ? 'secondary'
                  : 'outline'
              }
              size="sm"
              className="h-9 rounded-xl"
              disabled={taskSegmentsAreCapped}
              onClick={() =>
                updateFilters({
                  show_task_segments: filters.show_task_segments === false,
                })
              }
            >
              <Layers3 className="mr-1.5 h-3.5 w-3.5" />
              タスク内訳
            </Button>
            <Button
              variant={
                filters.show_dependencies !== false ? 'secondary' : 'outline'
              }
              size="sm"
              className="h-9 rounded-xl"
              onClick={() =>
                updateFilters({
                  show_dependencies: filters.show_dependencies === false,
                })
              }
            >
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              依存関係
            </Button>
            <div
              className="flex h-9 items-center rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900"
              aria-label={`表示倍率 ${Math.round(zoomLevel * 100)}%`}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0"
                onClick={handleZoomOut}
                aria-label="縮小"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[92px] text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                表示倍率 {Math.round(zoomLevel * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0"
                onClick={handleZoomIn}
                aria-label="拡大"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={downloadSVG}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              書き出す
            </Button>
          </div>
        </div>

        {isLargeDataset && (
          <div
            className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6"
            role="status"
          >
            データ量が多いため、表示を最適化しています。
            {goalsAreCapped && ` ゴールは先頭${RENDER_LIMITS.goals}件を表示します。`}
            {taskSegmentsAreCapped &&
              ' タスク内訳は省略し、ゴール単位で表示します。'}
          </div>
        )}

        {!layoutModel ? (
          <CardContent className="px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    簡易表示に切り替えました
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    チャートを描画できないため、ゴールの進捗を一覧で表示しています。
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={onRefresh}>
                再読み込み
              </Button>
            </div>
            <div
              className="mt-4 max-h-[560px] space-y-2 overflow-auto"
              role="list"
              aria-label="ゴール進捗の簡易表示"
            >
              {data.goals.slice(0, RENDER_LIMITS.goals).map((goal) => {
                const totalHours = goal.tasks.reduce(
                  (sum, task) => sum + Math.max(0, task.estimate_hours),
                  0,
                )
                const completedHours = goal.tasks.reduce(
                  (sum, task) =>
                    sum +
                    Math.max(0, task.estimate_hours) *
                      (clampPercentage(task.progress_percentage) / 100),
                  0,
                )
                const percentage = totalHours
                  ? Math.round((completedHours / totalHours) * 100)
                  : 0

                return (
                  <div
                    key={goal.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                    role="listitem"
                  >
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="truncate font-semibold text-slate-900 dark:text-white">
                        {goal.title}
                      </span>
                      <span className="shrink-0 font-mono font-semibold text-slate-600 dark:text-slate-300">
                        {percentage}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        ) : layoutModel.goals.length === 0 ? (
          <CardContent className="px-6 py-16 text-center text-sm text-slate-500">
            この期間に表示できるゴールがありません。
          </CardContent>
        ) : (
          <div
            ref={containerRef}
            className="overflow-auto bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:bg-slate-950"
            style={{ maxHeight: 720 }}
            tabIndex={0}
            role="region"
            aria-label="プロジェクトのロードマップ"
            aria-keyshortcuts="ArrowUp ArrowDown Escape + - 0"
            onKeyDown={handleTimelineKeyDown}
          >
            <svg
              ref={svgRef}
              width={layoutModel.dimensions.width * zoomLevel}
              height={layoutModel.dimensions.height * zoomLevel}
              viewBox={`0 0 ${layoutModel.dimensions.width} ${layoutModel.dimensions.height}`}
              role="img"
              aria-labelledby="timeline-title timeline-description"
              onClick={(event) => {
                if (event.target === svgRef.current) closeTooltip()
              }}
            >
              <title id="timeline-title">{`${data.project.title}のタイムライン`}</title>
              <desc id="timeline-description">{`${layoutModel.goals.length}個のゴールを、期間と進捗率で表示しています。`}</desc>
              <defs>
                <filter
                  id="timeline-soft-shadow"
                  x="-20%"
                  y="-50%"
                  width="140%"
                  height="200%"
                >
                  <feDropShadow
                    dx="0"
                    dy="3"
                    stdDeviation="4"
                    floodColor="#0f172a"
                    floodOpacity="0.12"
                  />
                </filter>
                <marker
                  id="arrowhead"
                  viewBox="0 0 8 8"
                  markerWidth="7"
                  markerHeight="7"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path
                    d="M 1 1.25 L 6.5 4 L 1 6.75"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </marker>
                <marker
                  id="arrowhead-invalid"
                  viewBox="0 0 8 8"
                  markerWidth="7"
                  markerHeight="7"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path
                    d="M 1 1.25 L 6.5 4 L 1 6.75"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </marker>
              </defs>

              <rect
                width="100%"
                height="100%"
                fill="#ffffff"
                className="dark:fill-slate-950"
              />
              <rect
                x="0"
                y="0"
                width={CHART.labelWidth}
                height="100%"
                fill="#f8fafc"
                className="dark:fill-slate-900"
              />
              <rect
                x="0"
                y="0"
                width="100%"
                height={CHART.headerHeight}
                fill="#ffffff"
                className="dark:fill-slate-950"
              />
              <line
                x1="0"
                y1={CHART.headerHeight}
                x2="100%"
                y2={CHART.headerHeight}
                stroke="#cbd5e1"
              />
              <line
                x1={CHART.labelWidth}
                y1="0"
                x2={CHART.labelWidth}
                y2="100%"
                stroke="#cbd5e1"
              />

              <text
                x="28"
                y="30"
                fontSize="10"
                fontWeight="700"
                letterSpacing="1.4"
                fill="#64748b"
              >
                GOALS
              </text>
              <text
                x="28"
                y="51"
                fontSize="13"
                fontWeight="600"
                fill="#0f172a"
                className="dark:fill-white"
              >
                ゴールと完了率
              </text>
              {timeAxisMarkers.map((marker) => (
                <g key={marker.date.toISOString()}>
                  <line
                    x1={marker.x}
                    y1={CHART.headerHeight}
                    x2={marker.x}
                    y2="100%"
                    stroke="#e2e8f0"
                    strokeDasharray="3 5"
                  />
                  <text
                    x={marker.x + 8}
                    y="43"
                    fontSize="11"
                    fontWeight="600"
                    fill="#64748b"
                  >
                    {marker.label}
                  </text>
                </g>
              ))}

              {layoutModel.goals.map((goal, index) => {
                const y = CHART.headerHeight + index * CHART.rowHeight
                return (
                  <rect
                    key={`row-${goal.id}`}
                    x="0"
                    y={y}
                    width="100%"
                    height={CHART.rowHeight}
                    fill={index % 2 === 0 ? '#ffffff' : '#f8fafc'}
                    className={
                      index % 2 === 0
                        ? 'dark:fill-slate-950'
                        : 'dark:fill-slate-900/60'
                    }
                  />
                )
              })}

              {todayX !== null && (
                <g className="pointer-events-none">
                  <line
                    x1={todayX}
                    y1="22"
                    x2={todayX}
                    y2="100%"
                    stroke="#f97316"
                    strokeWidth="1.5"
                  />
                  <rect
                    x={todayX - 22}
                    y="16"
                    width="44"
                    height="20"
                    rx="10"
                    fill="#fff7ed"
                    stroke="#fdba74"
                  />
                  <text
                    x={todayX}
                    y="26"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#c2410c"
                  >
                    今日
                  </text>
                </g>
              )}

              {filters.show_dependencies !== false &&
                layoutModel.arrows.map((arrow) => (
                  <TimelineDependencyArrow
                    key={arrow.id}
                    arrow={arrow}
                    isHighlighted={
                      selectedGoal?.id === arrow.from_goal_id ||
                      selectedGoal?.id === arrow.to_goal_id
                    }
                  />
                ))}

              {layoutModel.goals.map((goal) => (
                <TimelineGoalBar
                  key={goal.id}
                  goal={goal}
                  dimensions={layoutModel.dimensions}
                  isSelected={selectedGoal?.id === goal.id}
                  onGoalClick={openGoal}
                  onTaskClick={openTask}
                  showTaskSegments={
                    filters.show_task_segments !== false &&
                    !taskSegmentsAreCapped
                  }
                />
              ))}
            </svg>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 sm:px-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
              進行中
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              完了
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              未着手
            </span>
          </div>
          <span>完了率は見積工数で重み付けしています</span>
        </div>
      </Card>

      {(selectedGoal || selectedTask) && tooltipPosition && (
        <TimelineTooltip
          goal={selectedGoal}
          task={selectedTask}
          position={tooltipPosition}
          onClose={closeTooltip}
        />
      )}
    </div>
  )
}
