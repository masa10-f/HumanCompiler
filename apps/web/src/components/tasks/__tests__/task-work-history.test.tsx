// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render, screen, within } from '@testing-library/react'

import { TaskWorkHistory } from '../task-work-history'
import { buildWorkRecords, kptSummary } from '@/components/work-records/work-record-item'
import type { Log } from '@/types/log'
import type { WorkSession } from '@/types/work-session'

let logs: { data?: Log[]; isLoading: boolean; error: Error | null }
let sessions: { data?: WorkSession[]; isLoading: boolean; error?: Error | null }
const mockUseLogsByTask = jest.fn()
const mockUseWorkSessionsByTask = jest.fn()

jest.mock('@/hooks/use-logs-query', () => ({
  TASK_LOGS_LIMIT: 50,
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

function log(overrides: Partial<Log>): Log {
  return {
    id: 'log-1',
    task_id: 'task-1',
    actual_minutes: 30,
    created_at: '2026-11-20T02:00:00Z',
    ...overrides,
  }
}

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

describe('buildWorkRecords', () => {
  it('makes one record of a Runner session and its time log', () => {
    const runnerLog = log({ id: 'runner-log', work_session_id: 'session-1' })
    const runnerSession = session({ id: 'session-1' })

    expect(buildWorkRecords([runnerLog], [runnerSession])).toEqual([
      { key: 'log:runner-log', at: runnerLog.created_at, log: runnerLog, session: runnerSession },
    ])
  })

  it('keeps a manual log, a running session and a session without its log apart', () => {
    const manual = log({ id: 'manual', created_at: '2026-11-21T00:00:00Z' })
    const running = session({ id: 'running', started_at: '2026-11-22T00:00:00Z', ended_at: null })
    const orphan = session({ id: 'orphan', ended_at: '2026-11-19T00:00:00Z' })

    const records = buildWorkRecords([manual], [orphan, running])

    // Newest first: the running session, the manual log, the old session.
    expect(records.map((record) => record.key)).toEqual([
      'session:running',
      'log:manual',
      'session:orphan',
    ])
    expect(records[1]).toEqual({ key: 'log:manual', at: manual.created_at, log: manual, session: undefined })
  })

  it('treats a log whose session was not loaded as a plain time record', () => {
    const old = log({ id: 'old', work_session_id: 'not-loaded', comment: 'K: Kept focus' })

    expect(buildWorkRecords([old], [])).toEqual([
      { key: 'log:old', at: old.created_at, log: old, session: undefined },
    ])
  })
})

describe('kptSummary', () => {
  it('is the comment a checkout writes from the reflection', () => {
    expect(kptSummary(session({ kpt_keep: 'Kept focus', kpt_try: 'Start at 9' }))).toBe(
      'K: Kept focus | T: Start at 9',
    )
    expect(kptSummary(session({}))).toBeNull()
  })

  it('cuts each part at 100 characters, as the API does', () => {
    const long = 'あ'.repeat(120)

    expect(kptSummary(session({ kpt_problem: long }))).toBe(`P: ${'あ'.repeat(100)}`)
  })
})

describe('TaskWorkHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    logs = { data: [], isLoading: false, error: null }
    sessions = { data: [], isLoading: false, error: null }
  })

  it('loads the records of the task it is given', () => {
    render(<TaskWorkHistory taskId="task-1" />)

    expect(mockUseLogsByTask).toHaveBeenCalledWith('task-1')
    expect(mockUseWorkSessionsByTask).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('作業記録はまだありません')).toBeInTheDocument()
    expect(screen.getByText('0件の記録、合計 0.0h')).toBeInTheDocument()
  })

  it('shows a Runner checkout once, with the log time and the session reflection', () => {
    logs = {
      data: [
        log({
          id: 'runner-log',
          actual_minutes: 45,
          comment: 'K: Kept focus | T: Start at 9',
          work_session_id: 'session-1',
        }),
        log({ id: 'manual', actual_minutes: 75, comment: 'Read the papers', created_at: '2026-11-19T02:00:00Z' }),
      ],
      isLoading: false,
      error: null,
    }
    sessions = {
      data: [session({ kpt_keep: 'Kept focus', kpt_try: 'Start at 9', decision: 'continue' })],
      isLoading: false,
    }

    render(<TaskWorkHistory taskId="task-1" />)

    // Two pieces of work, not three rows, and the time is not counted twice.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(screen.getByText('2件の記録、合計 2.0h')).toBeInTheDocument()

    const runner = within(items[0]!)
    expect(runner.getByText('0.8h')).toBeInTheDocument()
    expect(runner.getByText('Runner')).toBeInTheDocument()
    expect(runner.getByText('Kept focus')).toBeInTheDocument()
    expect(runner.getByText('Start at 9')).toBeInTheDocument()
    // The comment is a copy of the reflection, so it is not shown again.
    expect(runner.queryByText('K: Kept focus | T: Start at 9')).not.toBeInTheDocument()
    for (const name of ['振り返りを編集', '時間とコメントを編集', '記録を削除']) {
      expect(runner.getByRole('button', { name })).toBeInTheDocument()
    }

    const manual = within(items[1]!)
    expect(manual.getByText('1.3h')).toBeInTheDocument()
    expect(manual.getByText('Read the papers')).toBeInTheDocument()
    expect(manual.queryByText('Runner')).not.toBeInTheDocument()
    expect(manual.queryByRole('button', { name: '振り返りを編集' })).not.toBeInTheDocument()
  })

  it('shows the comment of a Runner record that has no reflection', () => {
    logs = {
      data: [log({ comment: 'ここから再開', work_session_id: 'session-1' })],
      isLoading: false,
      error: null,
    }
    sessions = { data: [session({})], isLoading: false }

    render(<TaskWorkHistory taskId="task-1" />)

    expect(screen.getByText('ここから再開')).toBeInTheDocument()
  })

  it('shows a comment the user wrote on a Runner record beside the reflection', () => {
    logs = {
      data: [log({ comment: '午後は会議で中断', work_session_id: 'session-1' })],
      isLoading: false,
      error: null,
    }
    sessions = { data: [session({ kpt_keep: 'Kept focus' })], isLoading: false }

    render(<TaskWorkHistory taskId="task-1" />)

    const item = within(screen.getByRole('listitem'))
    expect(item.getByText('Kept focus')).toBeInTheDocument()
    expect(item.getByText('午後は会議で中断')).toBeInTheDocument()
  })

  it('shows a running session as in progress, with nothing to edit yet', () => {
    sessions = {
      data: [session({ id: 'running', ended_at: null, actual_minutes: null })],
      isLoading: false,
    }

    render(<TaskWorkHistory taskId="task-1" />)

    const item = within(screen.getByRole('listitem'))
    expect(item.getByText('作業中')).toBeInTheDocument()
    expect(item.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('0件の記録、合計 0.0h')).toBeInTheDocument()
  })

  it('says when a session has no time record linked to it', () => {
    sessions = { data: [session({ kpt_keep: 'Kept focus' })], isLoading: false }

    render(<TaskWorkHistory taskId="task-1" />)

    const item = within(screen.getByRole('listitem'))
    expect(item.getByText('Kept focus')).toBeInTheDocument()
    expect(item.getByText(/紐付く時間記録がありません/)).toBeInTheDocument()
    expect(item.queryByRole('button', { name: '記録を削除' })).not.toBeInTheDocument()
  })

  it('does not say a session has no time record when not every log is loaded', () => {
    // A full page of newer logs: the session's own log may be beyond it.
    logs = {
      data: Array.from({ length: 50 }, (_, index) =>
        log({ id: `log-${index}`, created_at: '2026-11-21T00:00:00Z' }),
      ),
      isLoading: false,
      error: null,
    }
    sessions = { data: [session({ kpt_keep: 'Kept focus' })], isLoading: false }

    render(<TaskWorkHistory taskId="task-1" />)

    expect(screen.getByText('Kept focus')).toBeInTheDocument()
    expect(screen.queryByText(/紐付く時間記録がありません/)).not.toBeInTheDocument()
  })

  it('shows a failed load of either source without hiding the other', () => {
    logs = { data: undefined, isLoading: false, error: new Error('offline') }
    sessions = { data: [session({ kpt_keep: 'Kept focus' })], isLoading: false }

    const { unmount } = render(<TaskWorkHistory taskId="task-1" />)
    expect(screen.getByText('時間記録の読み込みに失敗しました: offline')).toBeInTheDocument()
    expect(screen.getByText('Kept focus')).toBeInTheDocument()
    // The logs did not load, so whether the session has a log is unknown.
    expect(screen.queryByText(/紐付く時間記録がありません/)).not.toBeInTheDocument()
    unmount()

    logs = { data: [log({ comment: 'Drafted' })], isLoading: false, error: null }
    sessions = { data: undefined, isLoading: false, error: new Error('timeout') }
    render(<TaskWorkHistory taskId="task-1" />)
    expect(screen.getByText('セッションの読み込みに失敗しました: timeout')).toBeInTheDocument()
    expect(screen.getByText('Drafted')).toBeInTheDocument()
  })

  it('does not say there are no records when the load failed', () => {
    logs = { data: undefined, isLoading: false, error: new Error('offline') }

    render(<TaskWorkHistory taskId="task-1" />)

    expect(screen.queryByText('作業記録はまだありません')).not.toBeInTheDocument()
  })
})
