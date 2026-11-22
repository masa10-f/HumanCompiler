// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render, screen, within } from '@testing-library/react'

import { TaskWorkHistory } from '../task-work-history'
import type { Log } from '@/types/log'
import type { WorkSession } from '@/types/work-session'

let logs: { data?: Log[]; isLoading: boolean; error: Error | null }
let sessions: { data?: WorkSession[]; isLoading: boolean; error?: Error | null }
const mockUseLogsByTask = jest.fn()
const mockUseWorkSessionsByTask = jest.fn()

jest.mock('@/hooks/use-logs-query', () => ({
  useLogsByTask: (taskId: string) => {
    mockUseLogsByTask(taskId)
    return logs
  },
}))
jest.mock('@/hooks/use-work-sessions', () => ({
  useWorkSessionsByTask: (taskId: string) => {
    mockUseWorkSessionsByTask(taskId)
    return sessions
  },
}))
jest.mock('@/components/logs/log-edit-dialog', () => ({
  LogEditDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}))
jest.mock('@/components/logs/log-delete-dialog', () => ({
  LogDeleteDialog: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/components/runner/session-kpt-edit-dialog', () => ({
  SessionKptEditDialog: () => null,
}))

function session(overrides: Partial<WorkSession>): WorkSession {
  return {
    id: 'session-1',
    user_id: 'user',
    task_id: 'task-1',
    started_at: '2026-11-20T01:00:00Z',
    planned_checkout_at: '2026-11-20T02:00:00Z',
    ended_at: '2026-11-20T01:45:00Z',
    paused_at: null,
    total_paused_seconds: 0,
    checkout_type: null,
    decision: null,
    continue_reason: null,
    kpt_keep: null,
    kpt_problem: null,
    kpt_try: null,
    remaining_estimate_hours: null,
    planned_outcome: null,
    actual_minutes: 45,
    created_at: '2026-11-20T01:00:00Z',
    updated_at: '2026-11-20T01:45:00Z',
    ...overrides,
  } as WorkSession
}

describe('TaskWorkHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    logs = { data: [], isLoading: false, error: null }
    sessions = { data: [], isLoading: false }
  })

  it('loads the records of the task it is given', () => {
    render(<TaskWorkHistory taskId="task-1" />)

    expect(mockUseLogsByTask).toHaveBeenCalledWith('task-1')
    expect(mockUseWorkSessionsByTask).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('作業ログはまだありません')).toBeInTheDocument()
    expect(screen.getByText('セッション履歴はまだありません')).toBeInTheDocument()
  })

  it('lists time logs with their total and their edit and delete actions', () => {
    logs = {
      data: [
        { id: 'log-1', task_id: 'task-1', actual_minutes: 90, comment: 'Drafted', created_at: '2026-11-20T01:00:00Z' },
        { id: 'log-2', task_id: 'task-1', actual_minutes: 30, created_at: '2026-11-21T01:00:00Z' },
      ],
      isLoading: false,
      error: null,
    }

    render(<TaskWorkHistory taskId="task-1" />)

    const section = screen.getByRole('region', { name: '作業ログ' })
    expect(within(section).getByText('作業ログ（2件、2.0h）')).toBeInTheDocument()
    expect(within(section).getByText('Drafted')).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: 'ログを編集' })).toHaveLength(2)
    expect(within(section).getAllByRole('button', { name: 'ログを削除' })).toHaveLength(2)
  })

  it('shows a failed log load without hiding the sessions', () => {
    logs = { data: undefined, isLoading: false, error: new Error('offline') }
    sessions = { data: [session({ kpt_keep: 'Kept focus' })], isLoading: false }

    render(<TaskWorkHistory taskId="task-1" />)

    expect(screen.getByText('ログの読み込みに失敗しました: offline')).toBeInTheDocument()
    expect(screen.getByText('Kept focus')).toBeInTheDocument()
  })

  it('shows a failed session load, not an empty history', () => {
    sessions = { data: undefined, isLoading: false, error: new Error('offline') }

    render(<TaskWorkHistory taskId="task-1" />)

    expect(screen.getByText('セッションの読み込みに失敗しました: offline')).toBeInTheDocument()
    expect(screen.queryByText('セッション履歴はまだありません')).not.toBeInTheDocument()
  })

  it('shows each session with its minutes and reflection', () => {
    sessions = {
      data: [
        session({ id: 'done', kpt_keep: 'Kept focus', kpt_problem: 'Late start', kpt_try: 'Start at 9' }),
        session({ id: 'running', ended_at: null, actual_minutes: null }),
      ],
      isLoading: false,
    }

    render(<TaskWorkHistory taskId="task-1" />)

    const section = screen.getByRole('region', { name: 'Runnerのセッション' })
    expect(within(section).getByText('Runnerのセッション（2件）')).toBeInTheDocument()
    expect(within(section).getByText('45分')).toBeInTheDocument()
    for (const text of ['Kept focus', 'Late start', 'Start at 9']) {
      expect(within(section).getByText(text)).toBeInTheDocument()
    }
    expect(within(section).getByText('作業中')).toBeInTheDocument()
    expect(within(section).getByText('KPT未記入')).toBeInTheDocument()
    // A session still running has no reflection to edit yet.
    expect(within(section).getAllByRole('button', { name: 'KPT編集' })).toHaveLength(1)
  })
})
