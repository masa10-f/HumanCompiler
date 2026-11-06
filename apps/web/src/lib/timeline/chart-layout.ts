// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  buildCalendarAxis,
  createTimeScale,
  PX_PER_DAY,
  routeDependencyLink,
  unitForDensity,
  type AxisUnit,
  type CalendarAxis,
  type TimeScale,
} from './geometry'
import { DAY_MS } from './schedule'
import type {
  ScheduledGoal,
  ScheduledTask,
  TimelineSchedule,
  TimeScale as ScaleMode,
} from './types'

export const CHART = {
  labelWidth: 300,
  bandHeight: 24,
  tickHeight: 30,
  markerHeight: 22,
  goalRowHeight: 48,
  taskRowHeight: 30,
  barHeight: 20,
  taskBarHeight: 10,
} as const

export const HEADER_HEIGHT = CHART.bandHeight + CHART.tickHeight + CHART.markerHeight

export interface GoalRow {
  kind: 'goal'
  key: string
  goal: ScheduledGoal
  y: number
  height: number
  index: number
}

export interface TaskRow {
  kind: 'task'
  key: string
  goal: ScheduledGoal
  task: ScheduledTask
  y: number
  height: number
  index: number
}

export type ChartRow = GoalRow | TaskRow

export interface ChartLink {
  id: string
  fromId: string
  toId: string
  d: string
  conflict: boolean
}

export interface ChartLayout {
  /** Width of the goal-name column. */
  labelWidth: number
  rows: ChartRow[]
  goalRows: Map<string, GoalRow>
  links: ChartLink[]
  scale: TimeScale
  axis: CalendarAxis
  unit: AxisUnit
  width: number
  height: number
  todayX: number
  projectedEndX: number | null
}

export interface ChartLayoutOptions {
  mode: ScaleMode
  /** Width available for the time area, used by the fit mode. */
  availableWidth: number
  expandedGoalIds: ReadonlySet<string>
  showCompleted: boolean
  /** Width of the goal-name column (defaults to CHART.labelWidth). */
  labelWidth?: number
}

export function visibleGoals(
  schedule: TimelineSchedule,
  showCompleted: boolean,
): ScheduledGoal[] {
  return showCompleted
    ? schedule.goals
    : schedule.goals.filter((goal) => goal.phase !== 'done')
}

export function buildChartLayout(
  schedule: TimelineSchedule,
  options: ChartLayoutOptions,
): ChartLayout {
  const goals = visibleGoals(schedule, options.showCompleted)
  const extentStart = goals.reduce(
    (min, goal) => (goal.start < min ? goal.start : min),
    schedule.now,
  )
  const extentEnd = goals.reduce(
    (max, goal) => (goal.end > max ? goal.end : max),
    schedule.now,
  )
  const extent = { start: extentStart, end: extentEnd }

  let unit: AxisUnit
  let pxPerDay: number
  if (options.mode === 'fit') {
    const spanDays = Math.max(14, (extent.end.getTime() - extent.start.getTime()) / DAY_MS)
    // Leave room for the leading margin and the labels after the last bar.
    pxPerDay = Math.max(1.2, (options.availableWidth - 140) / (spanDays * 1.04))
    unit = unitForDensity(pxPerDay)
  } else {
    unit = options.mode
    pxPerDay = PX_PER_DAY[unit]
  }

  let scale: TimeScale
  if (options.mode === 'fit') {
    const margins = {
      leadDays: Math.max(1, 12 / pxPerDay),
      tailDays: Math.max(2, 130 / pxPerDay),
    }
    scale = createTimeScale(extent, pxPerDay, unit, margins)
    // Calendar snapping widens the range; rescale so everything fits exactly.
    if (Math.abs(scale.width - options.availableWidth) > 1) {
      pxPerDay = (pxPerDay * options.availableWidth) / scale.width
      scale = createTimeScale(extent, pxPerDay, unit, margins)
    }
  } else {
    scale = createTimeScale(extent, pxPerDay, unit, { minWidth: options.availableWidth })
  }
  const axis = buildCalendarAxis(scale, unit)

  const rows: ChartRow[] = []
  const goalRows = new Map<string, GoalRow>()
  let y = 0
  goals.forEach((goal, index) => {
    const row: GoalRow = {
      kind: 'goal',
      key: goal.id,
      goal,
      y,
      height: CHART.goalRowHeight,
      index,
    }
    rows.push(row)
    goalRows.set(goal.id, row)
    y += row.height
    if (options.expandedGoalIds.has(goal.id)) {
      goal.tasks.forEach((task) => {
        rows.push({
          kind: 'task',
          key: `${goal.id}:${task.id}`,
          goal,
          task,
          y,
          height: CHART.taskRowHeight,
          index,
        })
        y += CHART.taskRowHeight
      })
    }
  })

  const links: ChartLink[] = []
  schedule.links.forEach((link) => {
    const fromRow = goalRows.get(link.fromId)
    const toRow = goalRows.get(link.toId)
    if (!fromRow || !toRow) return
    const goesDown = toRow.y > fromRow.y
    const fromCenter = fromRow.y + fromRow.height / 2
    const toCenter = toRow.y + toRow.height / 2
    const halfBar = CHART.barHeight / 2
    const toEdgeY = goesDown ? toCenter - halfBar : toCenter + halfBar
    links.push({
      id: link.id,
      fromId: link.fromId,
      toId: link.toId,
      conflict: link.conflict,
      d: routeDependencyLink({
        from: {
          startX: scale.x(fromRow.goal.start),
          endX: scale.x(fromRow.goal.end),
          edgeY: goesDown ? fromCenter + halfBar : fromCenter - halfBar,
        },
        to: { startX: scale.x(toRow.goal.start), centerY: toCenter, edgeY: toEdgeY },
        gapY: goesDown ? toRow.y + 6 : toRow.y + toRow.height - 6,
      }),
    })
  })

  return {
    labelWidth: options.labelWidth ?? CHART.labelWidth,
    rows,
    goalRows,
    links,
    scale,
    axis,
    unit,
    width: scale.width,
    height: Math.max(y, CHART.goalRowHeight),
    todayX: scale.x(schedule.now),
    projectedEndX: schedule.projectedEnd ? scale.x(schedule.projectedEnd) : null,
  }
}

/** Goals connected to `goalId` through dependencies, in both directions. */
export function relatedGoalIds(
  schedule: TimelineSchedule,
  goalId: string,
): Set<string> {
  const byId = new Map(schedule.goals.map((goal) => [goal.id, goal]))
  const related = new Set<string>([goalId])
  const walk = (key: 'dependencyIds' | 'dependentIds') => {
    const visited = new Set<string>([goalId])
    const stack = [goalId]
    while (stack.length > 0) {
      for (const next of byId.get(stack.pop()!)?.[key] ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        related.add(next)
        stack.push(next)
      }
    }
  }
  walk('dependencyIds')
  walk('dependentIds')
  return related
}
