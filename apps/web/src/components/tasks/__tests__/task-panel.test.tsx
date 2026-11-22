// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react'

import { TaskPanel } from '../task-panel'
import type { Task } from '@/types/task'

const task: Task = {
  id: 'task-1',
  title: 'Deep linked task',
  estimate_hours: 1,
  due_date: null,
  status: 'pending',
  priority: 2,
  goal_id: 'goal-1',
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  dependencies: [],
}

jest.mock('@/hooks/use-tasks-query', () => ({
  useTask: () => ({ data: task, isLoading: false }),
}))

jest.mock('@/hooks/use-goals-query', () => ({
  useGoal: () => ({
    data: { id: 'goal-1', project_id: 'project-1' },
    isLoading: false,
  }),
}))

// The panel loads the detail (and the note editor behind it) on demand.
jest.mock('next/dynamic', () => () => {
  function TaskDetail({ taskId, variant }: { taskId: string; variant: string }) {
    return (
      <div data-testid="task-detail">
        {taskId}:{variant}
      </div>
    )
  }
  return TaskDetail
})

function renderPanel(taskId: string | null, onClose = jest.fn()) {
  render(
    <TaskPanel
      taskId={taskId}
      availableTasks={[task]}
      onClose={onClose}
      onSelectTask={jest.fn()}
    />,
  )
  return onClose
}

describe('TaskPanel', () => {
  it('stays closed without a task', () => {
    renderPanel(null)

    expect(screen.queryByLabelText('タスク詳細')).not.toBeInTheDocument()
  })

  it('shows the task detail as a panel and links to the task page', () => {
    renderPanel(task.id)

    expect(screen.getByTestId('task-detail')).toHaveTextContent('task-1:panel')
    expect(screen.getByRole('link', { name: 'ページで開く' })).toHaveAttribute(
      'href',
      '/projects/project-1/goals/goal-1/tasks/task-1',
    )
  })

  it('closes from the close button, the backdrop and the Escape key', () => {
    const onClose = renderPanel(task.id)

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    fireEvent.click(screen.getByRole('button', { name: '詳細パネルを閉じる' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('leaves Escape to a dialog opened from the panel', () => {
    const onClose = renderPanel(task.id)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    fireEvent.keyDown(document, { key: 'Escape' })
    dialog.remove()

    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves Escape to a field the user is typing in', () => {
    const onClose = renderPanel(task.id)
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const paragraph = document.createElement('p')
    editor.appendChild(paragraph)
    document.body.append(input, editor)

    // Escape cancels an IME conversion or an editor menu here.
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(paragraph, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    input.remove()
    editor.remove()

    expect(onClose).not.toHaveBeenCalled()
  })

  it('is mounted under the body, whatever container renders it', () => {
    const { container } = render(
      <div className="space-y-6">
        <TaskPanel
          taskId={task.id}
          availableTasks={[task]}
          onClose={jest.fn()}
          onSelectTask={jest.fn()}
        />
      </div>,
    )

    const panel = screen.getByLabelText('タスク詳細')
    expect(container).not.toContainElement(panel)
    expect(panel.parentElement?.parentElement).toBe(document.body)
  })
})
