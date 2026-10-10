// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { getJSTDateString, toJSTDateInputValue } from '@/lib/date-utils'
import type { GoalProgress } from '@/types/progress'

export interface GoalDigest {
  /** Tasks that still count toward the goal (cancelled ones are excluded). */
  totalTasks: number
  completedTasks: number
  /** Share of counted tasks that are completed (0-100), or null without tasks. */
  completionRate: number | null
  actualHours: number
  estimateHours: number
  /** Estimate left on tasks that are neither completed nor cancelled. */
  remainingEstimateHours: number
  isOverEstimate: boolean
}

/**
 * @param estimateHours - The goal's current estimate. Taken from the goal
 *   itself so an edit shows up before project progress is refetched.
 */
export function getGoalDigest(progress: GoalProgress, estimateHours: number): GoalDigest {
  const countedTasks = progress.tasks.filter((task) => task.status !== 'cancelled')
  const completedTasks = countedTasks.filter((task) => task.status === 'completed').length
  const remainingEstimateHours = countedTasks
    .filter((task) => task.status !== 'completed')
    .reduce((sum, task) => sum + (Number(task.estimate_hours) || 0), 0)
  const actualHours = (Number(progress.actual_minutes) || 0) / 60
  const estimate = Number(estimateHours) || 0

  return {
    totalTasks: countedTasks.length,
    completedTasks,
    completionRate:
      countedTasks.length > 0
        ? Math.round((completedTasks / countedTasks.length) * 100)
        : null,
    actualHours,
    estimateHours: estimate,
    remainingEstimateHours,
    isOverEstimate: estimate > 0 && actualHours > estimate,
  }
}

export type DueState =
  | { kind: 'overdue'; days: number }
  | { kind: 'today'; days: 0 }
  | { kind: 'soon'; days: number }
  | { kind: 'later'; days: number }

const DAY_MS = 24 * 60 * 60 * 1000
const SOON_THRESHOLD_DAYS = 7

function calendarDayIndex(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number) as [number, number, number]
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/**
 * Days between today and the due date, both taken as JST calendar days.
 * Returns null when there is no (valid) due date.
 */
export function getDueState(
  dueDate: string | null,
  today: string = getJSTDateString(),
): DueState | null {
  const dueDay = toJSTDateInputValue(dueDate)
  if (!dueDay) return null

  const days = calendarDayIndex(dueDay) - calendarDayIndex(today)
  if (days < 0) return { kind: 'overdue', days: -days }
  if (days === 0) return { kind: 'today', days: 0 }
  if (days <= SOON_THRESHOLD_DAYS) return { kind: 'soon', days }
  return { kind: 'later', days }
}

export function getDueStateLabel(state: DueState): string {
  switch (state.kind) {
    case 'overdue':
      return `${state.days}日超過`
    case 'today':
      return '今日まで'
    case 'soon':
    case 'later':
      return `あと${state.days}日`
  }
}

/** Hours rounded to one decimal place, without a trailing ".0". */
export function formatDigestHours(hours: number): string {
  return String(Math.round(hours * 10) / 10)
}
