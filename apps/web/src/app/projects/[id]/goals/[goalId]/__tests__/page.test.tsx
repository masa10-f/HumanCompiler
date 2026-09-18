// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react'

import GoalDetailPage from '../page'
import { SortBy, SortOrder, type SortOptions } from '@/types/sort'
import type { Task } from '@/types/task'

const mockUseAllTasksByGoal = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: 'project', goalId: 'goal' }),
}))

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user' }, loading: false }),
}))

jest.mock('@/hooks/use-tasks-query', () => ({
  useAllTasksByGoal: (...args: unknown[]) => mockUseAllTasksByGoal(...args),
  useUpdateTask: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))

jest.mock('@/hooks/use-goals-query', () => ({
  useGoal: () => ({ data: { id: 'goal', title: 'Goal', estimate_hours: 3 } }),
}))

jest.mock('@/hooks/use-project-query', () => ({
  useProject: () => ({ data: { id: 'project', title: 'Project' } }),
}))

jest.mock('@/hooks/use-notes', () => ({ useGoalNote: () => ({}) }))
jest.mock('@/hooks/use-logs-query', () => ({ useBatchLogsQuery: () => ({ data: {} }) }))
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({}) }))
jest.mock('@/lib/api', () => ({ progressApi: { getGoal: jest.fn() } }))

jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }))
jest.mock('@/components/notes/context-note-panel', () => ({ ContextNotePanel: () => null }))
jest.mock('@/components/ai/goal-task-assistant-dialog', () => ({ GoalTaskAssistantDialog: () => null }))
jest.mock('@/components/tasks/task-form-dialog', () => ({ TaskFormDialog: () => null }))
jest.mock('@/components/tasks/task-edit-dialog', () => ({ TaskEditDialog: () => null }))
jest.mock('@/components/tasks/task-delete-dialog', () => ({ TaskDeleteDialog: () => null }))
jest.mock('@/components/tasks/task-logs-memo-panel', () => ({ TaskLogsMemoPanel: () => null }))
jest.mock('@/components/tasks/task-dependency-panel', () => ({ TaskDependencyPanel: () => null }))
jest.mock('@/components/logs/log-form-dialog', () => ({ LogFormDialog: () => null }))

function task(id: string, priority: number, blocked = false): Task {
  return {
    id,
    title: id,
    description: null,
    estimate_hours: 1,
    due_date: null,
    status: 'pending',
    priority,
    goal_id: 'goal',
    created_at: '2026-09-17T00:00:00Z',
    updated_at: '2026-09-17T00:00:00Z',
    dependencies: blocked ? [{
      id: 'dependency',
      task_id: id,
      depends_on_task_id: 'prerequisite',
      created_at: '2026-09-17T00:00:00Z',
      depends_on_task: { id: 'prerequisite', title: 'Prerequisite', status: 'pending' },
    }] : [],
  }
}

// Deliberately differ from the default so that re-sorting API responses fails the test.
const apiTasks = [task('Ready low', 5), task('Blocked', 1, true), task('Ready high', 1)]

function expectTaskOrder(titles: string[]) {
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
    ...titles,
    ...titles,
  ])
}

describe('GoalDetailPage task sorting', () => {
  beforeEach(() => {
    mockUseAllTasksByGoal.mockImplementation((_goalId: string, sort?: SortOptions) => ({
      data: sort?.sortOrder === SortOrder.DESC ? [...apiTasks].reverse() : apiTasks,
    }))
  })

  it.each([
    ['ステータス', SortBy.STATUS],
    ['優先度', SortBy.PRIORITY],
    ['タスク名', SortBy.TITLE],
    ['作成日', SortBy.CREATED_AT],
    ['更新日', SortBy.UPDATED_AT],
  ])('honors %s ascending/descending and allows returning to the default', async (label, sortBy) => {
    render(<GoalDetailPage />)

    expectTaskOrder(['Ready high', 'Ready low', 'Blocked'])
    expect(mockUseAllTasksByGoal).toHaveBeenLastCalledWith('goal', undefined)
    expect(screen.queryByRole('button', { name: '並び順を降順に変更' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ready・優先度順' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))

    expect(mockUseAllTasksByGoal).toHaveBeenLastCalledWith('goal', {
      sortBy,
      sortOrder: SortOrder.ASC,
    })
    expectTaskOrder(['Ready low', 'Blocked', 'Ready high'])

    fireEvent.click(screen.getByRole('button', { name: '並び順を降順に変更' }))
    expect(mockUseAllTasksByGoal).toHaveBeenLastCalledWith('goal', {
      sortBy,
      sortOrder: SortOrder.DESC,
    })
    expectTaskOrder(['Ready high', 'Blocked', 'Ready low'])

    fireEvent.click(screen.getByRole('button', { name: '並び順を昇順に変更' }))
    expectTaskOrder(['Ready low', 'Blocked', 'Ready high'])

    fireEvent.click(screen.getByRole('button', { name: 'Ready 2' }))
    expectTaskOrder(['Ready low', 'Ready high'])
    fireEvent.click(screen.getByRole('button', { name: 'すべて 3' }))

    fireEvent.click(screen.getByRole('button', { name: label }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ready・優先度順' }))
    expect(mockUseAllTasksByGoal).toHaveBeenLastCalledWith('goal', undefined)
    expectTaskOrder(['Ready high', 'Ready low', 'Blocked'])
    expect(screen.queryByRole('button', { name: '並び順を降順に変更' })).not.toBeInTheDocument()
  })
})
