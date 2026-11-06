// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// No 'use client': the API's roadmap image route also renders this module on
// the server (see lib/timeline/render-image.tsx). Keep it free of hooks.

import React from 'react'
import {
  CHART,
  HEADER_HEIGHT,
  type ChartLayout,
  type GoalRow,
  type TaskRow,
} from '@/lib/timeline/chart-layout'
import { estimateTextWidth, fitText, formatJstDate } from '@/lib/timeline/geometry'
import { deadlineOf } from '@/lib/timeline/schedule'
import type { ScheduledGoal, Span } from '@/lib/timeline/types'
import { formatHours } from '@/lib/timeline/utils'
import type { TimelinePalette } from './timeline-palette'

export interface ChartFocus {
  selectedId: string | null
  hoveredId: string | null
  /** Goals connected to the focused goal; null when nothing is focused. */
  related: Set<string> | null
}

export interface ChartInteraction {
  expandedIds: ReadonlySet<string>
  onHover: (goalId: string | null) => void
  onSelect: (goalId: string) => void
  onToggleExpand: (goalId: string) => void
}

interface LayerProps {
  layout: ChartLayout
  palette: TimelinePalette
  focus: ChartFocus
  interaction?: ChartInteraction
}

const isDimmed = (focus: ChartFocus, goalId: string) =>
  focus.related !== null && !focus.related.has(goalId)

function rowFill(
  palette: TimelinePalette,
  focus: ChartFocus,
  row: GoalRow | TaskRow,
) {
  if (row.kind === 'task') return palette.taskRow
  if (focus.selectedId === row.goal.id) return palette.rowSelected
  if (focus.hoveredId === row.goal.id) return palette.rowHover
  return row.index % 2 === 1 ? palette.rowAlt : palette.background
}

const PHASE_LABEL = { done: '完了', active: '進行中', planned: '未着手' } as const

export function goalSummaryText(goal: ScheduledGoal): string {
  if (goal.phase === 'done') {
    const estimated = goal.finishIsEstimated ? '（推定）' : ''
    return `完了 · ${formatJstDate(goal.finish)}${estimated} · ${formatHours(goal.estimateHours)}`
  }
  if (goal.phase === 'active') {
    return `進行中 · ${Math.round(goal.progress * 100)}% · 残り ${formatHours(goal.remainingHours)}`
  }
  const waiting = goal.waitingOnIds.length
    ? ` · 前提${goal.waitingOnIds.length}件待ち`
    : ''
  return `未着手 · ${formatHours(goal.remainingHours)}${waiting}`
}

function rowHandlers(interaction: ChartInteraction | undefined, goalId: string) {
  if (!interaction) return {}
  return {
    onMouseEnter: () => interaction.onHover(goalId),
    onMouseLeave: () => interaction.onHover(null),
    onClick: () => interaction.onSelect(goalId),
    style: { cursor: 'pointer' },
  }
}

/* ------------------------------------------------------------------------ */
/* Corner                                                                    */
/* ------------------------------------------------------------------------ */

export function ChartCorner({
  palette,
  goalCount,
  weeklyHours,
  width,
}: {
  palette: TimelinePalette
  goalCount: number
  weeklyHours: number
  width: number
}) {
  return (
    <g>
      <rect width={width} height={HEADER_HEIGHT} fill={palette.headerBackground} />
      <text x={20} y={30} fontSize={12} fontWeight={700} fill={palette.text}>
        ゴール
      </text>
      <text x={20} y={50} fontSize={11} fill={palette.textMuted}>
        {fitText(`${goalCount}件 · 週${weeklyHours}hで計画`, width - 28, 11)}
      </text>
      <line
        x1={0}
        y1={HEADER_HEIGHT - 0.5}
        x2={width}
        y2={HEADER_HEIGHT - 0.5}
        stroke={palette.border}
      />
      <line
        x1={width - 0.5}
        y1={0}
        x2={width - 0.5}
        y2={HEADER_HEIGHT}
        stroke={palette.border}
      />
    </g>
  )
}

/* ------------------------------------------------------------------------ */
/* Header                                                                    */
/* ------------------------------------------------------------------------ */

export function ChartHeader({
  layout,
  palette,
  projectedEnd,
}: {
  layout: ChartLayout
  palette: TimelinePalette
  projectedEnd: Date | null
}) {
  const { axis, width } = layout
  const tickTop = CHART.bandHeight
  const markerTop = CHART.bandHeight + CHART.tickHeight
  const isDay = axis.unit === 'day'

  const todayPill = { x: layout.todayX - 22, width: 44 }
  let projectedPill: { x: number; width: number; label: string } | null = null
  if (layout.projectedEndX !== null && projectedEnd) {
    const label = `完了見込み ${formatJstDate(projectedEnd)}`
    const pillWidth = estimateTextWidth(label, 10) + 16
    let x = layout.projectedEndX - pillWidth / 2
    if (x < todayPill.x + todayPill.width + 6 && x + pillWidth > todayPill.x - 6) {
      x = todayPill.x + todayPill.width + 6
    }
    projectedPill = { x: Math.min(x, width - pillWidth - 2), width: pillWidth, label }
  }

  return (
    <g>
      <rect width={width} height={HEADER_HEIGHT} fill={palette.headerBackground} />
      {axis.bands.map((band) => (
        <g key={band.key}>
          <line
            x1={band.x}
            y1={0}
            x2={band.x}
            y2={HEADER_HEIGHT}
            stroke={palette.gridMajor}
          />
          {band.width > 40 && (
            <text x={band.x + 8} y={16} fontSize={11} fontWeight={700} fill={palette.text}>
              {fitText(band.label, band.width - 12, 11)}
            </text>
          )}
        </g>
      ))}
      <line x1={0} y1={tickTop - 0.5} x2={width} y2={tickTop - 0.5} stroke={palette.border} />
      {axis.ticks.map((tick) => (
        <g key={tick.key}>
          <line
            x1={tick.x}
            y1={tickTop}
            x2={tick.x}
            y2={markerTop}
            stroke={palette.gridMinor}
          />
          {isDay ? (
            <>
              <text
                x={tick.x + tick.width / 2}
                y={tickTop + 13}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={tick.isWeekend ? palette.textSubtle : palette.textMuted}
              >
                {tick.label}
              </text>
              <text
                x={tick.x + tick.width / 2}
                y={tickTop + 25}
                textAnchor="middle"
                fontSize={9}
                fill={palette.textSubtle}
              >
                {tick.sublabel}
              </text>
            </>
          ) : (
            tick.width >= 26 && (
              <text
                x={tick.x + 6}
                y={tickTop + 19}
                fontSize={11}
                fontWeight={600}
                fill={palette.textMuted}
              >
                {tick.label}
              </text>
            )
          )}
        </g>
      ))}
      <line x1={0} y1={markerTop - 0.5} x2={width} y2={markerTop - 0.5} stroke={palette.border} />

      {projectedPill && (
        <g>
          <rect
            x={projectedPill.x}
            y={markerTop + 3}
            width={projectedPill.width}
            height={16}
            rx={8}
            fill={palette.projectedSoft}
            stroke={palette.projected}
            strokeWidth={1}
          />
          <text
            x={projectedPill.x + projectedPill.width / 2}
            y={markerTop + 14.5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill={palette.projected}
          >
            {projectedPill.label}
          </text>
        </g>
      )}
      <g>
        <rect
          x={todayPill.x}
          y={markerTop + 3}
          width={todayPill.width}
          height={16}
          rx={8}
          fill={palette.today}
        />
        <text
          x={layout.todayX}
          y={markerTop + 14.5}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill={palette.onSolid}
        >
          今日
        </text>
      </g>
      <line
        x1={0}
        y1={HEADER_HEIGHT - 0.5}
        x2={width}
        y2={HEADER_HEIGHT - 0.5}
        stroke={palette.border}
      />
    </g>
  )
}

/* ------------------------------------------------------------------------ */
/* Labels                                                                    */
/* ------------------------------------------------------------------------ */

function StatusIcon({
  goal,
  palette,
  cx,
  cy,
}: {
  goal: ScheduledGoal
  palette: TimelinePalette
  cx: number
  cy: number
}) {
  if (goal.phase === 'done') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill={palette.done} />
        <path
          d={`M ${cx - 3.2} ${cy + 0.2} L ${cx - 0.8} ${cy + 2.6} L ${cx + 3.4} ${cy - 2.4}`}
          fill="none"
          stroke={palette.onSolid}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }
  if (goal.phase === 'active') {
    const angle = Math.max(0.05, Math.min(0.999, goal.progress)) * Math.PI * 2
    const x = cx + 4.5 * Math.sin(angle)
    const y = cy - 4.5 * Math.cos(angle)
    return (
      <g>
        <circle cx={cx} cy={cy} r={6.5} fill="none" stroke={palette.active} strokeWidth={1.6} />
        <path
          d={`M ${cx} ${cy} L ${cx} ${cy - 4.5} A 4.5 4.5 0 ${angle > Math.PI ? 1 : 0} 1 ${x} ${y} Z`}
          fill={palette.active}
        />
      </g>
    )
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={6.5}
      fill="none"
      stroke={palette.plannedStroke}
      strokeWidth={1.6}
      strokeDasharray="2.4 2"
    />
  )
}

export function ChartLabels({ layout, palette, focus, interaction }: LayerProps) {
  const width = layout.labelWidth
  const showTaskHours = width >= 240
  return (
    <g>
      <rect width={width} height={layout.height} fill={palette.labelBackground} />
      {layout.rows.map((row) => {
        const dimmed = isDimmed(focus, row.goal.id)
        if (row.kind === 'task') {
          const { task } = row
          const cy = row.y + row.height / 2
          const color =
            task.status === 'completed'
              ? palette.done
              : task.status === 'in_progress'
                ? palette.active
                : palette.plannedStroke
          const hours =
            task.status === 'completed'
              ? formatHours(task.estimateHours)
              : `残り ${formatHours(task.remainingHours)}`
          return (
            <g key={row.key} opacity={dimmed ? 0.35 : 1} {...rowHandlers(interaction, row.goal.id)}>
              <rect x={0} y={row.y} width={width} height={row.height} fill={palette.taskRow} />
              <line x1={42} y1={row.y} x2={42} y2={row.y + row.height} stroke={palette.border} />
              <circle cx={56} cy={cy} r={3.5} fill={color} />
              <text
                x={66}
                y={cy + 4}
                fontSize={12}
                fill={task.status === 'completed' ? palette.textMuted : palette.text}
                textDecoration={task.status === 'cancelled' ? 'line-through' : undefined}
              >
                {fitText(task.title, width - 66 - (showTaskHours ? 84 : 12), 12)}
              </text>
              {showTaskHours && <text
                x={width - 14}
                y={cy + 4}
                textAnchor="end"
                fontSize={10.5}
                fill={task.isLate ? palette.late : palette.textSubtle}
              >
                {hours}
              </text>}
            </g>
          )
        }

        const { goal } = row
        const hasTasks = goal.tasks.length > 0
        const expanded = interaction?.expandedIds.has(goal.id) ?? false
        const summary = goalSummaryText(goal)
        const metaWidth = width - 48 - 14
        const rawDueText = goal.delayDays > 0
          ? ` · ${goal.delayDays}日遅れ${goal.phase === 'done' ? 'で完了' : '見込み'}`
          : goal.dueDate && goal.phase !== 'done'
            ? ` · 期限 ${formatJstDate(goal.dueDate)}`
            : ''
        // Keep the due/late note only when the summary still has room.
        const dueText =
          metaWidth - estimateTextWidth(rawDueText, 11) >= 90 ? rawDueText : ''
        const summaryText = fitText(summary, metaWidth - estimateTextWidth(dueText, 11), 11)
        return (
          <g
            key={row.key}
            opacity={dimmed ? 0.35 : 1}
            {...rowHandlers(interaction, goal.id)}
            data-goal-row={goal.id}
          >
            <rect x={0} y={row.y} width={width} height={row.height} fill={rowFill(palette, focus, row)} />
            {focus.selectedId === goal.id && (
              <rect x={0} y={row.y} width={3} height={row.height} fill={palette.active} />
            )}
            {hasTasks && interaction && (
              <g
                role="button"
                tabIndex={-1}
                aria-label={expanded ? 'タスクを折りたたむ' : 'タスクを展開'}
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation()
                  interaction.onToggleExpand(goal.id)
                }}
              >
                <rect x={4} y={row.y + 12} width={22} height={24} rx={6} fill="transparent" />
                <path
                  d={
                    expanded
                      ? `M 11 ${row.y + 21} L 15 ${row.y + 25} L 19 ${row.y + 21}`
                      : `M 13 ${row.y + 19} L 17 ${row.y + 23} L 13 ${row.y + 27}`
                  }
                  fill="none"
                  stroke={palette.textMuted}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}
            <StatusIcon goal={goal} palette={palette} cx={36} cy={row.y + 18} />
            <text x={50} y={row.y + 22} fontSize={13} fontWeight={600} fill={palette.text}>
              {fitText(goal.title, width - 50 - 14, 13)}
            </text>
            <text x={50} y={row.y + 38} fontSize={11} fill={palette.textMuted}>
              {summaryText}
              {dueText && (
                <tspan fill={goal.delayDays > 0 ? palette.late : palette.textSubtle} fontWeight={goal.delayDays > 0 ? 700 : 400}>
                  {dueText}
                </tspan>
              )}
            </text>
            <line
              x1={0}
              y1={row.y + row.height - 0.5}
              x2={width}
              y2={row.y + row.height - 0.5}
              stroke={palette.gridMinor}
            />
          </g>
        )
      })}
      <line
        x1={width - 0.5}
        y1={0}
        x2={width - 0.5}
        y2={layout.height}
        stroke={palette.border}
      />
    </g>
  )
}

/* ------------------------------------------------------------------------ */
/* Body                                                                      */
/* ------------------------------------------------------------------------ */

function SpanRect({
  span,
  layout,
  y,
  height,
  fill,
  stroke,
  radius,
}: {
  span: Span
  layout: ChartLayout
  y: number
  height: number
  fill: string
  stroke?: string
  radius: number
}) {
  const x0 = layout.scale.x(span.start)
  const x1 = layout.scale.x(span.end)
  const width = Math.max(4, x1 - x0)
  return (
    <rect
      x={x0}
      y={y}
      width={width}
      height={height}
      rx={Math.min(radius, height / 2, width / 2)}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? 1 : undefined}
    />
  )
}

function Diamond({ x, y, size, fill, stroke }: { x: number; y: number; size: number; fill: string; stroke?: string }) {
  return (
    <path
      d={`M ${x} ${y - size} L ${x + size} ${y} L ${x} ${y + size} L ${x - size} ${y} Z`}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? 1.2 : undefined}
    />
  )
}

function GoalBar({ row, layout, palette }: { row: GoalRow; layout: ChartLayout; palette: TimelinePalette }) {
  const { goal } = row
  const cy = row.y + row.height / 2
  const top = cy - CHART.barHeight / 2
  const isLate = goal.delayDays > 0
  const { x } = layout.scale

  const deadline = deadlineOf(goal.dueDate)
  const deadlineColor = isLate ? palette.late : palette.textSubtle

  const actualFill = goal.phase === 'done' ? palette.done : palette.active
  const plannedFill = goal.phase === 'active' ? palette.activeSoft : palette.plannedSoft
  const plannedStroke = isLate
    ? palette.late
    : goal.phase === 'active'
      ? palette.activeStroke
      : palette.plannedStroke

  const isMilestone =
    goal.phase === 'planned' && goal.planned !== null && goal.remainingHours <= 0

  // Title inside the bar when there is room.
  let inner: { x: number; text: string; color: string } | null = null
  const plannedWidth = goal.planned ? x(goal.planned.end) - x(goal.planned.start) : 0
  const actualWidth = goal.actual ? x(goal.actual.end) - x(goal.actual.start) : 0
  if (goal.planned && plannedWidth >= 64) {
    inner = {
      x: x(goal.planned.start) + 8,
      text: fitText(goal.title, plannedWidth - 16, 11),
      color: goal.phase === 'active' ? palette.linkHighlight : palette.textMuted,
    }
  } else if (goal.actual && actualWidth >= 64) {
    inner = {
      x: x(goal.actual.start) + 8,
      text: fitText(goal.title, actualWidth - 16, 11),
      color: palette.onSolid,
    }
  }

  const endX = x(goal.end) + (isMilestone ? 10 : 8)
  const endLabel =
    goal.phase === 'done'
      ? `${formatJstDate(goal.finish)} 完了${goal.finishIsEstimated ? '（推定）' : ''}`
      : `〜${formatJstDate(goal.finish)}`
  const endLabelWidth = estimateTextWidth(endLabel, 10.5)

  return (
    <g pointerEvents="none">
      {deadline && (
        <g>
          <line
            x1={x(deadline)}
            y1={row.y + 7}
            x2={x(deadline)}
            y2={row.y + row.height - 5}
            stroke={deadlineColor}
            strokeWidth={1.2}
            strokeDasharray="2 2"
          />
          <path
            d={`M ${x(deadline)} ${row.y + 5} l 7 3.5 l -7 3.5 Z`}
            fill={deadlineColor}
          />
        </g>
      )}
      {goal.actual && (
        <SpanRect
          span={goal.actual}
          layout={layout}
          y={top}
          height={CHART.barHeight}
          fill={actualFill}
          radius={5}
        />
      )}
      {goal.actual && goal.planned && x(goal.planned.start) - x(goal.actual.end) > 3 && (
        <line
          x1={x(goal.actual.end)}
          y1={cy}
          x2={x(goal.planned.start)}
          y2={cy}
          stroke={plannedStroke}
          strokeWidth={1.5}
          strokeDasharray="1.5 3"
          strokeLinecap="round"
        />
      )}
      {goal.planned && !isMilestone && (
        <SpanRect
          span={goal.planned}
          layout={layout}
          y={top}
          height={CHART.barHeight}
          fill={plannedFill}
          stroke={plannedStroke}
          radius={5}
        />
      )}
      {isMilestone && goal.planned && (
        <Diamond x={x(goal.planned.start)} y={cy} size={7} fill={palette.plannedSoft} stroke={plannedStroke} />
      )}
      {inner && (
        <text x={inner.x} y={cy + 4} fontSize={11} fontWeight={600} fill={inner.color}>
          {inner.text}
        </text>
      )}
      <text x={endX} y={cy + 4} fontSize={10.5} fill={palette.textMuted}>
        {endLabel}
      </text>
      {isLate && (
        <g>
          <rect
            x={endX + endLabelWidth + 6}
            y={cy - 8}
            width={estimateTextWidth(`+${goal.delayDays}日`, 10) + 12}
            height={16}
            rx={8}
            fill={palette.lateSoft}
          />
          <text
            x={endX + endLabelWidth + 12}
            y={cy + 3.5}
            fontSize={10}
            fontWeight={700}
            fill={palette.late}
          >
            {`+${goal.delayDays}日`}
          </text>
        </g>
      )}
    </g>
  )
}

function TaskBar({ row, layout, palette }: { row: TaskRow; layout: ChartLayout; palette: TimelinePalette }) {
  const { task } = row
  const { x } = layout.scale
  const cy = row.y + row.height / 2
  const top = cy - CHART.taskBarHeight / 2
  const isDone = task.status === 'completed' || row.goal.phase === 'done'

  let labelX: number | null = null
  const parts: React.ReactNode[] = []
  if (task.actual) {
    parts.push(
      <SpanRect
        key="actual"
        span={task.actual}
        layout={layout}
        y={top}
        height={CHART.taskBarHeight}
        fill={isDone ? palette.done : palette.active}
        radius={3}
      />,
    )
    labelX = x(task.actual.end)
  }
  if (task.planned) {
    parts.push(
      <SpanRect
        key="planned"
        span={task.planned}
        layout={layout}
        y={top}
        height={CHART.taskBarHeight}
        fill={task.status === 'in_progress' ? palette.activeSoft : palette.plannedSoft}
        stroke={task.isLate ? palette.late : task.status === 'in_progress' ? palette.activeStroke : palette.plannedStroke}
        radius={3}
      />,
    )
    labelX = Math.max(labelX ?? 0, x(task.planned.end))
  }
  if (!task.actual && !task.planned && task.finish && task.status !== 'cancelled') {
    parts.push(
      <Diamond key="done" x={x(task.finish)} y={cy} size={5} fill={palette.done} />,
    )
    labelX = x(task.finish) + 2
  }
  const due = deadlineOf(task.dueDate)
  return (
    <g pointerEvents="none">
      {due && !isDone && (
        <path
          d={`M ${x(due)} ${cy - 6} l 4 6 l -4 6 l -4 -6 Z`}
          fill="none"
          stroke={task.isLate ? palette.late : palette.textSubtle}
          strokeWidth={1.2}
        />
      )}
      {parts}
      {labelX !== null && task.finish && (
        <text x={labelX + 6} y={cy + 3.5} fontSize={10} fill={task.isLate ? palette.late : palette.textSubtle}>
          {isDone ? `${formatJstDate(task.finish)} 完了` : `〜${formatJstDate(task.finish)}`}
        </text>
      )}
    </g>
  )
}

export function ChartBody({
  layout,
  palette,
  focus,
  interaction,
  showDependencies,
  markerPrefix = 'tl',
}: LayerProps & { showDependencies: boolean; markerPrefix?: string }) {
  const { width, height } = layout
  const focusActive = focus.related !== null
  const markerFor = (kind: 'normal' | 'highlight' | 'conflict') => `${markerPrefix}-arrow-${kind}`

  return (
    <g>
      <defs>
        {(
          [
            ['normal', palette.link],
            ['highlight', palette.linkHighlight],
            ['conflict', palette.linkConflict],
          ] as const
        ).map(([kind, color]) => (
          <marker
            key={kind}
            id={markerFor(kind)}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 1 1.5 L 9 5 L 1 8.5 Z" fill={color} />
          </marker>
        ))}
      </defs>

      <rect width={width} height={height} fill={palette.background} />

      {layout.rows.map((row) => (
        <rect
          key={`bg-${row.key}`}
          x={0}
          y={row.y}
          width={width}
          height={row.height}
          fill={rowFill(palette, focus, row)}
          {...rowHandlers(interaction, row.goal.id)}
        />
      ))}

      <g pointerEvents="none">
        {layout.axis.weekends.map((weekend) => (
          <rect
            key={weekend.key}
            x={weekend.x}
            y={0}
            width={weekend.width}
            height={height}
            fill={palette.weekend}
            opacity={0.7}
          />
        ))}
        {layout.axis.ticks.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x}
            y1={0}
            x2={tick.x}
            y2={height}
            stroke={palette.gridMinor}
          />
        ))}
        {layout.axis.bands.map((band) => (
          <line
            key={band.key}
            x1={band.x}
            y1={0}
            x2={band.x}
            y2={height}
            stroke={palette.gridMajor}
          />
        ))}
        {layout.rows
          .filter((row) => row.kind === 'goal')
          .map((row) => (
            <line
              key={`sep-${row.key}`}
              x1={0}
              y1={row.y + row.height - 0.5}
              x2={width}
              y2={row.y + row.height - 0.5}
              stroke={palette.gridMinor}
            />
          ))}
        {layout.projectedEndX !== null && (
          <line
            x1={layout.projectedEndX}
            y1={0}
            x2={layout.projectedEndX}
            y2={height}
            stroke={palette.projected}
            strokeWidth={1.2}
            strokeDasharray="5 4"
            opacity={0.7}
          />
        )}
        <line
          x1={layout.todayX}
          y1={0}
          x2={layout.todayX}
          y2={height}
          stroke={palette.today}
          strokeWidth={1.5}
        />
      </g>

      {showDependencies && (
        <g pointerEvents="none" fill="none">
          {layout.links.map((link) => {
            const highlighted =
              focusActive &&
              focus.related!.has(link.fromId) &&
              focus.related!.has(link.toId)
            const kind = link.conflict ? 'conflict' : highlighted ? 'highlight' : 'normal'
            const stroke =
              kind === 'conflict'
                ? palette.linkConflict
                : kind === 'highlight'
                  ? palette.linkHighlight
                  : palette.link
            return (
              <path
                key={link.id}
                d={link.d}
                stroke={stroke}
                strokeWidth={highlighted ? 2 : 1.3}
                strokeDasharray={link.conflict ? '4 3' : undefined}
                opacity={focusActive && !highlighted ? 0.18 : 1}
                markerEnd={`url(#${markerFor(kind)})`}
                data-link={link.id}
              />
            )
          })}
        </g>
      )}

      {layout.rows.map((row) => (
        <g key={`bar-${row.key}`} opacity={isDimmed(focus, row.goal.id) ? 0.3 : 1}>
          {row.kind === 'goal' ? (
            <GoalBar row={row} layout={layout} palette={palette} />
          ) : (
            <TaskBar row={row} layout={layout} palette={palette} />
          )}
        </g>
      ))}
    </g>
  )
}

export const PHASE_LABELS = PHASE_LABEL
