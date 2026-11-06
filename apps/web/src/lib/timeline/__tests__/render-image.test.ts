/**
 * @jest-environment node
 */
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { MAX_PNG_BYTES, renderTimelineImage, timelineImageRequestSchema } from '../image-request'
import { renderTimelineSvg } from '../render-image'
import type { ProjectTimelineData, TimelineGoal } from '../types'

const NOW = new Date('2026-11-06T03:00:00Z')

const goal = (id: string, title: string, dependencies: string[] = []): TimelineGoal => ({
  id,
  title,
  description: null,
  status: 'pending',
  estimate_hours: 10,
  start_date: null,
  end_date: null,
  due_date: null,
  dependencies,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  tasks: [
    {
      id: `${id}-task`,
      goal_id: id,
      title: `${title}のタスク`,
      description: null,
      status: 'pending',
      estimate_hours: 10,
      due_date: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-05T00:00:00Z',
      progress_percentage: 0,
      status_color: '',
      actual_hours: 0,
      logs_count: 0,
    },
  ],
})

const DATA: ProjectTimelineData = {
  project: {
    id: 'p',
    title: 'ロードマップ & <テスト>',
    description: null,
    weekly_work_hours: 20,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  timeline: { start_date: '2026-10-01T00:00:00Z', end_date: '2026-11-06T00:00:00Z', time_unit: 'day' },
  goals: [goal('a', '設計'), goal('b', '実装', ['a'])],
}

describe('renderTimelineSvg', () => {
  it('draws the export document for the given options', async () => {
    const rendered = await renderTimelineSvg(DATA, { weeklyHours: 10, now: NOW, width: 1200 })

    expect(rendered.svg.startsWith('<?xml')).toBe(true)
    expect(rendered.width).toBe(1200)
    expect(rendered.svg).toContain(`width="${rendered.width}"`)
    expect(rendered.svg).toContain(`height="${rendered.height}"`)
    // Titles are escaped, not injected into the markup.
    expect(rendered.svg).toContain('ロードマップ &amp; &lt;テスト&gt;')
    expect(rendered.svg).toContain('設計')
    expect(rendered.svg).toContain('週10h で計画')
    expect(rendered.schedule.weeklyHours).toBe(10)
    expect(rendered.schedule.goals.map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('adds task rows only when tasks are expanded', async () => {
    const collapsed = await renderTimelineSvg(DATA, { weeklyHours: 10, now: NOW })
    const expanded = await renderTimelineSvg(DATA, { weeklyHours: 10, now: NOW, expandTasks: true })

    expect(collapsed.svg).not.toContain('設計のタスク')
    expect(expanded.svg).toContain('設計のタスク')
    expect(expanded.height).toBeGreaterThan(collapsed.height)
  })

  it('clamps the image width', async () => {
    const narrow = await renderTimelineSvg(DATA, { weeklyHours: 10, now: NOW, width: 10 })
    expect(narrow.width).toBe(640)
  })
})

describe('timelineImageRequestSchema', () => {
  it('fills option defaults', () => {
    const parsed = timelineImageRequestSchema.parse({ data: DATA, options: { weekly_hours: 20 } })
    expect(parsed.options).toEqual({
      weekly_hours: 20,
      scale: 'fit',
      show_completed: true,
      show_dependencies: true,
      expand_tasks: false,
      pixel_ratio: 2,
    })
  })

  it('rejects unknown options and invalid data', () => {
    expect(
      timelineImageRequestSchema.safeParse({ data: DATA, options: { weekly_hours: 20, extra: 1 } }).success,
    ).toBe(false)
    expect(
      timelineImageRequestSchema.safeParse({ data: { ...DATA, goals: 'x' }, options: { weekly_hours: 20 } }).success,
    ).toBe(false)
  })

  it('accepts the payload exactly as the API sends it', () => {
    // GET /api/timeline/projects/{id}: tasks carry no goal_id, the project has
    // a status, and timestamps may lack an offset.
    const apiPayload = {
      project: { ...DATA.project, status: 'pending', weekly_work_hours: 20.0 },
      timeline: { ...DATA.timeline, end_date: '2026-11-06T23:59:59.999999' },
      goals: DATA.goals.map((g) => ({
        ...g,
        created_at: '2026-10-01T00:00:00+00:00',
        tasks: g.tasks.map(({ goal_id: _goalId, ...task }) => task),
      })),
    }
    expect(
      timelineImageRequestSchema.safeParse({ data: apiPayload, options: { weekly_hours: 20 } }).success,
    ).toBe(true)
  })
})

describe('renderTimelineImage', () => {
  it('returns a PNG at the requested pixel ratio with the schedule summary', async () => {
    const request = timelineImageRequestSchema.parse({
      data: DATA,
      options: { weekly_hours: 10, now: NOW.toISOString(), width: 1000, pixel_ratio: 1 },
    })

    const result = await renderTimelineImage(request)

    const png = Buffer.from(result.data, 'base64')
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(result.width)
    expect(png.readUInt32BE(20)).toBe(result.height)
    expect(result.width).toBe(1000)
    expect(result.summary).toMatchObject({
      now: NOW.toISOString(),
      weekly_hours: 10,
      remaining_hours: 20,
      goal_count: 2,
      has_cycle: false,
    })
  })

  it('lowers the pixel ratio until a large roadmap fits the byte limit', async () => {
    // 80 goals with 8 tasks each, at day zoom: about 7.5 MB at 2x.
    const goals = Array.from({ length: 80 }, (_, i) => ({
      ...goal(`g${i}`, `ゴール${i} 長いタイトルのテスト`, i ? [`g${i - 1}`] : []),
      tasks: Array.from({ length: 8 }, (_, j) => ({ ...goal(`g${i}`, '').tasks[0]!, id: `t${i}-${j}` })),
    }))
    const request = timelineImageRequestSchema.parse({
      data: { ...DATA, goals },
      options: { weekly_hours: 20, now: NOW.toISOString(), scale: 'day', expand_tasks: true },
    })

    const result = await renderTimelineImage(request)

    const png = Buffer.from(result.data, 'base64')
    expect(png.length).toBeLessThanOrEqual(MAX_PNG_BYTES)
    expect(png.readUInt32BE(16)).toBe(result.width)
  }, 60_000)
})
