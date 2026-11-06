import { buildChartLayout, CHART, relatedGoalIds } from '../chart-layout'
import { buildSchedule } from '../schedule'
import type { ProjectTimelineData, TimelineGoal } from '../types'

const NOW = new Date('2026-11-06T00:00:00Z')

const goal = (id: string, dependencies: string[] = [], status: TimelineGoal['status'] = 'pending'): TimelineGoal => ({
  id,
  title: id,
  description: null,
  status,
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
      title: `${id} task`,
      description: null,
      status: status === 'completed' ? 'completed' : 'pending',
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

const data = (goals: TimelineGoal[]): ProjectTimelineData => ({
  project: { id: 'p', title: 'P', description: null, weekly_work_hours: 20,
    capacity: { weekly_capacity_hours: 40, meeting_buffer_hours: 5, effective_capacity_hours: 35, effort_percent: 60, weekly_work_hours: 20, configured: true },
    created_at: '', updated_at: '' },
  timeline: { start_date: '', end_date: '', time_unit: 'day' },
  goals,
})

describe('buildChartLayout', () => {
  const schedule = buildSchedule(
    data([goal('done', [], 'completed'), goal('a', ['done']), goal('b', ['a']), goal('c')]),
    { weeklyHours: 20, now: NOW },
  )

  it('stacks goal rows and inserts task rows for expanded goals', () => {
    const layout = buildChartLayout(schedule, {
      mode: 'week',
      availableWidth: 800,
      expandedGoalIds: new Set(['a']),
      showCompleted: true,
    })
    expect(layout.rows.map((row) => row.key)).toEqual(['done', 'a', 'a:a-task', 'b', 'c'])
    expect(layout.goalRows.get('b')!.y).toBe(2 * CHART.goalRowHeight + CHART.taskRowHeight)
    expect(layout.links.map((link) => link.id)).toEqual(['done->a', 'a->b'])
    expect(layout.width).toBeGreaterThanOrEqual(800)
  })

  it('hides finished goals and their links on request', () => {
    const layout = buildChartLayout(schedule, {
      mode: 'week',
      availableWidth: 800,
      expandedGoalIds: new Set(),
      showCompleted: false,
    })
    expect(Array.from(layout.goalRows.keys())).toEqual(['a', 'b', 'c'])
    expect(layout.links.map((link) => link.id)).toEqual(['a->b'])
  })

  it('fits the whole roadmap into the available width', () => {
    const layout = buildChartLayout(schedule, {
      mode: 'fit',
      availableWidth: 900,
      expandedGoalIds: new Set(),
      showCompleted: true,
    })
    expect(Math.abs(layout.width - 900)).toBeLessThanOrEqual(1)
  })
})

describe('relatedGoalIds', () => {
  it('collects the whole upstream and downstream chain but not siblings', () => {
    const schedule = buildSchedule(
      data([goal('root'), goal('mid', ['root']), goal('leaf', ['mid']), goal('sibling', ['root']), goal('alone')]),
      { weeklyHours: 20, now: NOW },
    )
    expect(Array.from(relatedGoalIds(schedule, 'mid')).sort()).toEqual(['leaf', 'mid', 'root'])
  })
})
