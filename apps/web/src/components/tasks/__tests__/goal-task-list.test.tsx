// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react'

import { GoalTaskList } from '../goal-task-list'
import type { Task, TaskDependency, TaskStatus } from '@/types/task'

jest.mock('@/hooks/use-tasks-query', () => ({
  useUpdateTask: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

jest.mock('@/components/logs/log-form-dialog', () => ({
  LogFormDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}))

jest.mock('@/components/tasks/task-edit-dialog', () => ({
  TaskEditDialog: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/components/tasks/task-delete-dialog', () => ({
  TaskDeleteDialog: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/components/tasks/task-logs-memo-panel', () => ({
  TaskLogsMemoPanel: () => null,
}))

jest.mock('@/components/tasks/task-dependency-panel', () => ({
  TaskDependencyPanel: ({ taskId }: { taskId: string | null }) =>
    taskId ? <div data-testid="dependency-panel">{taskId}</div> : null,
}))

function dependency(id: string, status: TaskStatus): TaskDependency {
  return {
    id,
    task_id: 'blocked-task',
    depends_on_task_id: `prerequisite-${id}`,
    created_at: '2026-07-20T00:00:00Z',
    depends_on_task: {
      id: `prerequisite-${id}`,
      title: `Prerequisite ${id}`,
      status,
    },
  }
}

function task(overrides: Partial<Task>): Task {
  return {
    id: 'ready-task',
    title: 'Ready task',
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

describe('GoalTaskList', () => {
  const tasks = [
    task({}),
    task({
      id: 'blocked-task',
      title: 'Blocked task',
      dependencies: [
        dependency('completed', 'completed'),
        dependency('pending', 'pending'),
      ],
    }),
  ]

  it('shows ready tasks first and sorts by priority in desktop, mobile, and filtered lists', () => {
    const unorderedTasks = [
      task({ id: 'blocked-low', title: 'Blocked low', priority: 5, dependencies: [dependency('pending', 'pending')] }),
      task({ id: 'ready-low', title: 'Ready low', priority: 5 }),
      task({ id: 'completed', title: 'Completed high', priority: 1, status: 'completed' }),
      task({ id: 'ready-high', title: 'Ready high', priority: 1, status: 'in_progress' }),
      task({ id: 'blocked-high', title: 'Blocked high', priority: 1, dependencies: [dependency('pending', 'pending')] }),
      task({ id: 'ready-high-tie', title: 'Ready high tie', priority: 1, dependencies: [dependency('done', 'completed')] }),
      task({ id: 'cancelled', title: 'Cancelled high', priority: 1, status: 'cancelled' }),
      task({ id: 'ready-default', title: 'Ready default', priority: undefined }),
    ]
    const originalOrder = unorderedTasks.map((task) => task.id)

    render(
      <GoalTaskList
        tasks={unorderedTasks}
        projectId="project"
        goalId="goal"
        logsByTask={{}}
        logsLoading={false}
        logsError={null}
        actualMinutesByTask={{}}
      />,
    )

    // Both responsive layouts render the same ordered task links.
    const expectTaskOrder = (titles: string[]) => {
      expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
        ...titles,
        ...titles,
      ])
    }

    expectTaskOrder([
      'Ready high', 'Ready high tie', 'Ready default', 'Ready low',
      'Blocked high', 'Blocked low', 'Completed high', 'Cancelled high',
    ])
    expect(unorderedTasks.map((task) => task.id)).toEqual(originalOrder)

    fireEvent.click(screen.getByRole('button', { name: 'Ready 4' }))
    expectTaskOrder(['Ready high', 'Ready high tie', 'Ready default', 'Ready low'])

    fireEvent.click(screen.getByRole('button', { name: 'ブロック中 2' }))
    expectTaskOrder(['Blocked high', 'Blocked low'])
  })

  it('filters tasks by decision state and opens dependency details', () => {
    render(
      <GoalTaskList
        tasks={tasks}
        projectId="project"
        goalId="goal"
        logsByTask={{}}
        logsLoading={false}
        logsError={null}
        actualMinutesByTask={{}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Ready 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ブロック中 1' })).toBeInTheDocument()
    expect(screen.getAllByText('Ready task')).not.toHaveLength(0)
    expect(screen.getAllByText('Blocked task')).not.toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'ブロック中 1' }))

    expect(screen.queryByText('Ready task')).not.toBeInTheDocument()
    expect(screen.getAllByText('Blocked task')).not.toHaveLength(0)
    expect(screen.getAllByText('1/2 完了')).not.toHaveLength(0)

    fireEvent.click(screen.getAllByRole('button', { name: /1\/2 完了/ })[0])

    expect(screen.getByTestId('dependency-panel')).toHaveTextContent('blocked-task')
  })
})
