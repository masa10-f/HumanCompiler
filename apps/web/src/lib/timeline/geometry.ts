// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Pixel geometry for the roadmap: time scale, JST calendar axis, dependency
 * link routing and text fitting. Pure functions so the chart and the exported
 * image share exactly the same layout.
 */

import { DAY_MS } from './schedule'
import type { Span } from './types'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export type AxisUnit = 'day' | 'week' | 'month'

/** Pixels per day for each zoom preset. */
export const PX_PER_DAY: Record<AxisUnit, number> = {
  day: 36,
  week: 12,
  month: 3.6,
}

/** Pick the finest readable calendar unit for a given density. */
export function unitForDensity(pxPerDay: number): AxisUnit {
  if (pxPerDay >= 22) return 'day'
  if (pxPerDay >= 5) return 'week'
  return 'month'
}

/** Start of the JST calendar day containing `ms`. */
export function startOfJstDay(ms: number): number {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS
}

/** Start of the JST week (Monday) containing `ms`. */
export function startOfJstWeek(ms: number): number {
  const day = startOfJstDay(ms)
  const weekday = new Date(day + JST_OFFSET_MS).getUTCDay() // 0 = Sunday
  return day - ((weekday + 6) % 7) * DAY_MS
}

function jstParts(ms: number) {
  const shifted = new Date(ms + JST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

function jstMonthStart(year: number, month: number): number {
  return Date.UTC(year, month, 1) - JST_OFFSET_MS
}

/** Start of the JST month containing `ms`. */
export function startOfJstMonth(ms: number): number {
  const { year, month } = jstParts(ms)
  return jstMonthStart(year, month)
}

export function formatJstDate(date: Date | null, withYear = false): string {
  if (!date) return '—'
  const { year, month, day } = jstParts(date.getTime())
  return withYear ? `${year}/${month + 1}/${day}` : `${month + 1}/${day}`
}

export interface TimeScale {
  start: number
  end: number
  pxPerDay: number
  width: number
  x: (value: Date | number) => number
}

/**
 * Build a scale covering `extent` with comfortable margins, aligned to the
 * calendar unit so the first tick sits on the left edge.
 */
export function createTimeScale(
  extent: Span,
  pxPerDay: number,
  unit: AxisUnit,
  options: { leadDays?: number; tailDays?: number; minWidth?: number } = {},
): TimeScale {
  const leadDays = options.leadDays ?? (unit === 'day' ? 2 : unit === 'week' ? 7 : 14)
  const tailDays = options.tailDays ?? (unit === 'day' ? 6 : unit === 'week' ? 21 : 45)
  const rawStart = extent.start.getTime() - leadDays * DAY_MS
  const start =
    unit === 'month'
      ? startOfJstMonth(rawStart)
      : unit === 'week'
        ? startOfJstWeek(rawStart)
        : startOfJstDay(rawStart)
  let end = startOfJstDay(extent.end.getTime() + tailDays * DAY_MS) + DAY_MS
  const minWidth = options.minWidth ?? 0
  if (((end - start) / DAY_MS) * pxPerDay < minWidth) {
    end = start + Math.ceil(minWidth / pxPerDay) * DAY_MS
  }
  const width = ((end - start) / DAY_MS) * pxPerDay
  return {
    start,
    end,
    pxPerDay,
    width,
    x: (value) => {
      const ms = typeof value === 'number' ? value : value.getTime()
      return ((ms - start) / DAY_MS) * pxPerDay
    },
  }
}

export interface AxisBand {
  key: string
  x: number
  width: number
  label: string
}

export interface AxisTick {
  key: string
  x: number
  width: number
  label: string
  sublabel?: string
  isWeekend?: boolean
}

export interface CalendarAxis {
  unit: AxisUnit
  bands: AxisBand[]
  ticks: AxisTick[]
  weekends: Array<{ key: string; x: number; width: number }>
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** Two-tier calendar header: months (or years) on top, days/weeks/months below. */
export function buildCalendarAxis(scale: TimeScale, unit: AxisUnit): CalendarAxis {
  const bands: AxisBand[] = []
  const ticks: AxisTick[] = []
  const weekends: CalendarAxis['weekends'] = []

  const pushBand = (key: string, from: number, to: number, label: string) => {
    const x0 = Math.max(0, scale.x(from))
    const x1 = Math.min(scale.width, scale.x(to))
    if (x1 > x0) bands.push({ key, x: x0, width: x1 - x0, label })
  }

  if (unit === 'month') {
    let { year } = jstParts(scale.start)
    while (jstMonthStart(year, 0) < scale.end) {
      pushBand(`y${year}`, jstMonthStart(year, 0), jstMonthStart(year + 1, 0), `${year}年`)
      year += 1
    }
    let cursor = startOfJstMonth(scale.start)
    while (cursor < scale.end) {
      const { year: y, month } = jstParts(cursor)
      const next = jstMonthStart(y, month + 1)
      ticks.push({
        key: `m${y}-${month}`,
        x: scale.x(cursor),
        width: scale.x(next) - scale.x(cursor),
        label: `${month + 1}月`,
      })
      cursor = next
    }
  } else {
    let monthCursor = startOfJstMonth(scale.start)
    while (monthCursor < scale.end) {
      const { year, month } = jstParts(monthCursor)
      const next = jstMonthStart(year, month + 1)
      pushBand(`m${year}-${month}`, monthCursor, next, `${year}年${month + 1}月`)
      monthCursor = next
    }

    if (unit === 'week') {
      for (let cursor = startOfJstWeek(scale.start); cursor < scale.end; cursor += 7 * DAY_MS) {
        const { month, day } = jstParts(cursor)
        ticks.push({
          key: `w${cursor}`,
          x: scale.x(cursor),
          width: 7 * scale.pxPerDay,
          label: `${month + 1}/${day}`,
        })
      }
    } else {
      for (let cursor = startOfJstDay(scale.start); cursor < scale.end; cursor += DAY_MS) {
        const { day, weekday } = jstParts(cursor)
        const isWeekend = weekday === 0 || weekday === 6
        ticks.push({
          key: `d${cursor}`,
          x: scale.x(cursor),
          width: scale.pxPerDay,
          label: `${day}`,
          sublabel: WEEKDAYS[weekday],
          isWeekend,
        })
      }
    }

    if (scale.pxPerDay >= 6) {
      for (let cursor = startOfJstDay(scale.start); cursor < scale.end; cursor += DAY_MS) {
        const { weekday } = jstParts(cursor)
        if (weekday === 6) {
          weekends.push({ key: `we${cursor}`, x: scale.x(cursor), width: scale.pxPerDay * 2 })
        }
      }
    }
  }

  return { unit, bands, ticks, weekends }
}

export interface Point {
  x: number
  y: number
}

/** Turn an orthogonal polyline into an SVG path with rounded corners. */
export function roundedPolylinePath(points: Point[], radius = 6): string {
  const clean = points.filter((point, index) => {
    const prev = points[index - 1]
    return !prev || prev.x !== point.x || prev.y !== point.y
  })
  if (clean.length === 0) return ''
  const first = clean[0]!
  let d = `M ${first.x} ${first.y}`
  for (let i = 1; i < clean.length; i += 1) {
    const current = clean[i]!
    const next = clean[i + 1]
    if (!next) {
      d += ` L ${current.x} ${current.y}`
      break
    }
    const prev = clean[i - 1]!
    const inLength = Math.hypot(current.x - prev.x, current.y - prev.y)
    const outLength = Math.hypot(next.x - current.x, next.y - current.y)
    const r = Math.min(radius, inLength / 2, outLength / 2)
    if (r <= 0.5) {
      d += ` L ${current.x} ${current.y}`
      continue
    }
    const inX = current.x - ((current.x - prev.x) / inLength) * r
    const inY = current.y - ((current.y - prev.y) / inLength) * r
    const outX = current.x + ((next.x - current.x) / outLength) * r
    const outY = current.y + ((next.y - current.y) / outLength) * r
    d += ` L ${round(inX)} ${round(inY)} Q ${current.x} ${current.y} ${round(outX)} ${round(outY)}`
  }
  return d
}

const round = (value: number) => Math.round(value * 100) / 100

export interface LinkEndpoints {
  /** Predecessor bar: horizontal extent and the edge facing the successor. */
  from: { startX: number; endX: number; edgeY: number }
  /** Successor bar: start x, vertical center and the edge facing the predecessor. */
  to: { startX: number; centerY: number; edgeY: number }
  /** A y coordinate in the free gap just outside the successor's bar. */
  gapY: number
}

/**
 * Route a finish-to-start dependency link between two bars.
 *
 * The link drops from the predecessor's bar just before its end. When the
 * successor starts clearly later, the link turns and enters the successor
 * from the left at its vertical center. When the successor starts at (or
 * before) the predecessor's end — the usual case for back-to-back work — the
 * link runs through the gap above the successor and enters it from the top
 * near its start. Either way it never crosses the labels to the right of a bar.
 */
export function routeDependencyLink(
  { from, to, gapY }: LinkEndpoints,
  options: { radius?: number; inset?: number } = {},
): string {
  const radius = options.radius ?? 6
  const inset = Math.min(options.inset ?? 6, Math.max(1, (from.endX - from.startX) / 2))
  const anchorX = from.endX - inset
  const source = { x: anchorX, y: from.edgeY }

  if (to.startX - anchorX >= 14) {
    return roundedPolylinePath(
      [source, { x: anchorX, y: to.centerY }, { x: to.startX, y: to.centerY }],
      radius,
    )
  }

  const entryX = to.startX + 8
  if (Math.abs(entryX - anchorX) < 2) {
    return roundedPolylinePath([source, { x: anchorX, y: to.edgeY }], radius)
  }
  return roundedPolylinePath(
    [
      source,
      { x: anchorX, y: gapY },
      { x: entryX, y: gapY },
      { x: entryX, y: to.edgeY },
    ],
    radius,
  )
}

/** Rough rendered width of `text` (CJK glyphs are about square). */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0x2e80) width += fontSize
    else if (/[A-Z0-9@#%&mwMW]/.test(char)) width += fontSize * 0.66
    else if (char === ' ') width += fontSize * 0.3
    else width += fontSize * 0.54
  }
  return width
}

/** Truncate `text` with an ellipsis so it fits in `maxWidth` pixels. */
export function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text
  const chars = Array.from(text)
  const ellipsisWidth = fontSize
  let width = 0
  let result = ''
  for (const char of chars) {
    const next = estimateTextWidth(char, fontSize)
    if (width + next + ellipsisWidth > maxWidth) break
    width += next
    result += char
  }
  return `${result.trimEnd()}…`
}
