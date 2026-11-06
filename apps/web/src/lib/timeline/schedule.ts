// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Capacity-based roadmap scheduling.
 *
 * The project is worked on by one person with a fixed weekly capacity, so the
 * remaining work of the open goals is laid out one after another starting
 * today (never in parallel). The order respects goal dependencies and, among
 * goals that are ready, prefers work already in progress, then the earliest
 * (dependency-propagated) deadline, then the original order.
 *
 * Past work is drawn from the recorded work logs, so finished goals show when
 * they actually happened rather than a guess.
 */

import { parseOptionalDate } from './utils'
import type {
  GoalPhase,
  ProjectTimelineData,
  ScheduledGoal,
  ScheduledLink,
  ScheduledTask,
  Span,
  TimelineGoal,
  TimelineSchedule,
  TimelineTask,
} from './types'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Share of the estimate assumed to remain when a task overran its estimate. */
const OVERRUN_REMAINING_RATIO = 0.1

export interface ScheduleOptions {
  weeklyHours: number
  now?: Date
}

interface TaskMetrics {
  estimate: number
  done: number
  remaining: number
}

function taskMetrics(task: TimelineTask): TaskMetrics {
  const estimate = Math.max(0, Number(task.estimate_hours) || 0)
  if (task.status === 'cancelled') return { estimate: 0, done: 0, remaining: 0 }
  if (task.status === 'completed') return { estimate, done: estimate, remaining: 0 }

  const actual = Math.max(0, Number(task.actual_hours) || 0)
  const done = Math.min(actual, estimate)
  let remaining = estimate - done
  if (remaining <= 0 && estimate > 0) {
    remaining = estimate * OVERRUN_REMAINING_RATIO
  }
  return { estimate, done, remaining }
}

const ratio = (done: number, remaining: number) =>
  done + remaining > 0 ? done / (done + remaining) : 0

const maxDate = (...dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>(
    (latest, date) => (date && (!latest || date > latest) ? date : latest),
    null,
  )

const minDate = (...dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>(
    (earliest, date) =>
      date && (!earliest || date < earliest) ? date : earliest,
    null,
  )

/**
 * Due dates are stored as 00:00 JST of the due day; the deadline is the end of
 * that day.
 */
export function deadlineOf(dueDate: Date | null): Date | null {
  return dueDate ? new Date(dueDate.getTime() + DAY_MS) : null
}

function delayInDays(finish: Date | null, dueDate: Date | null): number {
  const deadline = deadlineOf(dueDate)
  if (!finish || !deadline || finish <= deadline) return 0
  return Math.ceil((finish.getTime() - deadline.getTime()) / DAY_MS)
}

interface GoalDraft {
  goal: TimelineGoal
  index: number
  metrics: TaskMetrics
  phase: GoalPhase
  actualStart: Date | null
  actualEnd: Date | null
  dueDate: Date | null
  deps: string[]
}

export function buildSchedule(
  data: ProjectTimelineData,
  options: ScheduleOptions,
): TimelineSchedule {
  const now = options.now ?? new Date()
  const weeklyHours = Math.max(0.5, Number(options.weeklyHours) || 0)
  const msPerHour = (7 * DAY_MS) / weeklyHours
  const durationMs = (hours: number) => hours * msPerHour

  const visibleGoals = data.goals.filter((goal) => goal.status !== 'cancelled')
  const visibleIds = new Set(visibleGoals.map((goal) => goal.id))

  const drafts = new Map<string, GoalDraft>()
  visibleGoals.forEach((goal, index) => {
    const tasks = goal.tasks.filter((task) => task.status !== 'cancelled')
    let metrics: TaskMetrics
    // Fall back to the goal's own estimate only when it has no tasks at all;
    // a goal whose tasks were all cancelled has no planned work left.
    if (goal.tasks.length > 0) {
      metrics = tasks.map(taskMetrics).reduce(
        (sum, item) => ({
          estimate: sum.estimate + item.estimate,
          done: sum.done + item.done,
          remaining: sum.remaining + item.remaining,
        }),
        { estimate: 0, done: 0, remaining: 0 },
      )
    } else {
      const estimate = Math.max(0, Number(goal.estimate_hours) || 0)
      metrics = { estimate, done: 0, remaining: estimate }
    }
    if (goal.status === 'completed') {
      metrics = { estimate: metrics.estimate, done: metrics.estimate, remaining: 0 }
    }

    const phase: GoalPhase =
      goal.status === 'completed'
        ? 'done'
        : goal.status === 'in_progress' || metrics.done > 0
          ? 'active'
          : 'planned'

    drafts.set(goal.id, {
      goal,
      index,
      metrics,
      phase,
      actualStart: parseOptionalDate(goal.actual_start_date ?? null),
      actualEnd: parseOptionalDate(goal.actual_end_date ?? null),
      dueDate: parseOptionalDate(goal.due_date),
      deps: Array.from(
        new Set(goal.dependencies.filter((id) => id !== goal.id && visibleIds.has(id))),
      ),
    })
  })

  const successors = new Map<string, string[]>()
  drafts.forEach((draft) => {
    draft.deps.forEach((depId) => {
      const list = successors.get(depId) ?? []
      list.push(draft.goal.id)
      successors.set(depId, list)
    })
  })

  const openIds = visibleGoals
    .map((goal) => goal.id)
    .filter((id) => drafts.get(id)!.phase !== 'done')
  const openSet = new Set(openIds)
  const openDepsOf = (id: string) =>
    drafts.get(id)!.deps.filter((depId) => openSet.has(depId))

  // Topological order over open goals (Kahn) to propagate deadlines backwards.
  const inDegree = new Map(openIds.map((id) => [id, openDepsOf(id).length]))
  const queue = openIds.filter((id) => inDegree.get(id) === 0)
  const topoOrder: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    topoOrder.push(id)
    for (const next of successors.get(id) ?? []) {
      if (!openSet.has(next)) continue
      const degree = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, degree)
      if (degree === 0) queue.push(next)
    }
  }
  let hasCycle = topoOrder.length !== openIds.length

  // A goal must finish early enough for its successors to meet their deadlines.
  const effectiveDeadline = new Map<string, number>()
  for (const id of [...topoOrder].reverse()) {
    const draft = drafts.get(id)!
    let deadline = deadlineOf(draft.dueDate)?.getTime() ?? Infinity
    for (const next of successors.get(id) ?? []) {
      if (!openSet.has(next)) continue
      const nextDeadline = effectiveDeadline.get(next) ?? Infinity
      const nextDuration = durationMs(drafts.get(next)!.metrics.remaining)
      deadline = Math.min(deadline, nextDeadline - nextDuration)
    }
    effectiveDeadline.set(id, deadline)
  }

  const priority = (a: string, b: string) => {
    const da = drafts.get(a)!
    const db = drafts.get(b)!
    if (da.phase !== db.phase) return da.phase === 'active' ? -1 : 1
    const ea = effectiveDeadline.get(a) ?? deadlineOf(da.dueDate)?.getTime() ?? Infinity
    const eb = effectiveDeadline.get(b) ?? deadlineOf(db.dueDate)?.getTime() ?? Infinity
    if (ea !== eb) return ea < eb ? -1 : 1
    return da.index - db.index
  }

  // Sequential list scheduling from today.
  const planned = new Map<string, Span>()
  const scheduleOrder: string[] = []
  const pending = new Set(openIds)
  let cursor = now.getTime()
  while (pending.size > 0) {
    let ready = Array.from(pending).filter((id) =>
      openDepsOf(id).every((depId) => planned.has(depId)),
    )
    if (ready.length === 0) {
      hasCycle = true
      ready = Array.from(pending)
    }
    ready.sort(priority)
    let id = ready[0]!
    // Work in progress goes first, unless a not-yet-started goal would miss
    // a deadline it can still meet by going first. It may only jump ahead if
    // that keeps every ready in-progress goal that is on time on time (never
    // trade one miss for another).
    if (drafts.get(id)!.phase === 'active') {
      const activeQueue = ready.filter((candidate) => drafts.get(candidate)!.phase === 'active')
      const firstActiveDuration = durationMs(drafts.get(id)!.metrics.remaining)
      const keepsActiveOnTime = (shift: number) => {
        let finish = cursor
        for (const activeId of activeQueue) {
          finish += durationMs(drafts.get(activeId)!.metrics.remaining)
          const activeDeadline = effectiveDeadline.get(activeId) ?? Infinity
          if (finish <= activeDeadline && finish + shift > activeDeadline) return false
        }
        return true
      }
      const rescue = ready
        .filter((candidate) => drafts.get(candidate)!.phase === 'planned')
        .find((candidate) => {
          const deadline = effectiveDeadline.get(candidate) ?? Infinity
          const duration = durationMs(drafts.get(candidate)!.metrics.remaining)
          return (
            Number.isFinite(deadline) &&
            cursor + duration <= deadline &&
            cursor + firstActiveDuration + duration > deadline &&
            keepsActiveOnTime(duration)
          )
        })
      if (rescue) id = rescue
    }
    const start = cursor
    const end = start + durationMs(drafts.get(id)!.metrics.remaining)
    planned.set(id, { start: new Date(start), end: new Date(end) })
    scheduleOrder.push(id)
    pending.delete(id)
    cursor = end
  }

  const scheduled = new Map<string, ScheduledGoal>()
  drafts.forEach((draft, id) => {
    const { goal, metrics, phase } = draft
    const plan = planned.get(id) ?? null

    let actual: Span | null = null
    let finish: Date
    let finishIsEstimated = false
    if (phase === 'done') {
      // Without work logs the completion date is only known approximately.
      finishIsEstimated = !draft.actualEnd && !draft.actualStart
      const updatedAt = parseOptionalDate(goal.updated_at)
      const completedAt =
        minDate(maxDate(draft.actualEnd, draft.actualStart) ?? updatedAt ?? now, now) ?? now
      const start =
        draft.actualStart && draft.actualStart <= completedAt
          ? draft.actualStart
          : new Date(completedAt.getTime() - durationMs(metrics.estimate))
      actual = { start, end: completedAt }
      finish = completedAt
    } else {
      // Only started goals show recorded work; logs that belong solely to
      // cancelled tasks don't make a goal look in progress.
      if (phase === 'active' && draft.actualStart && draft.actualStart < now) {
        actual = { start: draft.actualStart, end: now }
      }
      finish = plan?.end ?? now
    }

    const start = minDate(actual?.start, plan?.start) ?? now
    const end = maxDate(actual?.end, plan?.end) ?? now

    scheduled.set(id, {
      id,
      title: goal.title,
      status: goal.status,
      phase,
      estimateHours: metrics.estimate,
      doneHours: metrics.done,
      remainingHours: metrics.remaining,
      // Effort actually spent, so hours logged on cancelled tasks count too.
      actualHours: goal.tasks.reduce(
        (sum, task) => sum + Math.max(0, Number(task.actual_hours) || 0),
        0,
      ),
      progress: phase === 'done' ? 1 : ratio(metrics.done, metrics.remaining),
      actual,
      planned: plan,
      start,
      end,
      finish,
      finishIsEstimated,
      dueDate: draft.dueDate,
      // An estimated completion date can't tell whether the goal was late.
      delayDays: finishIsEstimated ? 0 : delayInDays(finish, draft.dueDate),
      dependencyIds: draft.deps,
      dependentIds: successors.get(id) ?? [],
      waitingOnIds: openDepsOf(id),
      tasks: scheduleTasks(goal, plan, phase, durationMs, now),
      source: goal,
    })
  })

  const doneGoals = Array.from(scheduled.values())
    .filter((goal) => goal.phase === 'done')
    .sort((a, b) => a.finish.getTime() - b.finish.getTime() || a.start.getTime() - b.start.getTime())
  const goals = [...doneGoals, ...scheduleOrder.map((id) => scheduled.get(id)!)]

  const links: ScheduledLink[] = []
  goals.forEach((goal) => {
    goal.dependencyIds.forEach((depId) => {
      const from = scheduled.get(depId)
      if (!from) return
      links.push({
        id: `${depId}->${goal.id}`,
        fromId: depId,
        toId: goal.id,
        // Only the projected plan can violate a dependency (which happens
        // with cycles); work already logged early is history, not a conflict.
        conflict:
          goal.planned !== null &&
          goal.planned.start.getTime() < from.finish.getTime() - 60_000,
      })
    })
  })

  const totals = goals.reduce(
    (sum, goal) => ({
      estimateHours: sum.estimateHours + goal.estimateHours,
      doneHours: sum.doneHours + goal.doneHours,
      remainingHours: sum.remainingHours + goal.remainingHours,
      actualHours: sum.actualHours + goal.actualHours,
    }),
    { estimateHours: 0, doneHours: 0, remainingHours: 0, actualHours: 0 },
  )

  const extentStart = minDate(now, ...goals.map((goal) => goal.start)) ?? now
  const extentEnd = maxDate(now, ...goals.map((goal) => goal.end)) ?? now

  return {
    goals,
    links,
    now,
    extent: { start: extentStart, end: extentEnd },
    projectedEnd: scheduleOrder.length > 0 ? new Date(cursor) : null,
    totals: { ...totals, progress: ratio(totals.doneHours, totals.remainingHours) },
    weeklyHours,
    hasCycle,
    hiddenCancelledCount: data.goals.length - visibleGoals.length,
    // Deadline risk is about open work; finished goals are history.
    lateGoalCount: goals.filter((goal) => goal.phase !== 'done' && goal.delayDays > 0).length,
  }
}

const TASK_STATUS_ORDER: Record<TimelineTask['status'], number> = {
  completed: 0,
  in_progress: 1,
  pending: 2,
  cancelled: 3,
}

function scheduleTasks(
  goal: TimelineGoal,
  plan: Span | null,
  phase: GoalPhase,
  durationMs: (hours: number) => number,
  now: Date,
): ScheduledTask[] {
  const ordered = goal.tasks
    .map((task, index) => ({ task, index, metrics: taskMetrics(task) }))
    .sort((a, b) => {
      const statusDiff = TASK_STATUS_ORDER[a.task.status] - TASK_STATUS_ORDER[b.task.status]
      if (statusDiff !== 0) return statusDiff
      const dueA = parseOptionalDate(a.task.due_date)?.getTime() ?? Infinity
      const dueB = parseOptionalDate(b.task.due_date)?.getTime() ?? Infinity
      if (dueA !== dueB) return dueA < dueB ? -1 : 1
      return a.index - b.index
    })

  let cursor = plan?.start.getTime() ?? now.getTime()
  return ordered.map(({ task, metrics }) => {
    const firstLog = parseOptionalDate(task.first_logged_at ?? null)
    const lastLog = parseOptionalDate(task.last_logged_at ?? null)
    const isFinished =
      phase === 'done' || task.status === 'completed' || task.status === 'cancelled'

    let actual: Span | null = null
    if (firstLog) {
      const actualEnd = isFinished ? (maxDate(lastLog, firstLog) ?? firstLog) : now
      actual = { start: firstLog, end: maxDate(actualEnd, firstLog)! }
    }

    let planned: Span | null = null
    if (!isFinished && metrics.remaining > 0 && plan) {
      const end = cursor + durationMs(metrics.remaining)
      planned = { start: new Date(cursor), end: new Date(end) }
      cursor = end
    }

    const finish = isFinished
      ? task.status === 'cancelled'
        ? null
        : (lastLog ?? parseOptionalDate(task.updated_at))
      : (planned?.end ?? null)
    const dueDate = parseOptionalDate(task.due_date)
    const progress =
      task.status === 'completed' || phase === 'done'
        ? 1
        : ratio(metrics.done, metrics.remaining)

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      estimateHours: metrics.estimate || Math.max(0, Number(task.estimate_hours) || 0),
      doneHours: metrics.done,
      remainingHours: isFinished ? 0 : metrics.remaining,
      actualHours: Math.max(0, Number(task.actual_hours) || 0),
      progress,
      dueDate,
      actual,
      planned,
      finish,
      // Without logs a finished task's date comes from its last update, so it
      // can't show whether the task was late (same rule as for goals).
      isLate:
        task.status !== 'cancelled' &&
        !(isFinished && !lastLog) &&
        delayInDays(finish, dueDate) > 0,
      source: task,
    }
  })
}
