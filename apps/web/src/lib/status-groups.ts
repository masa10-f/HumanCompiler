// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type { Goal } from '@/types/goal'
import type { Project } from '@/types/project'

export type WorkStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

/**
 * Display groups ordered by how actionable they are: what is being worked on
 * now, what comes next, then everything that is already closed.
 */
export type StatusGroupKey = 'in_progress' | 'pending' | 'closed'

export interface StatusGroup<T> {
  key: StatusGroupKey
  label: string
  items: T[]
}

type Comparator<T> = (left: T, right: T) => number

const STATUS_GROUP_DEFINITIONS: {
  key: StatusGroupKey
  label: string
  statuses: WorkStatus[]
}[] = [
  { key: 'in_progress', label: '進行中', statuses: ['in_progress'] },
  { key: 'pending', label: '未着手', statuses: ['pending'] },
  { key: 'closed', label: '完了・キャンセル', statuses: ['completed', 'cancelled'] },
]

function toTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function byDateDesc<T>(pick: (item: T) => string | null | undefined): Comparator<T> {
  return (left, right) => (toTime(pick(right)) ?? 0) - (toTime(pick(left)) ?? 0)
}

function byDateAsc<T>(pick: (item: T) => string | null | undefined): Comparator<T> {
  return (left, right) => (toTime(pick(left)) ?? 0) - (toTime(pick(right)) ?? 0)
}

/** Earliest date first; missing or malformed dates go last. */
function byOptionalDateAsc<T>(
  pick: (item: T) => string | null | undefined,
): Comparator<T> {
  return (left, right) => {
    const leftTime = toTime(pick(left))
    const rightTime = toTime(pick(right))
    if (leftTime === null && rightTime === null) return 0
    if (leftTime === null) return 1
    if (rightTime === null) return -1
    return leftTime - rightTime
  }
}

function chain<T>(...comparators: Comparator<T>[]): Comparator<T> {
  return (left, right) => {
    for (const compare of comparators) {
      const result = compare(left, right)
      if (result !== 0) return result
    }
    return 0
  }
}

/**
 * Split items into the in-progress / pending / closed groups, sorting each
 * group with its own comparator. Empty groups are kept so callers can decide
 * whether to render them.
 */
export function groupByWorkStatus<T extends { status: WorkStatus }>(
  items: T[],
  comparators: Record<StatusGroupKey, Comparator<T>>,
): StatusGroup<T>[] {
  return STATUS_GROUP_DEFINITIONS.map(({ key, label, statuses }) => ({
    key,
    label,
    items: items
      .filter((item) => statuses.includes(item.status))
      .sort(comparators[key]),
  }))
}

const byUpdatedDesc = byDateDesc<{ updated_at: string }>((item) => item.updated_at)

const PROJECT_GROUP_COMPARATORS: Record<StatusGroupKey, Comparator<Project>> = {
  // Recently touched projects are the ones the user is most likely returning to.
  in_progress: byUpdatedDesc,
  pending: byDateDesc((project) => project.created_at),
  // Most recently finished first.
  closed: byUpdatedDesc,
}

export function groupProjectsByStatus(projects: Project[]): StatusGroup<Project>[] {
  return groupByWorkStatus(projects, PROJECT_GROUP_COMPARATORS)
}

/**
 * Dependencies of `goal` that point at a goal in `allGoals` which is not
 * completed yet. Dependencies on goals outside the list (for example in
 * another project) are ignored because their status is unknown here.
 */
export function getBlockingGoalDependencies(goal: Goal, allGoals: Goal[]) {
  const statusById = new Map(allGoals.map((item) => [item.id, item.status]))
  return (goal.dependencies ?? []).filter((dependency) => {
    const status = statusById.get(dependency.depends_on_goal_id)
    return status !== undefined && status !== 'completed'
  })
}

export function groupGoalsByStatus(goals: Goal[]): StatusGroup<Goal>[] {
  const blockedIds = new Set(
    goals
      .filter((goal) => getBlockingGoalDependencies(goal, goals).length > 0)
      .map((goal) => goal.id),
  )
  const byDueDate = byOptionalDateAsc<Goal>((goal) => goal.due_date)

  return groupByWorkStatus(goals, {
    in_progress: chain(byDueDate, byUpdatedDesc),
    pending: chain(
      // Goals that can be started right away come before ones still waiting.
      (left, right) => Number(blockedIds.has(left.id)) - Number(blockedIds.has(right.id)),
      byDueDate,
      byDateAsc((goal) => goal.created_at),
    ),
    closed: byUpdatedDesc,
  })
}
