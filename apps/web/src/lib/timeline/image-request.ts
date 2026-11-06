// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Request validation and PNG rasterization for the roadmap image route
 * (`app/api/internal/timeline-image/route.ts`). Server only: it loads resvg's
 * native binary and the Japanese font files.
 */

import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { z } from 'zod'
import { exportScale } from '@/components/timeline/timeline-export'
import { MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH, renderTimelineSvg } from './render-image'
import type { ProjectTimelineData } from './types'

/** Longest image side in pixels; larger images are scaled down to it. */
const MAX_PIXEL_SIDE = 8000

// next.config.js ships these files with the route (outputFileTracingIncludes).
// Written out in full so file tracing picks only these two of the nine weights.
const FONT_FILES = [
  path.join(process.cwd(), 'node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf'),
  path.join(process.cwd(), 'node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf'),
]
const FONT_FAMILY = 'Noto Sans JP'

const id = z.string().max(64)
const isoDate = z.string().max(64)
const text = z.string().max(10_000)
const status = z.enum(['pending', 'in_progress', 'completed', 'cancelled'])

const taskSchema = z.object({
  id,
  // Declared by TimelineTask but not sent by the API; the renderer never reads it.
  goal_id: id.optional(),
  title: text,
  description: text.nullable(),
  status,
  estimate_hours: z.number(),
  due_date: isoDate.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
  progress_percentage: z.number(),
  status_color: z.string().max(32),
  actual_hours: z.number(),
  logs_count: z.number(),
  first_logged_at: isoDate.nullish(),
  last_logged_at: isoDate.nullish(),
})

const goalSchema = z.object({
  id,
  title: text,
  description: text.nullable(),
  status,
  estimate_hours: z.number(),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  due_date: isoDate.nullable(),
  dependencies: z.array(id),
  created_at: isoDate,
  updated_at: isoDate,
  tasks: z.array(taskSchema),
  actual_start_date: isoDate.nullish(),
  actual_end_date: isoDate.nullish(),
})

/** The body of `GET /api/timeline/projects/{id}`, as the API sends it. */
const timelineDataSchema = z.object({
  project: z.object({
    id,
    title: text,
    description: text.nullable(),
    weekly_work_hours: z.number(),
    created_at: isoDate,
    updated_at: isoDate,
  }),
  timeline: z.object({
    start_date: isoDate,
    end_date: isoDate,
    time_unit: z.string().max(16),
  }),
  goals: z.array(goalSchema).max(2000),
})

export const timelineImageRequestSchema = z.object({
  data: timelineDataSchema,
  options: z
    .object({
      weekly_hours: z.number().min(0.5).max(168),
      now: z.iso.datetime({ offset: true }).optional(),
      scale: z.enum(['fit', 'day', 'week', 'month']).default('fit'),
      width: z.number().int().min(MIN_IMAGE_WIDTH).max(MAX_IMAGE_WIDTH).optional(),
      show_completed: z.boolean().default(true),
      show_dependencies: z.boolean().default(true),
      expand_tasks: z.boolean().default(false),
      pixel_ratio: z.number().min(1).max(2).default(2),
    })
    .strict(),
})

export type TimelineImageRequest = z.infer<typeof timelineImageRequestSchema>

export interface TimelineImageResult {
  mime_type: 'image/png'
  /** Base64-encoded PNG. */
  data: string
  width: number
  height: number
  summary: {
    now: string
    weekly_hours: number
    progress: number
    estimate_hours: number
    done_hours: number
    remaining_hours: number
    actual_hours: number
    projected_end: string | null
    goal_count: number
    late_goal_count: number
    has_cycle: boolean
  }
}

export async function renderTimelineImage({
  data,
  options,
}: TimelineImageRequest): Promise<TimelineImageResult> {
  const rendered = await renderTimelineSvg(data as ProjectTimelineData, {
    weeklyHours: options.weekly_hours,
    now: options.now ? new Date(options.now) : undefined,
    scale: options.scale,
    width: options.width,
    showCompleted: options.show_completed,
    showDependencies: options.show_dependencies,
    expandTasks: options.expand_tasks,
  })
  const ratio = Math.min(
    options.pixel_ratio,
    exportScale(rendered.width, rendered.height),
    MAX_PIXEL_SIDE / Math.max(rendered.width, rendered.height),
  )
  const png = new Resvg(rendered.svg, {
    fitTo: { mode: 'zoom', value: ratio },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  })
    .render()
    .asPng()

  const { schedule } = rendered
  return {
    mime_type: 'image/png',
    data: png.toString('base64'),
    width: Math.round(rendered.width * ratio),
    height: Math.round(rendered.height * ratio),
    summary: {
      now: schedule.now.toISOString(),
      weekly_hours: schedule.weeklyHours,
      progress: schedule.totals.progress,
      estimate_hours: schedule.totals.estimateHours,
      done_hours: schedule.totals.doneHours,
      remaining_hours: schedule.totals.remainingHours,
      actual_hours: schedule.totals.actualHours,
      projected_end: schedule.projectedEnd?.toISOString() ?? null,
      goal_count: schedule.goals.length,
      late_goal_count: schedule.lateGoalCount,
      has_cycle: schedule.hasCycle,
    },
  }
}
