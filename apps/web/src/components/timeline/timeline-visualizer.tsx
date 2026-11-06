// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTheme } from 'next-themes'
import {
  AlertTriangle,
  CalendarClock,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Flag,
  GitBranch,
  ListChecks,
  LocateFixed,
  RefreshCw,
  Timer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import {
  buildChartLayout,
  CHART,
  HEADER_HEIGHT,
  relatedGoalIds,
} from '@/lib/timeline/chart-layout'
import { formatJstDate } from '@/lib/timeline/geometry'
import { buildSchedule, DAY_MS } from '@/lib/timeline/schedule'
import type { ProjectTimelineData, TimeScale } from '@/lib/timeline/types'
import { formatHours } from '@/lib/timeline/utils'
import {
  ChartBody,
  ChartCorner,
  ChartHeader,
  ChartLabels,
  type ChartFocus,
} from './timeline-chart-layers'
import {
  downloadPng,
  downloadSvg,
  exportDimensions,
  renderExportSvg,
} from './timeline-export'
import { TimelineGoalPanel } from './timeline-goal-panel'
import { DARK_PALETTE, LIGHT_PALETTE, TIMELINE_FONT_FAMILY } from './timeline-palette'

interface TimelineVisualizerProps {
  data: ProjectTimelineData | null
  isLoading: boolean
  error?: string | null
  weeklyWorkHours: number
  onRefresh: () => void
}

const SCALE_OPTIONS: Array<{ value: TimeScale; label: string }> = [
  { value: 'fit', label: '全体' },
  { value: 'month', label: '月' },
  { value: 'week', label: '週' },
  { value: 'day', label: '日' },
]

const CURRENT_TIME_REFRESH_MS = 60 * 60 * 1000

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'late' | 'good'
}) {
  const valueClass =
    tone === 'late'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'good'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-950 dark:text-white'
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className={`mt-1 truncate text-xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      {detail && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-5 rounded-[3px] ${className}`} />
      {label}
    </span>
  )
}

export function TimelineVisualizer({
  data,
  isLoading,
  error,
  weeklyWorkHours,
  onRefresh,
}: TimelineVisualizerProps) {
  const { toast } = useToast()
  const { resolvedTheme } = useTheme()
  const palette = resolvedTheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [now, setNow] = useState<Date | null>(null)
  const [scaleMode, setScaleMode] = useState<TimeScale>('fit')
  const [showCompleted, setShowCompleted] = useState(true)
  const [showDependencies, setShowDependencies] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    const update = () => setNow(new Date())
    update()
    const id = window.setInterval(update, CURRENT_TIME_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  // Track the visible chart width (used by the "fit" zoom level).
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (!element) return
    setViewportWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)
    resizeObserverRef.current = observer
  }, [])
  useEffect(() => () => resizeObserverRef.current?.disconnect(), [])

  const schedule = useMemo(() => {
    if (!data || !now) return null
    try {
      return buildSchedule(data, { weeklyHours: weeklyWorkHours, now })
    } catch (scheduleError) {
      logger.error(
        'Timeline scheduling failed',
        scheduleError instanceof Error ? scheduleError : new Error(String(scheduleError)),
        { component: 'TimelineVisualizer' },
      )
      return null
    }
  }, [data, now, weeklyWorkHours])

  // A narrower name column keeps the bars visible on phones.
  const labelWidth = viewportWidth > 0 && viewportWidth < 640 ? 176 : CHART.labelWidth
  const availableWidth = Math.max(320, viewportWidth - labelWidth)
  const layout = useMemo(
    () =>
      schedule
        ? buildChartLayout(schedule, {
            mode: scaleMode,
            availableWidth,
            expandedGoalIds: expandedIds,
            showCompleted,
            labelWidth,
          })
        : null,
    [availableWidth, expandedIds, labelWidth, scaleMode, schedule, showCompleted],
  )

  // Drop the selection when the goal is no longer on the chart.
  useEffect(() => {
    if (selectedId && layout && !layout.goalRows.has(selectedId)) setSelectedId(null)
  }, [layout, selectedId])

  const focusId = hoveredId ?? selectedId
  const focus: ChartFocus = useMemo(
    () => ({
      selectedId,
      hoveredId,
      related: schedule && focusId ? relatedGoalIds(schedule, focusId) : null,
    }),
    [focusId, hoveredId, schedule, selectedId],
  )

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const element = scrollRef.current
      if (!element || !layout) return
      const visible = element.clientWidth - layout.labelWidth
      element.scrollTo({ left: Math.max(0, layout.todayX - visible * 0.3), behavior })
    },
    [layout],
  )

  // Bring "today" into view whenever the zoom level changes.
  const lastScrolledMode = useRef<string | null>(null)
  useEffect(() => {
    if (!layout) return
    const key = `${scaleMode}:${data?.project.id ?? ''}`
    if (lastScrolledMode.current === key) return
    lastScrolledMode.current = key
    scrollToToday('auto')
  }, [data?.project.id, layout, scaleMode, scrollToToday])

  const selectGoal = useCallback(
    (goalId: string, options: { scroll?: boolean } = {}) => {
      setSelectedId((current) => (current === goalId && !options.scroll ? null : goalId))
      const goal = schedule?.goals.find((item) => item.id === goalId)
      if (goal) setAnnouncement(`${goal.title}を選択しました`)
      if (options.scroll && layout && scrollRef.current) {
        const row = layout.goalRows.get(goalId)
        const element = scrollRef.current
        if (row) {
          const top = row.y
          const bottom = row.y + row.height + HEADER_HEIGHT
          if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight) {
            element.scrollTo({ top: Math.max(0, top - 2 * CHART.goalRowHeight), behavior: 'smooth' })
          }
        }
      }
    },
    [layout, schedule],
  )

  const toggleExpand = useCallback((goalId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(goalId)) next.delete(goalId)
      else next.add(goalId)
      return next
    })
  }, [])

  const expandableIds = layout
    ? Array.from(layout.goalRows.values())
        .filter((row) => row.goal.tasks.length > 0)
        .map((row) => row.goal.id)
    : []
  const allExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expandedIds.has(id))
  const toggleExpandAll = () => {
    if (!layout) return
    setExpandedIds(allExpanded ? new Set() : new Set(expandableIds))
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!layout) return
    if (event.key === 'Escape') {
      setSelectedId(null)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const ids = Array.from(layout.goalRows.keys())
    if (ids.length === 0) return
    const index = selectedId ? ids.indexOf(selectedId) : -1
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = index < 0 ? (direction > 0 ? 0 : ids.length - 1) : (index + direction + ids.length) % ids.length
    selectGoal(ids[nextIndex]!, { scroll: true })
  }

  const handleExport = async (format: 'png' | 'svg') => {
    if (!layout || !schedule || !data) return
    setIsExporting(true)
    try {
      const markup = await renderExportSvg({
        layout,
        schedule,
        projectTitle: data.project.title,
        showDependencies,
      })
      const filename = `${data.project.title}_roadmap_${formatJstDate(schedule.now, true).split('/').join('-')}`
      if (format === 'svg') {
        downloadSvg(markup, `${filename}.svg`)
      } else {
        const { width, height } = exportDimensions(layout)
        await downloadPng(markup, width, height, `${filename}.png`)
      }
      toast({ title: 'ロードマップを書き出しました', description: `${format.toUpperCase()}形式で保存しました。` })
    } catch (exportError) {
      logger.error(
        'Timeline export failed',
        exportError instanceof Error ? exportError : new Error(String(exportError)),
        { component: 'TimelineVisualizer' },
      )
      toast({ title: '書き出しに失敗しました', description: 'もう一度お試しください。', variant: 'destructive' })
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-5" aria-label="タイムラインを読み込み中">
        <div className="h-32 animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800" />
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
          <h2 className="mt-5 text-lg font-semibold">タイムラインを読み込めませんでした</h2>
          <p className="mt-2 max-w-lg text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <Button onClick={onRefresh} className="mt-6">
            <RefreshCw className="mr-2 h-4 w-4" />
            再試行
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="px-6 py-16 text-center text-sm text-slate-500">
          表示できるタイムラインデータがありません。
        </CardContent>
      </Card>
    )
  }

  const selectedGoal = selectedId ? schedule?.goals.find((goal) => goal.id === selectedId) ?? null : null
  const totals = schedule?.totals
  const weeksLeft = schedule?.projectedEnd
    ? Math.max(0, (schedule.projectedEnd.getTime() - schedule.now.getTime()) / (7 * DAY_MS))
    : 0
  const doneGoalCount = schedule?.goals.filter((goal) => goal.phase === 'done').length ?? 0
  const hasGoals = (layout?.goalRows.size ?? 0) > 0

  return (
    <div className="space-y-5">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Roadmap</p>
            <h1 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
              {data.project.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              残り作業を週{weeklyWorkHours}時間のキャパシティで依存関係の順に並べた見込みです。過去のバーは記録された作業ログに基づきます。
            </p>
          </div>
          {totals && (
            <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[640px]">
              <Kpi
                icon={ListChecks}
                label="進捗"
                value={`${Math.round(totals.progress * 100)}%`}
                detail={`ゴール ${doneGoalCount} / ${schedule?.goals.length ?? 0} 完了`}
              />
              <Kpi
                icon={Timer}
                label="残り工数"
                value={formatHours(totals.remainingHours)}
                detail={`実績 ${formatHours(totals.doneHours)}`}
              />
              <Kpi
                icon={CalendarClock}
                label="完了見込み"
                value={schedule?.projectedEnd ? formatJstDate(schedule.projectedEnd, true) : '完了済み'}
                detail={schedule?.projectedEnd ? `あと約${Math.ceil(weeksLeft)}週` : undefined}
                tone={schedule?.projectedEnd ? 'default' : 'good'}
              />
              <Kpi
                icon={Flag}
                label="期限リスク"
                value={schedule?.lateGoalCount ? `${schedule.lateGoalCount}件` : 'なし'}
                detail={schedule?.lateGoalCount ? '期限超過の見込み' : '期限内の見込み'}
                tone={schedule?.lateGoalCount ? 'late' : 'good'}
              />
            </div>
          )}
        </div>
      </section>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="inline-flex w-fit rounded-xl bg-slate-100 p-1 dark:bg-slate-900"
            role="radiogroup"
            aria-label="時間軸の表示単位"
          >
            {SCALE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scaleMode === option.value}
                onClick={() => setScaleMode(option.value)}
                className={`h-8 min-w-[3rem] rounded-lg px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  scaleMode === option.value
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => scrollToToday()}>
              <LocateFixed className="mr-1.5 h-3.5 w-3.5" />
              今日
            </Button>
            <Button
              variant={showCompleted ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 rounded-lg"
              aria-pressed={showCompleted}
              onClick={() => setShowCompleted((value) => !value)}
            >
              完了済み
            </Button>
            <Button
              variant={showDependencies ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 rounded-lg"
              aria-pressed={showDependencies}
              onClick={() => setShowDependencies((value) => !value)}
            >
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              依存関係
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={toggleExpandAll} disabled={expandableIds.length === 0}>
              {allExpanded ? (
                <ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />
              )}
              {allExpanded ? 'タスクを閉じる' : 'タスクを展開'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={!hasGoals || isExporting}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  書き出す
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleExport('png')}>画像 (PNG)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleExport('svg')}>ベクター (SVG)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {schedule && (schedule.hasCycle || schedule.hiddenCancelledCount > 0) && (
          <div className="space-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:px-5" role="status">
            {schedule.hasCycle && (
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                依存関係が循環しています。破線のオレンジの線を確認してください。
              </p>
            )}
            {schedule.hiddenCancelledCount > 0 && (
              <p>中止したゴール {schedule.hiddenCancelledCount}件は表示していません。</p>
            )}
          </div>
        )}

        <div className="flex min-h-0">
          <div className="min-w-0 flex-1">
            {!schedule || !layout ? (
              <CardContent className="px-6 py-16 text-center text-sm text-slate-500">
                ロードマップを計算できませんでした。
                <Button variant="link" onClick={onRefresh}>再読み込み</Button>
              </CardContent>
            ) : !hasGoals ? (
              <div ref={setScrollElement}>
                <CardContent className="px-6 py-16 text-center text-sm text-slate-500">
                  {schedule.goals.length > 0
                    ? 'すべてのゴールが完了しています。「完了済み」をオンにすると履歴を表示します。'
                    : 'このプロジェクトにはまだゴールがありません。'}
                </CardContent>
              </div>
            ) : (
              <div
                ref={setScrollElement}
                className="relative max-h-[72vh] overflow-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                style={{ backgroundColor: palette.background, fontFamily: TIMELINE_FONT_FAMILY }}
                tabIndex={0}
                role="region"
                aria-label={`${data.project.title}のロードマップ。上下キーでゴールを選択できます。`}
                onKeyDown={handleKeyDown}
              >
                <div style={{ width: layout.labelWidth + layout.width }}>
                  <div className="sticky top-0 z-20 flex">
                    <div className="sticky left-0 z-30 shrink-0" style={{ width: layout.labelWidth }}>
                      <svg width={layout.labelWidth} height={HEADER_HEIGHT} className="block">
                        <ChartCorner
                          palette={palette}
                          goalCount={layout.goalRows.size}
                          weeklyHours={schedule.weeklyHours}
                          width={layout.labelWidth}
                        />
                      </svg>
                    </div>
                    <svg width={layout.width} height={HEADER_HEIGHT} className="block shrink-0" aria-hidden="true">
                      <ChartHeader layout={layout} palette={palette} projectedEnd={schedule.projectedEnd} />
                    </svg>
                  </div>
                  <div className="flex">
                    <div className="sticky left-0 z-10 shrink-0" style={{ width: layout.labelWidth }}>
                      <svg
                        width={layout.labelWidth}
                        height={layout.height}
                        className="block select-none"
                        role="list"
                        aria-label="ゴール一覧"
                      >
                        <ChartLabels
                          layout={layout}
                          palette={palette}
                          focus={focus}
                          interaction={{
                            expandedIds,
                            onHover: setHoveredId,
                            onSelect: (id) => selectGoal(id),
                            onToggleExpand: toggleExpand,
                          }}
                        />
                      </svg>
                    </div>
                    <svg
                      width={layout.width}
                      height={layout.height}
                      className="block shrink-0 select-none"
                      aria-hidden="true"
                    >
                      <ChartBody
                        layout={layout}
                        palette={palette}
                        focus={focus}
                        showDependencies={showDependencies}
                        interaction={{
                          expandedIds,
                          onHover: setHoveredId,
                          onSelect: (id) => selectGoal(id),
                          onToggleExpand: toggleExpand,
                        }}
                      />
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {selectedGoal && schedule && (
            <aside className="hidden w-[360px] shrink-0 border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 xl:block">
              <TimelineGoalPanel
                goal={selectedGoal}
                schedule={schedule}
                onClose={() => setSelectedId(null)}
                onSelectGoal={(id) => selectGoal(id, { scroll: true })}
              />
            </aside>
          )}
        </div>

        {selectedGoal && schedule && (
          <div className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 xl:hidden">
            <TimelineGoalPanel
              goal={selectedGoal}
              schedule={schedule}
              onClose={() => setSelectedId(null)}
              onSelectGoal={(id) => selectGoal(id, { scroll: true })}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 sm:px-5">
          <LegendSwatch className="bg-emerald-500" label="完了" />
          <LegendSwatch className="bg-blue-600" label="実施済み（進行中）" />
          <LegendSwatch className="border border-blue-400 bg-blue-100 dark:bg-blue-950" label="残り作業の見込み" />
          <LegendSwatch className="border border-slate-400 bg-slate-100 dark:bg-slate-800" label="未着手の見込み" />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-orange-500" />
            今日
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0 border-l border-dashed border-violet-500" />
            完了見込み
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0 border-l border-dashed border-slate-400" />
            期限
          </span>
          <span className="ml-auto hidden text-slate-500 md:inline">
            ゴールにカーソルを合わせると依存チェーンを強調します
          </span>
        </div>
      </Card>
    </div>
  )
}
