// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  getBlockingGoalDependencies,
  groupGoalsByStatus,
  groupProjectsByStatus,
} from '../status-groups'
import {
  createMockGoal,
  createMockProject,
} from '@/hooks/__tests__/helpers/mock-factories'
import type { Goal, GoalDependency } from '@/types/goal'

const dependsOn = (goalId: string, dependsOnGoalId: string): GoalDependency => ({
  id: `${goalId}->${dependsOnGoalId}`,
  goal_id: goalId,
  depends_on_goal_id: dependsOnGoalId,
  created_at: '2025-01-01T00:00:00Z',
})

const idsByGroup = (groups: { key: string; items: { id: string }[] }[]) =>
  Object.fromEntries(groups.map((group) => [group.key, group.items.map((item) => item.id)]))

describe('groupProjectsByStatus', () => {
  it('orders groups as in progress, pending, then closed', () => {
    const groups = groupProjectsByStatus([
      createMockProject({ id: 'done', status: 'completed' }),
      createMockProject({ id: 'todo', status: 'pending' }),
      createMockProject({ id: 'cancelled', status: 'cancelled' }),
      createMockProject({ id: 'doing', status: 'in_progress' }),
    ])

    expect(groups.map((group) => group.key)).toEqual(['in_progress', 'pending', 'closed'])
    expect(groups.map((group) => group.label)).toEqual(['進行中', '未着手', '完了・キャンセル'])
    expect(idsByGroup(groups)).toEqual({
      in_progress: ['doing'],
      pending: ['todo'],
      closed: ['done', 'cancelled'],
    })
  })

  it('sorts within groups by recent activity', () => {
    const groups = groupProjectsByStatus([
      createMockProject({ id: 'doing-old', status: 'in_progress', updated_at: '2025-01-01T00:00:00Z' }),
      createMockProject({ id: 'doing-new', status: 'in_progress', updated_at: '2025-02-01T00:00:00Z' }),
      createMockProject({ id: 'todo-old', status: 'pending', created_at: '2025-01-01T00:00:00Z' }),
      createMockProject({ id: 'todo-new', status: 'pending', created_at: '2025-02-01T00:00:00Z' }),
      createMockProject({ id: 'done-old', status: 'completed', updated_at: '2025-01-01T00:00:00Z' }),
      createMockProject({ id: 'cancelled-new', status: 'cancelled', updated_at: '2025-02-01T00:00:00Z' }),
    ])

    expect(idsByGroup(groups)).toEqual({
      in_progress: ['doing-new', 'doing-old'],
      pending: ['todo-new', 'todo-old'],
      closed: ['cancelled-new', 'done-old'],
    })
  })

  it('keeps empty groups and does not mutate the input', () => {
    const projects = [
      createMockProject({ id: 'b', status: 'pending', created_at: '2025-01-01T00:00:00Z' }),
      createMockProject({ id: 'a', status: 'pending', created_at: '2025-02-01T00:00:00Z' }),
    ]

    const groups = groupProjectsByStatus(projects)

    expect(idsByGroup(groups)).toEqual({ in_progress: [], pending: ['a', 'b'], closed: [] })
    expect(projects.map((project) => project.id)).toEqual(['b', 'a'])
  })
})

describe('groupGoalsByStatus', () => {
  it('sorts in-progress goals by nearest due date, undated last', () => {
    const groups = groupGoalsByStatus([
      createMockGoal({ id: 'undated', status: 'in_progress', due_date: null }),
      createMockGoal({ id: 'later', status: 'in_progress', due_date: '2025-03-01T00:00:00Z' }),
      createMockGoal({ id: 'sooner', status: 'in_progress', due_date: '2025-02-01T00:00:00Z' }),
    ])

    expect(idsByGroup(groups).in_progress).toEqual(['sooner', 'later', 'undated'])
  })

  it('puts pending goals that can start now before blocked ones', () => {
    const goals: Goal[] = [
      createMockGoal({ id: 'base', status: 'in_progress' }),
      createMockGoal({
        id: 'blocked',
        status: 'pending',
        due_date: '2025-01-10T00:00:00Z',
        dependencies: [dependsOn('blocked', 'base')],
      }),
      createMockGoal({ id: 'ready-late', status: 'pending', due_date: '2025-03-01T00:00:00Z' }),
      createMockGoal({ id: 'ready-early', status: 'pending', due_date: '2025-02-01T00:00:00Z' }),
    ]

    expect(idsByGroup(groupGoalsByStatus(goals)).pending).toEqual([
      'ready-early',
      'ready-late',
      'blocked',
    ])
  })
})

describe('getBlockingGoalDependencies', () => {
  it('counts dependencies on goals that are not completed yet', () => {
    const done = createMockGoal({ id: 'done', status: 'completed' })
    const doing = createMockGoal({ id: 'doing', status: 'in_progress' })
    const goal = createMockGoal({
      id: 'goal',
      dependencies: [dependsOn('goal', 'done'), dependsOn('goal', 'doing')],
    })

    expect(
      getBlockingGoalDependencies(goal, [done, doing, goal]).map(
        (dependency) => dependency.depends_on_goal_id,
      ),
    ).toEqual(['doing'])
  })

  it('ignores dependencies on goals outside the list', () => {
    const goal = createMockGoal({
      id: 'goal',
      dependencies: [dependsOn('goal', 'other-project-goal')],
    })

    expect(getBlockingGoalDependencies(goal, [goal])).toEqual([])
  })
})
