// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Scheduling and drawing, with the web app's own code (apps/web/src through
 * the "@/..." alias), so the picture matches the timeline page's export.
 */

import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import {
  exportDimensions,
  exportScale,
  renderExportSvg,
} from '@/components/timeline/timeline-export'
import { buildChartLayout, CHART, visibleGoals } from '@/lib/timeline/chart-layout'
import { buildSchedule } from '@/lib/timeline/schedule'
import type {
  ProjectTimelineData,
  TimelineSchedule,
  TimeScale,
} from '@/lib/timeline/types'

/** Weekly hours used when the project has no effort ratio (as on the page). */
export const FALLBACK_WEEKLY_HOURS = 20
export const MIN_WIDTH = 640
export const MAX_WIDTH = 4000
/** Longest image side in pixels; larger images are scaled down to it. */
const MAX_PIXEL_SIDE = 8000

const FONT_DIR = path.join(__dirname, '..', 'fonts')
const FONT_FILES = [
  path.join(FONT_DIR, 'NotoSansJP_400Regular.ttf'),
  path.join(FONT_DIR, 'NotoSansJP_700Bold.ttf'),
]

export type WeeklyHoursSource = 'option' | 'capacity' | 'fallback'

export interface ScheduleInput {
  /** Overrides the project's capacity from the triage settings. */
  weeklyHours?: number
  now?: Date
}

export interface PlannedRoadmap {
  schedule: TimelineSchedule
  weeklyHoursSource: WeeklyHoursSource
}

/**
 * The weekly hours the roadmap plans with: the given value, else the
 * project's share of the weekly capacity from the triage settings, else the
 * page's temporary default.
 */
export function resolveWeeklyHours(
  data: ProjectTimelineData,
  override: number | undefined,
): { hours: number; source: WeeklyHoursSource } {
  if (override !== undefined) return { hours: override, source: 'option' }
  const capacity = data.project.capacity?.weekly_work_hours ?? data.project.weekly_work_hours
  if (capacity > 0) return { hours: capacity, source: 'capacity' }
  return { hours: FALLBACK_WEEKLY_HOURS, source: 'fallback' }
}

export function planRoadmap(data: ProjectTimelineData, input: ScheduleInput): PlannedRoadmap {
  const weekly = resolveWeeklyHours(data, input.weeklyHours)
  const schedule = buildSchedule(data, { weeklyHours: weekly.hours, now: input.now ?? new Date() })
  return { schedule, weeklyHoursSource: weekly.source }
}

export interface DrawOptions {
  /** Zoom: `fit` fits the whole period into `width`. */
  zoom: TimeScale
  /** Image width in CSS pixels for `fit`; the minimum for the other zooms. */
  width: number
  showCompleted: boolean
  showDependencies: boolean
  expandTasks: boolean
  /** Goals per image; 0 puts all of them in one image. */
  goalsPerPage: number
  /** Pixels per CSS pixel in the PNG (capped to keep the image drawable). */
  pixelRatio: number
}

export interface DrawnPage {
  svg: string
  /** CSS pixel size of the SVG. */
  width: number
  height: number
  goalIds: string[]
}

/** Splits the visible goals into pages; one page when `goalsPerPage` is 0. */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0 || items.length <= perPage) return [items]
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  return pages
}

export async function drawPages(
  data: ProjectTimelineData,
  schedule: TimelineSchedule,
  options: DrawOptions,
): Promise<DrawnPage[]> {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, options.width))
  const pages = paginate(visibleGoals(schedule, options.showCompleted), options.goalsPerPage)
  const drawn: DrawnPage[] = []
  for (const [index, goals] of pages.entries()) {
    // Each page keeps the whole project's schedule (dates, totals) but lays
    // out only its own goals; links to goals on other pages are left out.
    const pageSchedule: TimelineSchedule = { ...schedule, goals }
    const layout = buildChartLayout(pageSchedule, {
      mode: options.zoom,
      availableWidth: width - CHART.labelWidth,
      expandedGoalIds: options.expandTasks
        ? new Set(goals.map((goal) => goal.id))
        : new Set<string>(),
      showCompleted: options.showCompleted,
      labelWidth: CHART.labelWidth,
    })
    const title =
      pages.length > 1
        ? `${data.project.title} (${index + 1}/${pages.length})`
        : data.project.title
    const svg = await renderExportSvg({
      layout,
      schedule: pageSchedule,
      projectTitle: title,
      showDependencies: options.showDependencies,
    })
    drawn.push({ svg, ...exportDimensions(layout), goalIds: goals.map((goal) => goal.id) })
  }
  return drawn
}

export interface Png {
  data: Buffer
  width: number
  height: number
}

export function rasterize(page: DrawnPage, pixelRatio: number): Png {
  const ratio = Math.min(
    pixelRatio,
    exportScale(page.width, page.height),
    MAX_PIXEL_SIDE / Math.max(page.width, page.height),
  )
  const data = new Resvg(page.svg, {
    fitTo: { mode: 'zoom', value: ratio },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Noto Sans JP',
    },
  })
    .render()
    .asPng()
  return { data, width: Math.round(page.width * ratio), height: Math.round(page.height * ratio) }
}
