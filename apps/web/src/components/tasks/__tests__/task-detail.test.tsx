// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, within } from '@testing-library/react'

import { TaskDetail } from '../task-detail'
import type { Task, TaskDependencyContext, TaskDependencyContextTask } from '@/types/task'

const task: Task = {
  id: 'task-1',
  title: 'Write the report',
  note_excerpt: 'Summarise Q3',
  estimate_hours: 3,
  due_date: '2026-12-01T00:00:00+09:00',
  status: 'pending',
  work_type: 'focused_work',
  priority: 2,
  goal_id: 'goal-1',
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  dependencies: [],
}

function related(id: string, status: TaskDependencyContextTask['status']) {
  return {
    id,
    title: `Task ${id}`,
    status,
    project_id: 'project-1',
    project_title: 'Project',
    goal_id: 'goal-2',
    goal_title: 'Other goal',
    is_ready: status !== 'completed',
    is_blocked: false,
  }
}

let currentTask: Task | undefined = task
let context: TaskDependencyContext = { prerequisites: [], dependents: [] }
const mockUpdateNote = jest.fn()
const mockFlush = jest.fn()

jest.mock('@/hooks/use-tasks-query', () => ({
  useTask: () => ({ data: currentTask, isLoading: false, refetch: jest.fn() }),
  useTaskDependencyContext: () => ({ data: context, isLoading: false }),
}))
jest.mock('@/hooks/use-goals-query', () => ({
  useGoal: () => ({ data: { id: 'goal-1', project_id: 'project-1' } }),
}))
jest.mock('@/hooks/use-logs-query', () => ({
  useTaskActualMinutes: () => ({ totalMinutes: 75, totalHours: 1.25, logs: [] }),
}))
jest.mock('@/hooks/use-notes', () => ({
  useTaskNote: () => ({
    note: { content: '<p>Summarise Q3</p>', updated_at: '2026-07-23T00:00:00Z' },
    loading: false,
    saving: false,
    conflict: false,
    updateNote: mockUpdateNote,
    reloadLatest: jest.fn(),
    overwrite: jest.fn(),
    flush: mockFlush,
  }),
}))
jest.mock('@/components/tasks/copy-task-note-button', () => ({
  CopyTaskNoteButton: ({
    taskId,
    beforeCopy,
  }: {
    taskId: string
    beforeCopy?: () => Promise<void>
  }) => (
    <button type="button" onClick={() => beforeCopy?.()}>
      copy:{taskId}
    </button>
  ),
}))
// The real panel is the rich-text editor; here it shows the note and one edit.
jest.mock('@/components/notes/context-note-panel', () => ({
  ContextNotePanel: ({
    content,
    variant,
    onUpdate,
  }: {
    content: string
    variant: string
    onUpdate: (content: string) => void
  }) => (
    <div data-testid="note" data-variant={variant}>
      {content}
      <button type="button" onClick={() => onUpdate('<p>Edited</p>')}>
        ノートを書き換える
      </button>
    </div>
  ),
}))
jest.mock('@/components/tasks/task-work-history', () => ({
  TaskWorkHistory: ({ taskId }: { taskId: string }) => (
    <div data-testid="work-history">{taskId}</div>
  ),
}))
jest.mock('@/components/tasks/task-status-select', () => ({
  TaskStatusSelect: ({ task }: { task: Task }) => <div>status:{task.status}</div>,
}))
jest.mock('@/components/tasks/task-edit-dialog', () => ({
  TaskEditDialog: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/components/logs/log-form-dialog', () => ({
  LogFormDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}))
jest.mock('@/components/ai/goal-task-assistant-dialog', () => ({
  GoalTaskAssistantDialog: ({ children }: { children: React.ReactNode }) => children,
}))

describe('TaskDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentTask = task
    context = { prerequisites: [], dependents: [] }
  })

  it('shows the task with its note, work records and actions in one place', () => {
    render(<TaskDetail taskId={task.id} />)

    expect(screen.getByRole('heading', { name: 'Write the report' })).toBeInTheDocument()
    expect(screen.getByText('status:pending')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('実績 1.3h / 見積 3h')).toBeInTheDocument()
    expect(screen.getByTestId('note')).toHaveTextContent('<p>Summarise Q3</p>')
    expect(screen.getByTestId('work-history')).toHaveTextContent('task-1')
    expect(screen.getByRole('link', { name: 'Runnerで開始' })).toHaveAttribute(
      'href',
      '/runner?taskId=task-1',
    )
    for (const name of ['時間記録', '編集・依存設定', 'AIで分割']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it('saves note edits as HTML', () => {
    render(<TaskDetail taskId={task.id} />)

    fireEvent.click(screen.getByRole('button', { name: 'ノートを書き換える' }))

    expect(mockUpdateNote).toHaveBeenCalledWith({
      content: '<p>Edited</p>',
      content_type: 'html',
    })
  })

  it('offers the note copy, which first saves what is in the editor', () => {
    render(<TaskDetail taskId={task.id} />)

    fireEvent.click(screen.getByRole('button', { name: 'copy:task-1' }))

    expect(mockFlush).toHaveBeenCalledTimes(1)
  })

  it('uses the compact note in the panel and the full one on the page', () => {
    const { unmount } = render(<TaskDetail taskId={task.id} variant="panel" />)
    expect(screen.getByTestId('note')).toHaveAttribute('data-variant', 'compact')
    unmount()

    render(<TaskDetail taskId={task.id} variant="page" />)
    expect(screen.getByTestId('note')).toHaveAttribute('data-variant', 'full')
  })

  it('cannot start a task whose prerequisite is not finished', () => {
    context = { prerequisites: [related('a', 'pending')], dependents: [] }

    render(<TaskDetail taskId={task.id} />)

    expect(screen.getByText('ブロック中')).toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Runnerで開始' })).toBeDisabled()
  })

  it('cannot start a finished task', () => {
    currentTask = { ...task, status: 'completed' }

    render(<TaskDetail taskId={task.id} />)

    expect(screen.getByRole('button', { name: 'Runnerで開始' })).toBeDisabled()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })

  it('warns when a prerequisite was cancelled', () => {
    context = { prerequisites: [related('a', 'cancelled')], dependents: [] }

    render(<TaskDetail taskId={task.id} />)

    expect(screen.getByText(/キャンセルされた前提タスクがあります/)).toBeInTheDocument()
  })

  it('switches the panel to a related task when it is chosen', () => {
    context = {
      prerequisites: [related('a', 'completed')],
      dependents: [related('b', 'pending')],
    }
    const onSelectTask = jest.fn()

    render(<TaskDetail taskId={task.id} onSelectTask={onSelectTask} />)
    const prerequisites = screen.getByRole('region', { name: '先に必要なタスク' })
    fireEvent.click(within(prerequisites).getByRole('button', { name: /Task a/ }))
    const dependents = screen.getByRole('region', { name: 'このタスクを待っているタスク' })
    fireEvent.click(within(dependents).getByRole('button', { name: /Task b/ }))

    expect(onSelectTask.mock.calls).toEqual([['a'], ['b']])
  })

  it('links related tasks to their own pages on the task page', () => {
    context = { prerequisites: [related('a', 'completed')], dependents: [] }

    render(<TaskDetail taskId={task.id} variant="page" />)

    expect(screen.getByRole('link', { name: /Task a/ })).toHaveAttribute(
      'href',
      '/projects/project-1/goals/goal-2/tasks/a',
    )
  })

  it('says so when the task cannot be loaded', () => {
    currentTask = undefined

    render(<TaskDetail taskId={task.id} />)

    expect(screen.getByText('タスクを読み込めませんでした。')).toBeInTheDocument()
  })
})
