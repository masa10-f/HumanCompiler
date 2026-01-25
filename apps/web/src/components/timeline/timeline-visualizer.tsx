"use client"

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useErrorHandler } from './timeline-error-boundary'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Download, Calendar, ZoomIn, ZoomOut, RotateCcw, AlertTriangle, Clock, Target, Layers } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { computeTimelineLayout } from '@/lib/timeline/layout-engine'
import { TimelineGoalBar } from './timeline-goal-bar'
import { TimelineDependencyArrow } from './timeline-dependency-arrow'
import { TimelineTooltip } from './timeline-tooltip'
import type { TimelineData, LayoutModel, LayoutGoal, LayoutTaskSegment, TimelineFilters } from '@/lib/timeline/types'
import { logger } from '@/lib/logger'
import { format, parseISO, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { ja } from 'date-fns/locale'

interface TimelineVisualizerProps {
  data: TimelineData | null
  isLoading: boolean
  error?: string | null
  filters: TimelineFilters
  onFiltersChange: (filters: TimelineFilters) => void
  onRefresh: () => void
}

// Modern color palette
const COLORS = {
  background: {
    primary: '#fafbfc',
    secondary: '#f1f5f9',
    grid: '#e2e8f0',
    gridAlt: '#f8fafc',
  },
  text: {
    primary: '#1e293b',
    secondary: '#64748b',
    muted: '#94a3b8',
  },
  accent: {
    primary: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
  },
}

export function TimelineVisualizer({
  data,
  isLoading,
  error,
  filters,
  onFiltersChange,
  onRefresh
}: TimelineVisualizerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const { handleError } = useErrorHandler()

  const [zoomLevel, setZoomLevel] = useState(1)
  const [selectedGoal, setSelectedGoal] = useState<LayoutGoal | null>(null)
  const [selectedTask, setSelectedTask] = useState<LayoutTaskSegment | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [liveRegionMessage, setLiveRegionMessage] = useState('')

  // Performance optimization: debounce layout computations
  const [layoutComputeTimestamp, setLayoutComputeTimestamp] = useState(0)
  const layoutComputeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // State for fallback mode when layout computation fails
  const [isSimplifiedMode, setIsSimplifiedMode] = useState(false)

  // Compute layout when data changes
  const layoutModel = useMemo<LayoutModel | null>(() => {
    if (!data) return null

    try {
      // Check for large datasets and show warning
      const goalCount = data.goals.length
      const taskCount = data.goals.reduce((sum, g) => sum + g.tasks.length, 0)

      // Determine if virtualization is needed
      const needsVirtualization = goalCount > 100 || taskCount > 500

      if (goalCount > 50 || taskCount > 200) {
        logger.warn('Large dataset detected', { goalCount, taskCount }, { component: 'TimelineVisualizer' })

        if (needsVirtualization) {
          logger.warn('Virtualization recommended for optimal performance', { component: 'TimelineVisualizer' })
        }
      }

      const layoutOptions = {
        canvas_width: Math.max(1400, goalCount * 100),
        canvas_height: Math.max(600, goalCount * 80),
        enable_virtualization: needsVirtualization,
        simplified_mode: isSimplifiedMode
      }

      return computeTimelineLayout(data, layoutOptions)
    } catch (error) {
      logger.error('Layout computation failed', error instanceof Error ? error : new Error(String(error)), { component: 'TimelineVisualizer' })

      // Try simplified mode as fallback - but prevent infinite loops
      if (!isSimplifiedMode) {
        logger.debug('Attempting fallback to simplified mode', { component: 'TimelineVisualizer' })
        // Use setTimeout to prevent immediate re-computation and potential stack overflow
        setTimeout(() => setIsSimplifiedMode(true), 0)
        return null // Will trigger re-computation with simplified mode
      }

      // If simplified mode also fails, return null instead of throwing
      logger.warn('Simplified mode also failed, rendering fallback UI', { component: 'TimelineVisualizer' })
      return null
    }
  }, [data, isSimplifiedMode])

  // Generate time axis markers
  const timeAxisMarkers = useMemo(() => {
    if (!layoutModel || !data) return []

    const startDate = parseISO(layoutModel.timeline.start_date)
    const endDate = parseISO(layoutModel.timeline.end_date)
    const timeUnit = filters.time_unit || 'day'

    let dates: Date[] = []
    try {
      if (timeUnit === 'day') {
        dates = eachDayOfInterval({ start: startDate, end: endDate })
      } else if (timeUnit === 'week') {
        dates = eachWeekOfInterval({ start: startDate, end: endDate }, { locale: ja })
      } else {
        dates = eachMonthOfInterval({ start: startDate, end: endDate })
      }
    } catch {
      return []
    }

    // Limit markers to avoid cluttering
    const maxMarkers = 20
    const step = Math.max(1, Math.floor(dates.length / maxMarkers))

    return dates.filter((_, index) => index % step === 0).map(date => {
      const daysSinceStart = Math.floor((date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      const x = layoutModel.dimensions.padding.left +
        (daysSinceStart / layoutModel.timeline.total_days) * (layoutModel.dimensions.width - layoutModel.dimensions.padding.left - 100)

      let label = ''
      if (timeUnit === 'day') {
        label = format(date, 'M/d', { locale: ja })
      } else if (timeUnit === 'week') {
        label = format(date, 'M/d週', { locale: ja })
      } else {
        label = format(date, 'M月', { locale: ja })
      }

      return { x, label, date }
    })
  }, [layoutModel, data, filters.time_unit])


  // Handle zoom controls
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const newLevel = Math.min(prev * 1.2, 3)
      setLiveRegionMessage(`ズームイン: ${Math.round(newLevel * 100)}%`)
      return newLevel
    })
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const newLevel = Math.max(prev / 1.2, 0.5)
      setLiveRegionMessage(`ズームアウト: ${Math.round(newLevel * 100)}%`)
      return newLevel
    })
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1)
    setLiveRegionMessage('ズームをリセットしました: 100%')
  }, [])

  // Handle filter changes
  const handleTimeUnitChange = useCallback((unit: string) => {
    onFiltersChange({ ...filters, time_unit: unit as 'day' | 'week' | 'month' })
  }, [filters, onFiltersChange])

  // Handle goal selection
  const handleGoalClick = useCallback((goal: LayoutGoal, event: React.MouseEvent) => {
    event.stopPropagation()
    setSelectedGoal(goal)
    setSelectedTask(null)
    setTooltipPosition({ x: event.clientX, y: event.clientY })

    // Announce to screen readers
    setLiveRegionMessage(`ゴール「${goal.title}」を選択しました。ステータス: ${goal.status}`)
  }, [])

  // Handle task selection
  const handleTaskClick = useCallback((task: LayoutTaskSegment, event: React.MouseEvent) => {
    event.stopPropagation()
    setSelectedTask(task)
    setSelectedGoal(null)
    setTooltipPosition({ x: event.clientX, y: event.clientY })

    // Announce to screen readers
    setLiveRegionMessage(`タスク「${task.title}」を選択しました。進捗: ${task.progress_percentage}%`)
  }, [])

  // Close tooltip when clicking outside
  const handleSvgClick = useCallback((event: React.MouseEvent) => {
    if (event.target === svgRef.current) {
      setSelectedGoal(null)
      setSelectedTask(null)
      setTooltipPosition(null)
    }
  }, [])

  // Handle outside clicks to close tooltip
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
      setSelectedGoal(null)
      setSelectedTask(null)
      setTooltipPosition(null)
    }
  }, [])

  // Download timeline as SVG
  const downloadSVG = useCallback(async () => {
    if (!svgRef.current || !data) return

    try {
      const svgElement = svgRef.current
      const svgData = new XMLSerializer().serializeToString(svgElement)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      const link = document.createElement('a')
      link.href = svgUrl
      link.download = `${data.project.title}_timeline.svg`
      link.click()

      URL.revokeObjectURL(svgUrl)

      toast({
        title: "タイムラインをダウンロードしました",
        description: "SVG形式でタイムラインが保存されました。",
      })
    } catch (error) {
      logger.error('Download failed', error instanceof Error ? error : new Error(String(error)), { component: 'TimelineVisualizer' })
      handleError(error instanceof Error ? error : new Error('SVG download failed'))
      toast({
        title: "ダウンロードに失敗しました",
        description: "ファイルの生成中にエラーが発生しました。",
        variant: "destructive",
      })
    }
  }, [data, toast, handleError])

  // Keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!layoutModel) return

    switch (event.key) {
      case 'Escape':
        setSelectedGoal(null)
        setSelectedTask(null)
        setTooltipPosition(null)
        break

      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault()
        const currentGoalIndex = selectedGoal
          ? layoutModel.goals.findIndex(g => g.id === selectedGoal.id)
          : -1

        let newIndex: number
        if (event.key === 'ArrowUp') {
          newIndex = currentGoalIndex <= 0 ? layoutModel.goals.length - 1 : currentGoalIndex - 1
        } else {
          newIndex = currentGoalIndex >= layoutModel.goals.length - 1 ? 0 : currentGoalIndex + 1
        }

        if (newIndex >= 0 && newIndex < layoutModel.goals.length) {
          const newGoal = layoutModel.goals[newIndex]
          setSelectedGoal(newGoal || null)
          setSelectedTask(null)
          setTooltipPosition(null)

          if (newGoal) {
            setLiveRegionMessage(`${newIndex + 1}番目のゴール「${newGoal.title}」を選択`)
          }
        }
        break

      case 'Enter':
      case ' ':
        if (selectedGoal && selectedGoal.segments.length > 0) {
          event.preventDefault()
          setSelectedTask(selectedGoal.segments[0] || null)
        }
        break

      case '+':
      case '=':
        event.preventDefault()
        handleZoomIn()
        break

      case '-':
        event.preventDefault()
        handleZoomOut()
        break

      case '0':
        event.preventDefault()
        handleZoomReset()
        break
    }
  }, [layoutModel, selectedGoal, handleZoomIn, handleZoomOut, handleZoomReset])

  // Memory management and cleanup
  useEffect(() => {
    // Add event listener for clicks outside the timeline
    document.addEventListener('mousedown', handleClickOutside)

    // Clear layout computation timeout on unmount
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)

      if (layoutComputeTimeoutRef.current) {
        clearTimeout(layoutComputeTimeoutRef.current)
        layoutComputeTimeoutRef.current = null
      }

      // Clear any pending state updates
      setSelectedGoal(null)
      setSelectedTask(null)
      setTooltipPosition(null)
    }
  }, [handleClickOutside])

  // Clean up selections when data changes to prevent memory leaks
  useEffect(() => {
    if (data) {
      setSelectedGoal(null)
      setSelectedTask(null)
      setTooltipPosition(null)
    }
  }, [data])

  // Reset simplified mode when new data comes in (separate effect to prevent loops)
  useEffect(() => {
    if (data && isSimplifiedMode) {
      logger.debug('Resetting simplified mode for new data', { component: 'TimelineVisualizer' })
      setIsSimplifiedMode(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]) // intentionally exclude isSimplifiedMode to prevent loops

  // Performance monitoring
  useEffect(() => {
    if (layoutModel) {
      const now = performance.now()

      // Log performance metrics in development
      if (process.env.NODE_ENV === 'development') {
        const computeTime = now - layoutComputeTimestamp
        const taskCount = layoutModel.goals.reduce((sum, g) => sum + g.segments.length, 0)
        logger.debug('Timeline layout computed', { computeTimeMs: computeTime.toFixed(2), goalCount: layoutModel.goals.length, taskCount }, { component: 'TimelineVisualizer' })
      }

      // Update timestamp after logging to avoid infinite loop
      setLayoutComputeTimestamp(now)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutModel]) // Remove layoutComputeTimestamp from dependencies to prevent loop

  // Loading state with modern skeleton
  if (isLoading) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">タイムライン</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4 mb-6">
              <div className="h-10 bg-gradient-to-r from-slate-200 to-slate-100 rounded-lg w-32 animate-pulse" />
              <div className="h-10 bg-gradient-to-r from-slate-200 to-slate-100 rounded-lg w-24 animate-pulse" />
            </div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-32 h-6 bg-gradient-to-r from-slate-200 to-slate-100 rounded animate-pulse" />
                  <div className="flex-1 h-10 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 rounded-lg animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state with modern design
  if (error) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-red-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">タイムライン</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-lg font-medium text-red-600 mb-2">エラーが発生しました</p>
            <p className="text-sm text-slate-600 mb-6 max-w-md mx-auto">{error}</p>
            <Button
              onClick={onRefresh}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-md"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              再試行
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Simplified timeline fallback when layout computation fails
  const SimplifiedTimeline = ({ data }: { data: TimelineData }) => (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Layers className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <span className="text-xl font-semibold text-slate-800">{data.project.title}</span>
            <p className="text-sm font-normal text-amber-600 mt-1 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              簡易表示モード
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {data.goals.map((goal) => (
            <div key={goal.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    goal.status === 'completed' ? 'bg-emerald-500' :
                    goal.status === 'in_progress' ? 'bg-blue-500' :
                    goal.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-400'
                  }`} />
                  <h3 className="font-semibold text-lg text-slate-800">{goal.title}</h3>
                </div>
                <Badge
                  className={`${
                    goal.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    goal.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                    goal.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {goal.status === 'completed' ? '完了' :
                   goal.status === 'in_progress' ? '進行中' :
                   goal.status === 'cancelled' ? '中止' : '未着手'}
                </Badge>
              </div>
              {goal.description && (
                <p className="text-slate-600 text-sm mb-4">{goal.description}</p>
              )}
              <div className="space-y-2">
                {goal.tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        task.status === 'completed' ? 'bg-emerald-500' :
                        task.status === 'in_progress' ? 'bg-blue-500' :
                        task.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-400'
                      }`}
                    />
                    <span className="flex-1 text-slate-700">{task.title}</span>
                    <span className="text-xs text-slate-500 font-medium px-2 py-1 bg-white rounded">
                      {task.estimate_hours}h
                    </span>
                    {task.due_date && (
                      <span className="text-xs text-slate-500">
                        {new Date(task.due_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <Button
            onClick={() => setIsSimplifiedMode(false)}
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            詳細表示を再試行
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  if (!data) {
    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <span className="text-xl font-semibold text-slate-800">タイムライン</span>
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

  if (!layoutModel) {
    // Show simplified timeline as fallback
    return <SimplifiedTimeline data={data} />
  }

  return (
    <div className="space-y-6">
      {/* ARIA Live Region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveRegionMessage}
      </div>

      {/* Header Controls - Modern glassmorphism design */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50 overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-semibold text-slate-800">{data.project.title}</span>
                <p className="text-sm font-normal text-slate-500 mt-0.5">タイムライン</p>
              </div>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filters.time_unit} onValueChange={handleTimeUnitChange}>
                <SelectTrigger className="w-28 bg-white border-slate-200 shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">日単位</SelectItem>
                  <SelectItem value="week">週単位</SelectItem>
                  <SelectItem value="month">月単位</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center bg-slate-100 rounded-lg p-1">
                <Button onClick={handleZoomOut} size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-white">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-slate-600 min-w-[40px] text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <Button onClick={handleZoomIn} size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-white">
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button onClick={handleZoomReset} size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-white">
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
              <Button onClick={downloadSVG} size="sm" className="bg-slate-800 hover:bg-slate-900 shadow-md">
                <Download className="w-4 h-4 mr-2" />
                SVG
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">
                {new Date(layoutModel.timeline.start_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} - {new Date(layoutModel.timeline.end_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Target className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">{layoutModel.goals.length}個のゴール</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">{layoutModel.goals.reduce((sum, g) => sum + g.segments.length, 0)}個のタスク</span>
            </div>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              週{data.project.weekly_work_hours}時間
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Timeline Visualization */}
      <Card className="border-0 shadow-lg overflow-hidden">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="overflow-auto focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
            style={{
              height: Math.min(layoutModel.dimensions.height * zoomLevel + 100, 700),
            }}
            tabIndex={0}
            role="application"
            aria-label="インタラクティブタイムライン表示"
            onKeyDown={handleKeyDown}
          >
            <svg
              ref={svgRef}
              width={layoutModel.dimensions.width * zoomLevel}
              height={layoutModel.dimensions.height * zoomLevel}
              viewBox={`0 0 ${layoutModel.dimensions.width} ${layoutModel.dimensions.height}`}
              role="img"
              aria-labelledby="timeline-title"
              aria-describedby="timeline-description"
              onClick={handleSvgClick}
              style={{ background: `linear-gradient(180deg, ${COLORS.background.primary} 0%, ${COLORS.background.secondary} 100%)` }}
            >
              {/* Accessibility Title and Description */}
              <title id="timeline-title">
                {data.project.title}のタイムライン - {layoutModel.goals.length}個のゴールと{layoutModel.goals.reduce((sum, g) => sum + g.segments.length, 0)}個のタスク
              </title>
              <desc id="timeline-description">
                プロジェクト開始: {new Date(layoutModel.timeline.start_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                終了予定: {new Date(layoutModel.timeline.end_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                週間作業時間: {data.project.weekly_work_hours}時間
              </desc>

              {/* Modern Background Grid */}
              <defs>
                <pattern
                  id="timeline-grid-modern"
                  width="100"
                  height={layoutModel.dimensions.row_height}
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="100" height={layoutModel.dimensions.row_height} fill="transparent" />
                  <line x1="0" y1={layoutModel.dimensions.row_height} x2="100" y2={layoutModel.dimensions.row_height} stroke={COLORS.background.grid} strokeWidth="1" strokeDasharray="4 4" />
                  <line x1="100" y1="0" x2="100" y2={layoutModel.dimensions.row_height} stroke={COLORS.background.grid} strokeWidth="1" opacity="0.5" />
                </pattern>

                {/* Soft gradient for left label area */}
                <linearGradient id="label-area-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>

                {/* Arrow markers */}
                <marker
                  id="arrowhead-modern"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                </marker>

                <marker
                  id="arrowhead-invalid-modern"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
                </marker>
              </defs>

              {/* Grid Background */}
              <rect
                width={layoutModel.dimensions.width}
                height={layoutModel.dimensions.height}
                fill="url(#timeline-grid-modern)"
              />

              {/* Time axis header background */}
              <rect
                x="0"
                y="0"
                width={layoutModel.dimensions.width}
                height="40"
                fill="rgba(255, 255, 255, 0.9)"
              />
              <line
                x1="0"
                y1="40"
                x2={layoutModel.dimensions.width}
                y2="40"
                stroke={COLORS.background.grid}
                strokeWidth="2"
              />

              {/* Time axis markers */}
              {timeAxisMarkers.map((marker, index) => (
                <g key={index}>
                  <line
                    x1={marker.x}
                    y1="40"
                    x2={marker.x}
                    y2={layoutModel.dimensions.height}
                    stroke={COLORS.background.grid}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    opacity="0.6"
                  />
                  <text
                    x={marker.x}
                    y="26"
                    textAnchor="middle"
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      fill: COLORS.text.secondary,
                    }}
                  >
                    {marker.label}
                  </text>
                </g>
              ))}

              {/* Left label area background */}
              <rect
                x="0"
                y="40"
                width={layoutModel.dimensions.padding.left}
                height={layoutModel.dimensions.height - 40}
                fill="url(#label-area-gradient)"
              />

              {/* Goal Bars */}
              <g transform="translate(0, 10)">
                {layoutModel.goals.map(goal => (
                  <TimelineGoalBar
                    key={goal.id}
                    goal={goal}
                    dimensions={layoutModel.dimensions}
                    isSelected={selectedGoal?.id === goal.id}
                    onGoalClick={handleGoalClick}
                    onTaskClick={handleTaskClick}
                    showTaskSegments={filters.show_task_segments !== false}
                  />
                ))}
              </g>

              {/* Dependency Arrows */}
              {filters.show_dependencies !== false && layoutModel.arrows.map(arrow => (
                <TimelineDependencyArrow
                  key={arrow.id}
                  arrow={arrow}
                  isHighlighted={
                    selectedGoal?.id === arrow.from_goal_id ||
                    selectedGoal?.id === arrow.to_goal_id
                  }
                />
              ))}
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Tooltip */}
      {(selectedGoal || selectedTask) && tooltipPosition && (
        <TimelineTooltip
          goal={selectedGoal}
          task={selectedTask}
          position={tooltipPosition}
          onClose={() => {
            setSelectedGoal(null)
            setSelectedTask(null)
            setTooltipPosition(null)
          }}
        />
      )}

      {/* Legend - Modern pill design */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50">
        <CardContent className="py-5">
          {/* Keyboard Navigation Help */}
          <div className="mb-4 text-center">
            <details className="inline-block text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-slate-700 select-none font-medium">
                キーボード操作ガイド
              </summary>
              <div className="mt-3 p-4 bg-slate-50 rounded-xl text-left space-y-2">
                <p><kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">↑</kbd> / <kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">↓</kbd> ゴール選択</p>
                <p><kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">Enter</kbd> / <kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">Space</kbd> タスク詳細表示</p>
                <p><kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">Esc</kbd> 選択解除</p>
                <p><kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">+</kbd> / <kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">-</kbd> ズーム調整</p>
                <p><kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-xs">0</kbd> ズームリセット</p>
              </div>
            </details>
          </div>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600" />
              <span className="text-sm text-emerald-700 font-medium">完了</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-400 to-blue-600" />
              <span className="text-sm text-blue-700 font-medium">進行中</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500" />
              <span className="text-sm text-slate-600 font-medium">未着手</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-400 to-red-600" />
              <span className="text-sm text-red-700 font-medium">中止</span>
            </div>
            {filters.show_dependencies !== false && (
              <>
                <div className="w-px h-6 bg-slate-200" />
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full">
                  <svg width="20" height="8">
                    <line x1="0" y1="4" x2="16" y2="4" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrowhead-modern)" />
                  </svg>
                  <span className="text-sm text-slate-600 font-medium">依存関係</span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
