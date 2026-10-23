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
    // Reassigned to goal-b in the dialog.
    task('a3', 4, { goal_client_id: 'goal-b' }),
    // Reassigned to an existing goal.
    task('a4', 5, { goal_id: 'existing-goal' }),
  ])
  const goalB = goal('goal-b', [task('b1', 1)])
  const draft: GoalTaskDraftPayload = {
    assistant_message: '',
    goals: [goalA, goalB],
    tasks: [task('loose', 0.5, { goal_client_id: 'goal-a' })],
    dependencies: [],
    warnings: [],
  }
  const allSelected = new Set(['a1', 'a2', 'a3', 'a4', 'b1', 'loose'])

  it('sums the selected tasks that end up in each goal', () => {
    expect(getDraftGoalEstimateHours(draft, goalA, allSelected)).toBe(5.5)
    expect(getDraftGoalEstimateHours(draft, goalB, allSelected)).toBe(5)
  })

  it('leaves out tasks that are not selected', () => {
    expect(getDraftGoalEstimateHours(draft, goalA, new Set(['a1']))).toBe(2)
    expect(getDraftGoalEstimateHours(draft, goalB, new Set())).toBe(0)
  })
})
