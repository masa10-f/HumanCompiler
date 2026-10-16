// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { getTaskDecisionSummary } from '../task-decision'
import type { Task, TaskDependency, TaskStatus } from '@/types/task'

function dependency(status: TaskStatus): TaskDependency {
  return {
    id: `dependency-${status}`,
    task_id: 'task',
    depends_on_task_id: `prerequisite-${status}`,
    created_at: '2026-07-20T00:00:00Z',
    depends_on_task: {
      id: `prerequisite-${status}`,
      title: status,
      status,
    },
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task',
    title: 'Task',
    description: null,
    estimate_hours: 1,
    due_date: null,
    status: 'pending',
    priority: 3,
    goal_id: 'goal',
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
    dependencies: [],
    ...overrides,
  }
}

describe('getTaskDecisionSummary', () => {
  it('marks an actionable task without dependencies as ready', () => {
    expect(getTaskDecisionSummary(task()).state).toBe('ready')
  })

  it('marks an actionable task with all dependencies completed as ready', () => {
    const summary = getTaskDecisionSummary(
      task({ dependencies: [dependency('completed')] }),
    )

    expect(summary.state).toBe('ready')
    expect(summary.completedDependencies).toBe(1)
  })

  it('reports dependency progress and blockers', () => {
    const summary = getTaskDecisionSummary(
      task({ dependencies: [dependency('completed'), dependency('in_progress')] }),
    )

    expect(summary.state).toBe('blocked')
    expect(summary.completedDependencies).toBe(1)
    expect(summary.dependencyTotal).toBe(2)
    expect(summary.blockingDependencies).toHaveLength(1)
  })

  it('keeps cancelled dependencies blocked and flags them for review', () => {
    const summary = getTaskDecisionSummary(
      task({ dependencies: [dependency('cancelled')] }),
    )

    expect(summary.state).toBe('blocked')
    expect(summary.hasCancelledDependency).toBe(true)
  })

  it('preserves terminal task states', () => {
    expect(getTaskDecisionSummary(task({ status: 'completed' })).state).toBe(
      'completed',
    )
    expect(getTaskDecisionSummary(task({ status: 'cancelled' })).state).toBe(
      'cancelled',
    )
  })
})
