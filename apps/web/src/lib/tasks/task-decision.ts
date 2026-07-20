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
