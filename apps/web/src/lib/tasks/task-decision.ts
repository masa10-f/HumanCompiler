// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type { Task, TaskDependency } from '@/types/task'

export type TaskDecisionState = 'ready' | 'blocked' | 'completed' | 'cancelled'

export interface TaskDecisionSummary {
  state: TaskDecisionState
  dependencyTotal: number
  completedDependencies: number
  blockingDependencies: TaskDependency[]
  hasCancelledDependency: boolean
}

export function getTaskDecisionSummary(task: Task): TaskDecisionSummary {
  const dependencies = task.dependencies ?? []
  const completedDependencies = dependencies.filter(
    (dependency) => dependency.depends_on_task?.status === 'completed',
  ).length
  const blockingDependencies = dependencies.filter(
    (dependency) => dependency.depends_on_task?.status !== 'completed',
  )

  let state: TaskDecisionState
  if (task.status === 'completed') {
    state = 'completed'
  } else if (task.status === 'cancelled') {
    state = 'cancelled'
  } else if (blockingDependencies.length > 0) {
    state = 'blocked'
  } else {
    state = 'ready'
  }

  return {
    state,
    dependencyTotal: dependencies.length,
    completedDependencies,
    blockingDependencies,
    hasCancelledDependency: blockingDependencies.some(
      (dependency) => dependency.depends_on_task?.status === 'cancelled',
    ),
  }
}
