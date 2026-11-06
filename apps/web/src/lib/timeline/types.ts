// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type {
  ProjectTimelineData,
  TimelineGoal,
  TimelineTask,
} from '@/types/timeline'

export type { ProjectTimelineData, TimelineGoal, TimelineTask }

export type WorkStatus = TimelineGoal['status']

/**
 * Where a goal sits in its lifecycle on the roadmap.
 * - done: finished, drawn from recorded work only
 * - active: started (in progress or has logged work)
 * - planned: not started yet, drawn as a projection
 */
export type GoalPhase = 'done' | 'active' | 'planned'

export interface Span {
  start: Date
  end: Date
}

export interface ScheduledTask {
  id: string
  title: string
  status: WorkStatus
  estimateHours: number
  doneHours: number
  remainingHours: number
  /** 0-1 */
  progress: number
  dueDate: Date | null
  /** Period in which work was logged (first log → last log). */
  actual: Span | null
  /** Projected window for the remaining work. */
  planned: Span | null
  /** Completion date (done) or projected completion date (open). */
  finish: Date | null
  isLate: boolean
  source: TimelineTask
}

export interface ScheduledGoal {
  id: string
  title: string
  status: WorkStatus
  phase: GoalPhase
  estimateHours: number
  doneHours: number
  remainingHours: number
  /** 0-1 */
  progress: number
  /** Recorded work: first log → last log (done) or → now (active). */
  actual: Span | null
  /** Projected window for the remaining work (sequential, capacity based). */
  planned: Span | null
  /** Overall horizontal extent of the goal on the chart. */
  start: Date
  end: Date
  /** Completion date (done) or projected completion date (open). */
  finish: Date
  dueDate: Date | null
  /** Whole days the finish date is past the due date (0 when on time). */
  delayDays: number
  /** Predecessors shown on the chart. */
  dependencyIds: string[]
  /** Successors shown on the chart. */
  dependentIds: string[]
  /** Predecessors that are not finished yet. */
  waitingOnIds: string[]
  tasks: ScheduledTask[]
  source: TimelineGoal
}

export interface ScheduledLink {
  id: string
  fromId: string
  toId: string
  /**
   * The successor starts before the predecessor finishes (started early,
   * or part of a dependency cycle).
   */
  conflict: boolean
}

export interface TimelineSchedule {
  /** Ordered for display: finished goals first, then by projected start. */
  goals: ScheduledGoal[]
  links: ScheduledLink[]
  now: Date
  /** Earliest start and latest end over all goals and `now`. */
  extent: Span
  /** When all remaining work is projected to finish (null when none left). */
  projectedEnd: Date | null
  totals: {
    estimateHours: number
    doneHours: number
    remainingHours: number
    /** 0-1 */
    progress: number
  }
  weeklyHours: number
  hasCycle: boolean
  hiddenCancelledCount: number
  lateGoalCount: number
}

export type TimeScale = 'day' | 'week' | 'month' | 'fit'
