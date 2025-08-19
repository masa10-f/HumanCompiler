"use client"

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { TimelineErrorBoundary, useErrorHandler } from './timeline-error-boundary'
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

  // Performance optimization: debounce layout computations
  const [layoutComputeTimestamp, setLayoutComputeTimestamp] = useState(0)
  const layoutComputeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Compute layout when data changes
  const layoutModel = useMemo<LayoutModel | null>(() => {
    if (!data) return null

    try {
      // Check for large datasets and show warning
      const goalCount = data.goals.length
      const taskCount = data.goals.reduce((sum, g) => sum + g.tasks.length, 0)

      if (goalCount > 50 || taskCount > 200) {
        console.warn(`Large dataset detected: ${goalCount} goals, ${taskCount} tasks. Performance may be impacted.`)

        if (process.env.NODE_ENV === 'development') {
          toast({
            title: "大規模データセットを検出",
            description: `${goalCount}個のゴール、${taskCount}個のタスクがあります。パフォーマンスに影響する可能性があります。`,
            variant: "destructive",
          })
        }
      }

      return computeTimelineLayout(data, {
        canvas_width: Math.max(1400, goalCount * 100), // Scale canvas with data size
        canvas_height: Math.max(600, goalCount * 80)
      })
    } catch (error) {
      console.error('Layout computation failed:', error)
      handleError(error instanceof Error ? error : new Error('Layout computation failed'))
      return null
    }
  }, [data, handleError, toast])

  // Handle zoom controls
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev * 1.2, 3))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev / 1.2, 0.5))
  }, [])

  const handleResetView = useCallback(() => {
    setZoomLevel(1)
  }, [])

  // Handle filter changes
  const handleTimeUnitChange = useCallback((unit: string) => {
    onFiltersChange({ ...filters, time_unit: unit as 'day' | 'week' | 'month' })
  }, [filters, onFiltersChange])

  // Handle goal selection
  const handleGoalClick = useCallback((goal: LayoutGoal, event: React.MouseEvent) => {
    setSelectedGoal(goal)
    setSelectedTask(null)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }, [])

  // Handle task selection
  const handleTaskClick = useCallback((task: LayoutTaskSegment, event: React.MouseEvent) => {
    setSelectedTask(task)
    setSelectedGoal(null)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }, [])

  // Close tooltip when clicking outside
  const handleSvgClick = useCallback((event: React.MouseEvent) => {
    if (event.target === svgRef.current) {
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
      console.error('Download failed:', error)
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
          setSelectedGoal(layoutModel.goals[newIndex])
          setSelectedTask(null)
          setTooltipPosition(null)
        }
        break

      case 'Enter':
      case ' ':
        if (selectedGoal && selectedGoal.segments.length > 0) {
          event.preventDefault()
          setSelectedTask(selectedGoal.segments[0])
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
    // Clear layout computation timeout on unmount
    return () => {
      if (layoutComputeTimeoutRef.current) {
        clearTimeout(layoutComputeTimeoutRef.current)
        layoutComputeTimeoutRef.current = null
      }
    }
  }, [])

  // Clean up selections when data changes to prevent memory leaks
  useEffect(() => {
    if (data) {
      setSelectedGoal(null)
      setSelectedTask(null)
      setTooltipPosition(null)
    }
  }, [data])

  // Performance monitoring
  useEffect(() => {
    if (layoutModel) {
      const now = performance.now()
      setLayoutComputeTimestamp(now)

      // Log performance metrics in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`Timeline layout computed in ${(now - layoutComputeTimestamp).toFixed(2)}ms`)
        console.log(`Goals: ${layoutModel.goals.length}, Tasks: ${layoutModel.goals.reduce((sum, g) => sum + g.segments.length, 0)}`)
      }
    }
  }, [layoutModel, layoutComputeTimestamp])

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

  if (!data || !layoutModel) {
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

  return (
    <div className="space-y-6">
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
              <Button onClick={handleResetView} size="sm" variant="outline">
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button onClick={downloadSVG} size="sm" variant="outline">
                <Download className="w-4 h-4" />
                SVG
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>期間: {new Date(layoutModel.timeline.start_date).toLocaleDateString()} ～ {new Date(layoutModel.timeline.end_date).toLocaleDateString()}</span>
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
                プロジェクト開始: {new Date(layoutModel.timeline.start_date).toLocaleDateString('ja-JP')}
                終了予定: {new Date(layoutModel.timeline.end_date).toLocaleDateString('ja-JP')}
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
