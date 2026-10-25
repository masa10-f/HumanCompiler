// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { getDraftGoalEstimateHours } from '@/lib/draft-goal-estimate'
import type { DraftGoal, DraftTask, GoalTaskDraftPayload } from '@/types/ai-drafts'

const task = (clientId: string, estimate: number, overrides: Partial<DraftTask> = {}): DraftTask => ({
  client_id: clientId,
  title: clientId,
  estimate_hours: estimate,
  work_type: 'light_work',
  priority: 3,
  confidence: 0.7,
  ...overrides,
})

const goal = (clientId: string, tasks: DraftTask[]): DraftGoal => ({
  client_id: clientId,
  title: clientId,
  confidence: 0.7,
  tasks,
})

describe('getDraftGoalEstimateHours', () => {
  const goalA = goal('goal-a', [
    task('a1', 2),
    task('a2', 3),
    // Reassigned to goal-b, which is listed later, in the dialog.
    task('a3', 4, { goal_client_id: 'goal-b' }),
    // Reassigned to an existing goal.
    task('a4', 5, { goal_id: 'existing-goal' }),
    // Reassigned to goal-c, which is not selected, so it stays in goal-a.
    task('a5', 0.25, { goal_client_id: 'goal-c' }),
  ])
  const goalB = goal('goal-b', [task('b1', 1)])
  const goalC = goal('goal-c', [])
  const draft: GoalTaskDraftPayload = {
    assistant_message: '',
    goals: [goalA, goalB, goalC],
    tasks: [task('loose', 0.5, { goal_client_id: 'goal-a' })],
    dependencies: [],
    warnings: [],
  }
  const selectedGoals = new Set(['goal-a', 'goal-b'])
  const allTasks = new Set(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'loose'])

  it('sums the selected tasks that end up in each goal', () => {
    expect(getDraftGoalEstimateHours(draft, goalA, selectedGoals, allTasks)).toBe(5.75)
    expect(getDraftGoalEstimateHours(draft, goalB, selectedGoals, allTasks)).toBe(5)
    expect(getDraftGoalEstimateHours(draft, goalC, selectedGoals, allTasks)).toBe(0)
  })

  it('leaves out tasks that are not selected', () => {
    expect(getDraftGoalEstimateHours(draft, goalA, selectedGoals, new Set(['a1']))).toBe(2)
    expect(getDraftGoalEstimateHours(draft, goalB, selectedGoals, new Set())).toBe(0)
  })
})
