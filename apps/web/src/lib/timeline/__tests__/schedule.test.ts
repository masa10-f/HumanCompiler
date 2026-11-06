import { buildSchedule, DAY_MS } from '../schedule'
import type { ProjectTimelineData, TimelineGoal, TimelineTask } from '../types'

const NOW = new Date('2026-11-06T00:00:00Z')

let taskSeq = 0
function task(overrides: Partial<TimelineTask> = {}): TimelineTask {
  taskSeq += 1
  return {
    id: `task-${taskSeq}`,
    goal_id: 'goal',
    title: `Task ${taskSeq}`,
    description: null,
    status: 'pending',
    estimate_hours: 10,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    progress_percentage: 0,
    status_color: '#6b7280',
    actual_hours: 0,
    logs_count: 0,
    ...overrides,
  }
}

function goal(id: string, overrides: Partial<TimelineGoal> = {}): TimelineGoal {
  return {
    id,
    title: `Goal ${id}`,
    description: null,
    status: 'pending',
    estimate_hours: 10,
    start_date: null,
    end_date: null,
    due_date: null,
    dependencies: [],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    tasks: [task()],
    ...overrides,
  }
}

function project(goals: TimelineGoal[]): ProjectTimelineData {
  return {
    project: {
      id: 'project',
      title: 'Project',
      description: null,
      weekly_work_hours: 20,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    timeline: { start_date: '2026-09-01', end_date: '2026-12-31', time_unit: 'day' },
    goals,
  }
}

// 20 h/week → 10 h of work takes 3.5 days.
const HALF_WEEK = 3.5 * DAY_MS

describe('buildSchedule', () => {
  it('lays out independent open goals one after another from today', () => {
    const schedule = buildSchedule(project([goal('a'), goal('b'), goal('c')]), {
      weeklyHours: 20,
      now: NOW,
    })

    const starts = schedule.goals.map((item) => item.planned!.start.getTime())
    expect(starts).toEqual([
      NOW.getTime(),
      NOW.getTime() + HALF_WEEK,
      NOW.getTime() + 2 * HALF_WEEK,
    ])
    expect(schedule.projectedEnd?.getTime()).toBe(NOW.getTime() + 3 * HALF_WEEK)
  })

  it('schedules predecessors before their dependents regardless of input order', () => {
    const schedule = buildSchedule(
      project([goal('child', { dependencies: ['parent'] }), goal('parent')]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals.map((item) => item.id)).toEqual(['parent', 'child'])
    const [parent, child] = schedule.goals
    expect(child!.planned!.start.getTime()).toBe(parent!.planned!.end.getTime())
    expect(schedule.links).toEqual([
      { id: 'parent->child', fromId: 'parent', toId: 'child', conflict: false },
    ])
    expect(child!.waitingOnIds).toEqual(['parent'])
  })

  it('continues work in progress first, then the earliest deadline', () => {
    const schedule = buildSchedule(
      project([
        goal('later', { due_date: '2026-12-20T00:00:00+09:00' }),
        goal('sooner', { due_date: '2026-11-20T00:00:00+09:00' }),
        goal('active', {
          status: 'in_progress',
          tasks: [task({ status: 'in_progress', actual_hours: 4 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals.map((item) => item.id)).toEqual(['active', 'sooner', 'later'])
    const active = schedule.goals[0]!
    expect(active.remainingHours).toBe(6)
    expect(active.progress).toBeCloseTo(0.4)
  })

  it('lets a planned goal jump ahead of in-progress work when it would otherwise miss its deadline', () => {
    const schedule = buildSchedule(
      project([
        goal('long-active', {
          status: 'in_progress',
          due_date: '2027-05-01T00:00:00+09:00',
          tasks: [task({ status: 'in_progress', estimate_hours: 90, actual_hours: 10 })],
        }),
        goal('urgent', {
          due_date: '2026-11-12T00:00:00+09:00',
          tasks: [task({ estimate_hours: 10 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals.map((item) => item.id)).toEqual(['urgent', 'long-active'])
    expect(schedule.lateGoalCount).toBe(0)
  })

  it('does not let a planned goal jump ahead when that would make the in-progress goal late', () => {
    // 20h/week: 10h takes 3.5 days, 2h takes 0.7 days.
    const schedule = buildSchedule(
      project([
        goal('active', {
          status: 'in_progress',
          // Deadline is the end of 11/9 JST = 11/9 15:00Z, 3.6 days after NOW.
          due_date: '2026-11-09T00:00:00+09:00',
          tasks: [task({ status: 'in_progress', estimate_hours: 12, actual_hours: 2 })],
        }),
        goal('short', {
          // Deadline is the end of 11/6 JST = 11/6 15:00Z, 0.6 days after NOW.
          due_date: '2026-11-06T00:00:00+09:00',
          tasks: [task({ estimate_hours: 1 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    // `short` (0.35 days) could be rescued, but `active` would then end 3.85
    // days out and miss its own deadline, so in-progress work stays first.
    expect(schedule.goals.map((item) => item.id)).toEqual(['active', 'short'])
  })

  it('protects every in-progress goal, not only the first, before letting a goal jump ahead', () => {
    // 20h/week: 1h = 0.35 days. NOW is 11/6 00:00Z; a due date's deadline is
    // the end of that JST day (15:00Z), so day N JST ends at (N - 6) + 0.625 days.
    const schedule = buildSchedule(
      project([
        goal('first', {
          status: 'in_progress',
          // 4h → ends at 1.4 days; deadline 11/12 = 6.625 days (plenty of slack)
          due_date: '2026-11-12T00:00:00+09:00',
          tasks: [task({ status: 'in_progress', estimate_hours: 5, actual_hours: 1 })],
        }),
        goal('second', {
          status: 'in_progress',
          // 17h → ends at 7.35 days after `first`; deadline 11/13 = 7.625 days
          due_date: '2026-11-13T00:00:00+09:00',
          tasks: [task({ status: 'in_progress', estimate_hours: 18, actual_hours: 1 })],
        }),
        goal('urgent', {
          // 3h = 1.05 days; deadline 11/7 = 1.625 days: met only if it goes first
          due_date: '2026-11-07T00:00:00+09:00',
          tasks: [task({ estimate_hours: 3 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    // `urgent` going first keeps `first` on time but would push `second`
    // (8.4 days) past its deadline, so in-progress work keeps its place.
    expect(schedule.goals.map((item) => item.id)).toEqual(['first', 'second', 'urgent'])
    expect(schedule.goals.find((item) => item.id === 'second')!.delayDays).toBe(0)
  })

  it('keeps in-progress work first when the planned goal is late either way', () => {
    const schedule = buildSchedule(
      project([
        goal('active', {
          status: 'in_progress',
          tasks: [task({ status: 'in_progress', estimate_hours: 20, actual_hours: 10 })],
        }),
        goal('hopeless', {
          due_date: '2026-11-06T00:00:00+09:00',
          tasks: [task({ estimate_hours: 40 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals.map((item) => item.id)).toEqual(['active', 'hopeless'])
  })

  it('pulls a goal forward when a dependent has an earlier deadline', () => {
    const schedule = buildSchedule(
      project([
        goal('other', { due_date: '2026-11-30T00:00:00+09:00' }),
        goal('base'),
        goal('urgent', { dependencies: ['base'], due_date: '2026-11-15T00:00:00+09:00' }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals.map((item) => item.id)).toEqual(['base', 'urgent', 'other'])
  })

  it('places finished goals at the time work was logged', () => {
    const schedule = buildSchedule(
      project([
        goal('done', {
          status: 'completed',
          actual_start_date: '2026-10-01T09:00:00Z',
          actual_end_date: '2026-10-10T18:00:00Z',
          tasks: [task({ status: 'completed', actual_hours: 8 })],
        }),
        goal('next', { dependencies: ['done'] }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const [done, next] = schedule.goals
    expect(done!.phase).toBe('done')
    expect(done!.actual).toEqual({
      start: new Date('2026-10-01T09:00:00Z'),
      end: new Date('2026-10-10T18:00:00Z'),
    })
    expect(done!.planned).toBeNull()
    expect(next!.planned!.start).toEqual(NOW)
    expect(next!.waitingOnIds).toEqual([])
  })

  it('flags completion dates of finished goals without work logs as estimated', () => {
    const schedule = buildSchedule(
      project([
        goal('logged', {
          status: 'completed',
          actual_start_date: '2026-10-01T00:00:00Z',
          actual_end_date: '2026-10-03T00:00:00Z',
        }),
        goal('unlogged', { status: 'completed', updated_at: '2026-10-20T00:00:00Z' }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const byId = new Map(schedule.goals.map((item) => [item.id, item]))
    expect(byId.get('logged')!.finishIsEstimated).toBe(false)
    expect(byId.get('unlogged')!.finishIsEstimated).toBe(true)
    expect(byId.get('unlogged')!.finish).toEqual(new Date('2026-10-20T00:00:00Z'))
  })

  it('shows recorded work and the remaining projection for active goals', () => {
    const schedule = buildSchedule(
      project([
        goal('first', { status: 'in_progress', tasks: [task({ status: 'in_progress' })] }),
        goal('second', {
          status: 'in_progress',
          actual_start_date: '2026-10-20T00:00:00Z',
          tasks: [task({ status: 'in_progress', actual_hours: 5 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const second = schedule.goals.find((item) => item.id === 'second')!
    expect(second.actual).toEqual({ start: new Date('2026-10-20T00:00:00Z'), end: NOW })
    expect(second.start).toEqual(new Date('2026-10-20T00:00:00Z'))
    expect(second.planned!.start.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('does not show recorded work for a goal whose only logs are on cancelled tasks', () => {
    const schedule = buildSchedule(
      project([
        goal('g', {
          actual_start_date: '2026-10-01T00:00:00Z',
          actual_end_date: '2026-10-02T00:00:00Z',
          tasks: [
            task({ status: 'cancelled', actual_hours: 3 }),
            task({ status: 'pending', estimate_hours: 10 }),
          ],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const [scheduled] = schedule.goals
    expect(scheduled!.phase).toBe('planned')
    expect(scheduled!.actual).toBeNull()
    expect(scheduled!.start).toEqual(NOW)
  })

  it('reports how late a goal is against its deadline', () => {
    const schedule = buildSchedule(
      project([
        goal('big', {
          due_date: '2026-11-07T00:00:00+09:00',
          tasks: [task({ estimate_hours: 40 })],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    // 40h at 20h/week = 14 days → finishes 11/20 09:00 JST, deadline is end of 11/7 JST.
    expect(schedule.goals[0]!.delayDays).toBe(13)
    expect(schedule.lateGoalCount).toBe(1)
  })

  it('does not mark finished tasks late when their date is only estimated', () => {
    const schedule = buildSchedule(
      project([
        goal('g', {
          tasks: [
            task({
              id: 'edited',
              status: 'completed',
              due_date: '2026-10-01T00:00:00+09:00',
              updated_at: '2026-11-05T00:00:00Z',
            }),
            task({
              id: 'logged-late',
              status: 'completed',
              due_date: '2026-10-01T00:00:00+09:00',
              first_logged_at: '2026-10-05T00:00:00Z',
              last_logged_at: '2026-10-06T00:00:00Z',
            }),
          ],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const byId = new Map(schedule.goals[0]!.tasks.map((item) => [item.id, item]))
    expect(byId.get('edited')!.isLate).toBe(false)
    expect(byId.get('logged-late')!.isLate).toBe(true)
  })

  it('counts only open goals as a deadline risk', () => {
    const schedule = buildSchedule(
      project([
        goal('finished-late', {
          status: 'completed',
          due_date: '2026-10-01T00:00:00+09:00',
          actual_start_date: '2026-10-01T00:00:00Z',
          actual_end_date: '2026-10-10T00:00:00Z',
        }),
        goal('edited-later', {
          status: 'completed',
          due_date: '2026-10-01T00:00:00+09:00',
          updated_at: '2026-11-05T00:00:00Z',
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const byId = new Map(schedule.goals.map((item) => [item.id, item]))
    expect(byId.get('finished-late')!.delayDays).toBeGreaterThan(0)
    expect(byId.get('edited-later')!.delayDays).toBe(0)
    expect(schedule.lateGoalCount).toBe(0)
  })

  it('treats completed tasks as fully done and excludes cancelled work', () => {
    const schedule = buildSchedule(
      project([
        goal('mixed', {
          tasks: [
            task({ status: 'completed', estimate_hours: 4, actual_hours: 1 }),
            task({ status: 'cancelled', estimate_hours: 50 }),
            task({ status: 'pending', estimate_hours: 6 }),
          ],
        }),
        goal('dropped', { status: 'cancelled' }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals).toHaveLength(1)
    expect(schedule.hiddenCancelledCount).toBe(1)
    const mixed = schedule.goals[0]!
    expect(mixed.estimateHours).toBe(10)
    expect(mixed.doneHours).toBe(4)
    expect(mixed.remainingHours).toBe(6)
  })

  it('reports logged hours separately from estimate-based progress', () => {
    const schedule = buildSchedule(
      project([
        goal('g', {
          tasks: [
            task({ status: 'completed', estimate_hours: 10, actual_hours: 1 }),
            task({ status: 'in_progress', estimate_hours: 10, actual_hours: 15 }),
          ],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const [scheduled] = schedule.goals
    expect(scheduled!.doneHours).toBe(20)
    expect(scheduled!.actualHours).toBe(16)
    expect(scheduled!.tasks.map((item) => item.actualHours)).toEqual([1, 15])
    expect(schedule.totals.actualHours).toBe(16)
  })

  it('plans no work for a goal whose tasks were all cancelled', () => {
    const schedule = buildSchedule(
      project([
        goal('all-cancelled', {
          estimate_hours: 12,
          tasks: [task({ status: 'cancelled', estimate_hours: 12 })],
        }),
        goal('no-tasks', { estimate_hours: 6, tasks: [] }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const byId = new Map(schedule.goals.map((item) => [item.id, item]))
    expect(byId.get('all-cancelled')!.remainingHours).toBe(0)
    expect(byId.get('all-cancelled')!.estimateHours).toBe(0)
    // A goal without any tasks still uses its own estimate.
    expect(byId.get('no-tasks')!.remainingHours).toBe(6)
  })

  it('keeps a little work remaining for open tasks that overran their estimate', () => {
    const schedule = buildSchedule(
      project([goal('over', { tasks: [task({ status: 'in_progress', estimate_hours: 10, actual_hours: 15 })] })]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.goals[0]!.remainingHours).toBeCloseTo(1)
  })

  it('does not flag links where the dependent already logged work early', () => {
    const schedule = buildSchedule(
      project([
        goal('base', { status: 'in_progress', tasks: [task({ status: 'in_progress' })] }),
        goal('early', {
          dependencies: ['base'],
          status: 'in_progress',
          actual_start_date: '2026-10-20T00:00:00Z',
          tasks: [task({ status: 'in_progress', actual_hours: 2 })],
        }),
        goal('done-a', {
          status: 'completed',
          actual_start_date: '2026-09-01T00:00:00Z',
          actual_end_date: '2026-09-20T00:00:00Z',
        }),
        goal('done-b', {
          status: 'completed',
          dependencies: ['done-a'],
          actual_start_date: '2026-09-10T00:00:00Z',
          actual_end_date: '2026-09-25T00:00:00Z',
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.hasCycle).toBe(false)
    expect(schedule.links.filter((link) => link.conflict)).toEqual([])
  })

  it('still schedules every goal when dependencies form a cycle', () => {
    const schedule = buildSchedule(
      project([
        goal('a', { dependencies: ['b'] }),
        goal('b', { dependencies: ['a'] }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    expect(schedule.hasCycle).toBe(true)
    expect(schedule.goals).toHaveLength(2)
    expect(schedule.links.some((link) => link.conflict)).toBe(true)
  })

  it('schedules tasks inside the goal window in status order', () => {
    const schedule = buildSchedule(
      project([
        goal('g', {
          tasks: [
            task({ id: 'p', status: 'pending', estimate_hours: 10 }),
            task({ id: 'ip', status: 'in_progress', estimate_hours: 10 }),
            task({ id: 'c', status: 'completed', estimate_hours: 10, last_logged_at: '2026-11-01T00:00:00Z' }),
          ],
        }),
      ]),
      { weeklyHours: 20, now: NOW },
    )

    const tasks = schedule.goals[0]!.tasks
    expect(tasks.map((item) => item.id)).toEqual(['c', 'ip', 'p'])
    expect(tasks[0]!.planned).toBeNull()
    expect(tasks[0]!.finish).toEqual(new Date('2026-11-01T00:00:00Z'))
    expect(tasks[1]!.planned!.start).toEqual(NOW)
    expect(tasks[2]!.planned!.start.getTime()).toBe(NOW.getTime() + HALF_WEEK)
  })
})
