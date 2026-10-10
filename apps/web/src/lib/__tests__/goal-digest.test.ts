// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  formatDigestHours,
  getDueState,
  getDueStateLabel,
  getGoalDigest,
} from '../goal-digest'
import type { GoalProgress, TaskProgress } from '@/types/progress'

const task = (status: string, estimateHours: number): TaskProgress => ({
  task_id: `${status}-${estimateHours}`,
  title: status,
  estimate_hours: estimateHours,
  actual_minutes: 0,
  progress_percentage: 0,
  status,
})

const progress = (overrides: Partial<GoalProgress> = {}): GoalProgress => ({
  goal_id: 'goal-1',
  title: 'Goal',
  estimate_hours: 10,
  actual_minutes: 0,
  progress_percentage: 0,
  tasks: [],
  ...overrides,
})

describe('getGoalDigest', () => {
  it('rates completion by tasks, leaving cancelled tasks out', () => {
    const digest = getGoalDigest(
      progress({
        tasks: [
          task('completed', 2),
          task('completed', 1),
          task('in_progress', 3),
          task('pending', 1.5),
          task('cancelled', 4),
        ],
      }),
      10,
    )

    expect(digest.totalTasks).toBe(4)
    expect(digest.completedTasks).toBe(2)
    expect(digest.completionRate).toBe(50)
    expect(digest.remainingEstimateHours).toBe(4.5)
  })

  it('has no completion rate when the goal has no tasks', () => {
    expect(getGoalDigest(progress(), 10).completionRate).toBeNull()
  })

  it('flags logged time beyond the estimate', () => {
    expect(getGoalDigest(progress({ actual_minutes: 660 }), 10).isOverEstimate).toBe(true)
    expect(getGoalDigest(progress({ actual_minutes: 600 }), 10).isOverEstimate).toBe(false)
    expect(getGoalDigest(progress({ actual_minutes: 270 }), 10).actualHours).toBe(4.5)
  })

  it('uses the given estimate over the one cached in progress data', () => {
    const digest = getGoalDigest(progress({ estimate_hours: 10, actual_minutes: 660 }), 12)

    expect(digest.estimateHours).toBe(12)
    expect(digest.isOverEstimate).toBe(false)
  })
})

describe('getDueState', () => {
  const today = '2026-10-10'

  it.each([
    ['2026-10-07T00:00:00+09:00', { kind: 'overdue', days: 3 }, '3日超過'],
    ['2026-10-10T00:00:00+09:00', { kind: 'today', days: 0 }, '今日まで'],
    ['2026-10-17T00:00:00+09:00', { kind: 'soon', days: 7 }, 'あと7日'],
    ['2026-10-18T00:00:00+09:00', { kind: 'later', days: 8 }, 'あと8日'],
  ])('treats %s as %o', (dueDate, expected, label) => {
    const state = getDueState(dueDate, today)

    expect(state).toEqual(expected)
    expect(getDueStateLabel(state!)).toBe(label)
  })

  it('uses the JST calendar day of the deadline', () => {
    // 2026-10-10 15:00 UTC is already 2026-10-11 in JST.
    expect(getDueState('2026-10-10T15:00:00Z', today)).toEqual({ kind: 'soon', days: 1 })
  })

  it('returns null without a valid due date', () => {
    expect(getDueState(null, today)).toBeNull()
    expect(getDueState('not-a-date', today)).toBeNull()
  })
})

describe('formatDigestHours', () => {
  it('rounds to one decimal place without a trailing zero', () => {
    expect(formatDigestHours(10)).toBe('10')
    expect(formatDigestHours(4.5)).toBe('4.5')
    expect(formatDigestHours(1 / 3)).toBe('0.3')
  })
})
