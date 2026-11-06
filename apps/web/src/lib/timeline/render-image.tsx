// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Renders the roadmap export image without a browser.
 *
 * Runs the same schedule, layout and export document as the timeline page's
 * PNG/SVG export, so the API can hand agents the same picture over MCP
 * (see `app/api/internal/timeline-image/route.ts`).
 */

import { exportDimensions, renderExportSvg } from '@/components/timeline/timeline-export'
import { buildChartLayout, CHART } from './chart-layout'
import { buildSchedule } from './schedule'
import type { ProjectTimelineData, TimelineSchedule, TimeScale } from './types'

/** Image width used by the fit zoom level when none is given. */
export const DEFAULT_IMAGE_WIDTH = 1400
export const MIN_IMAGE_WIDTH = 640
export const MAX_IMAGE_WIDTH = 4000

export interface TimelineImageOptions {
  /** Weekly capacity used to project the remaining work. */
  weeklyHours: number
  /** Reference time for "today" (defaults to the current time). */
  now?: Date
  /** Zoom level; `fit` fits the whole roadmap into `width`. */
  scale?: TimeScale
  /** Total image width for the fit zoom level, and the minimum otherwise. */
  width?: number
  showCompleted?: boolean
  showDependencies?: boolean
  /** Show the task rows under every goal. */
  expandTasks?: boolean
}

export interface RenderedTimeline {
  svg: string
  width: number
  height: number
  schedule: TimelineSchedule
}

export async function renderTimelineSvg(
  data: ProjectTimelineData,
  options: TimelineImageOptions,
): Promise<RenderedTimeline> {
  const schedule = buildSchedule(data, {
    weeklyHours: options.weeklyHours,
    now: options.now ?? new Date(),
  })
  const width = Math.min(
    MAX_IMAGE_WIDTH,
    Math.max(MIN_IMAGE_WIDTH, options.width ?? DEFAULT_IMAGE_WIDTH),
  )
  const layout = buildChartLayout(schedule, {
    mode: options.scale ?? 'fit',
    availableWidth: width - CHART.labelWidth,
    expandedGoalIds: options.expandTasks
      ? new Set(data.goals.map((goal) => goal.id))
      : new Set<string>(),
    showCompleted: options.showCompleted ?? true,
    labelWidth: CHART.labelWidth,
  })
  const svg = await renderExportSvg({
    layout,
    schedule,
    projectTitle: data.project.title,
    showDependencies: options.showDependencies ?? true,
  })
  return { svg, ...exportDimensions(layout), schedule }
}
