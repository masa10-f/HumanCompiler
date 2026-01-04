"use client"

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useErrorHandler } from './timeline-error-boundary'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Download, Calendar, ZoomIn, ZoomOut, RotateCcw, AlertTriangle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { computeTimelineLayout } from '@/lib/timeline/layout-engine'
import { TimelineGoalBar } from './timeline-goal-bar'
import { TimelineDependencyArrow } from './timeline-dependency-arrow'
import { TimelineTooltip } from './timeline-tooltip'
import type { TimelineData, LayoutModel, LayoutGoal, LayoutTaskSegment, TimelineFilters } from '@/lib/timeline/types'
import { logger } from '@/lib/logger'

interface TimelineVisualizerProps {
  data: TimelineData | null
  isLoading: boolean
  error?: string | null
  filters: TimelineFilters
  onFiltersChange: (filters: TimelineFilters) => void
  onRefresh: () => void
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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            タイムライン・ビジュアライザー
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
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
            タイムライン・ビジュアライザー
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-500 mb-2">エラーが発生しました</p>
            <p className="text-sm text-gray-600 mb-4">{error}</p>
            <Button onClick={onRefresh} variant="outline">
              再試行
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Simplified timeline fallback when layout computation fails
  const SimplifiedTimeline = ({ data }: { data: TimelineData }) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          タイムライン・ビジュアライザー (簡易表示): {data.project.title}
        </CardTitle>
        <div className="text-sm text-amber-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          レイアウト計算に問題があるため、簡易表示に切り替えました。
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.goals.map((goal, _index) => (
            <div key={goal.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">{goal.title}</h3>
                <Badge variant={goal.status === 'completed' ? 'default' : 'secondary'}>
                  {goal.status}
                </Badge>
              </div>
              {goal.description && (
                <p className="text-gray-600 text-sm mb-3">{goal.description}</p>
              )}
              <div className="space-y-2">
                {goal.tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        task.status === 'completed' ? 'bg-green-500' :
                        task.status === 'in_progress' ? 'bg-blue-500' :
                        task.status === 'cancelled' ? 'bg-red-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="flex-1">{task.title}</span>
                    <span className="text-xs text-gray-500">
                      {task.estimate_hours}時間
                    </span>
                    {task.due_date && (
                      <span className="text-xs text-gray-500">
                        期限: {new Date(task.due_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-center">
          <Button
            onClick={() => setIsSimplifiedMode(false)}
            variant="outline"
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            タイムライン・ビジュアライザー
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-center py-8">
            タイムラインデータが見つかりません。
          </p>
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

      {/* Header Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              タイムライン・ビジュアライザー: {data.project.title}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filters.time_unit} onValueChange={handleTimeUnitChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">日単位</SelectItem>
                  <SelectItem value="week">週単位</SelectItem>
                  <SelectItem value="month">月単位</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleZoomOut} size="sm" variant="outline">
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button onClick={handleZoomIn} size="sm" variant="outline">
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button onClick={handleZoomReset} size="sm" variant="outline">
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button onClick={downloadSVG} size="sm" variant="outline">
                <Download className="w-4 h-4" />
                SVG
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>期間: {new Date(layoutModel.timeline.start_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} ～ {new Date(layoutModel.timeline.end_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>
            <span>•</span>
            <span>{layoutModel.timeline.total_days}日間</span>
            <span>•</span>
            <span>週間作業時間: {data.project.weekly_work_hours}時間</span>
            <Badge variant="outline">
              ズーム: {Math.round(zoomLevel * 100)}%
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Timeline Visualization */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="overflow-auto focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
            style={{
              height: Math.min(layoutModel.dimensions.height * zoomLevel + 100, 600),
              background: '#ffffff'
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
              className="border border-gray-200"
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

              {/* Background Grid */}
              <defs>
                <pattern
                  id="timeline-grid"
                  width="50"
                  height={layoutModel.dimensions.row_height}
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="50" height={layoutModel.dimensions.row_height} fill="none" stroke="#f1f5f9" strokeWidth="0.5" />
                </pattern>

                {/* Arrow marker */}
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
                </marker>

                <marker
                  id="arrowhead-invalid"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
                </marker>
              </defs>

              {/* Grid Background */}
              <rect
                width={layoutModel.dimensions.width}
                height={layoutModel.dimensions.height}
                fill="url(#timeline-grid)"
              />

              {/* Goal Bars */}
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

              {/* Time Axis Labels */}
              <g className="time-axis">
                {/* Add time axis implementation here */}
              </g>
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

      {/* Legend */}
      <Card>
        <CardContent className="pt-6">
          {/* Keyboard Navigation Help */}
          <div className="mb-4 text-center">
            <details className="inline-block text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700 select-none">
                🎮 キーボード操作ガイド
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-left space-y-1">
                <p><kbd className="px-1 bg-white border rounded">↑</kbd> / <kbd className="px-1 bg-white border rounded">↓</kbd> ゴール選択</p>
                <p><kbd className="px-1 bg-white border rounded">Enter</kbd> / <kbd className="px-1 bg-white border rounded">Space</kbd> タスク詳細表示</p>
                <p><kbd className="px-1 bg-white border rounded">Esc</kbd> 選択解除</p>
                <p><kbd className="px-1 bg-white border rounded">+</kbd> / <kbd className="px-1 bg-white border rounded">-</kbd> ズーム調整</p>
                <p><kbd className="px-1 bg-white border rounded">0</kbd> ズームリセット</p>
              </div>
            </details>
          </div>

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
              <div className="w-3 h-3 rounded bg-gray-400"></div>
              <span>未着手</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-red-500"></div>
              <span>中止</span>
            </div>
            {filters.show_dependencies !== false && (
              <>
                <div className="border-l border-gray-300 h-4 mx-2"></div>
                <div className="flex items-center gap-2">
                  <svg width="20" height="8">
                    <line x1="0" y1="4" x2="16" y2="4" stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)" />
                  </svg>
                  <span>依存関係</span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
