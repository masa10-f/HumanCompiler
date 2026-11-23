// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, within } from '@testing-library/react'

import WorkSessionHistoryPage from '../page'
import type { Log } from '@/types/log'
import type { WorkRecordEntry, WorkSession } from '@/types/work-session'

let records: { data?: WorkRecordEntry[]; isLoading: boolean; error: Error | null }
const mockUseWorkRecords = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user' }, loading: false }),
}))
jest.mock('@/hooks/use-work-sessions', () => ({
  useWorkRecords: (skip: number, limit: number) => {
    mockUseWorkRecords(skip, limit)
    return records
  },
}))
jest.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}))
jest.mock('@/components/logs/log-edit-dialog', () => ({
  LogEditDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}))
jest.mock('@/components/logs/log-delete-dialog', () => ({
  LogDeleteDialog: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/components/runner/session-kpt-edit-dialog', () => ({
  SessionKptEditDialog: ({ session }: { session: WorkSession | null }) =>
    session ? <div data-testid="kpt-dialog">{session.id}</div> : null,
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
    checkout_type: 'manual',
    decision: 'continue',
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

function entry(overrides: Partial<WorkRecordEntry>): WorkRecordEntry {
  return {
    at: '2026-11-20T02:00:00Z',
    task_id: 'task-1',
    task_title: '序論を書く',
    goal_id: 'goal-1',
    project_id: 'project-1',
    log: null,
    session: null,
    ...overrides,
  }
}

/** A Runner checkout, a time entered by hand and a session without a log. */
function threeRecords(): WorkRecordEntry[] {
  return [
    entry({
      at: '2026-11-21T03:00:00Z',
      task_id: 'task-2',
      task_title: '文献を読む',
      log: log({ id: 'manual', task_id: 'task-2', actual_minutes: 75, comment: '3本読んだ' }),
    }),
    entry({
      at: '2026-11-20T01:45:00Z',
      log: log({
        id: 'runner-log',
        actual_minutes: 45,
        comment: 'K: Kept focus',
        work_session_id: 'session-1',
      }),
      session: session({ kpt_keep: 'Kept focus' }),
    }),
    entry({
      at: '2026-11-19T01:45:00Z',
      session: session({
        id: 'orphan',
        started_at: '2026-11-19T01:00:00Z',
        ended_at: '2026-11-19T01:45:00Z',
        decision: 'complete',
      }),
    }),
  ]
}

describe('WorkSessionHistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    records = { data: threeRecords(), isLoading: false, error: null }
  })

  it('lists Runner sessions and times entered by hand together', () => {
    render(<WorkSessionHistoryPage />)

    expect(mockUseWorkRecords).toHaveBeenCalledWith(0, 100)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)

    const manual = within(items[0]!)
    expect(manual.getByRole('link', { name: '文献を読む' })).toHaveAttribute(
      'href',
      '/projects/project-1/goals/goal-1/tasks/task-2',
    )
    expect(manual.getByText('1.3h')).toBeInTheDocument()
    expect(manual.getByText('3本読んだ')).toBeInTheDocument()
    expect(manual.queryByText('Runner')).not.toBeInTheDocument()

    const runner = within(items[1]!)
    expect(runner.getByRole('link', { name: '序論を書く' })).toBeInTheDocument()
    expect(runner.getByText('0.8h')).toBeInTheDocument()
    expect(runner.getByText('Runner')).toBeInTheDocument()
    expect(runner.getByText('継続')).toBeInTheDocument()
    expect(runner.getByText('手動')).toBeInTheDocument()
    expect(runner.getByText('Kept focus')).toBeInTheDocument()
    // The checkout's own summary is not repeated under the reflection.
    expect(runner.queryByText('K: Kept focus')).not.toBeInTheDocument()

    expect(within(items[2]!).getByText(/紐付く時間記録がありません/)).toBeInTheDocument()
  })

  it('counts the time of the logs only', () => {
    render(<WorkSessionHistoryPage />)

    expect(screen.getByText('記録数').previousSibling).toHaveTextContent('3')
    // 75 + 45 minutes; the session without a log adds nothing.
    expect(screen.getByText('総作業時間').previousSibling).toHaveTextContent('2時間')
    expect(screen.getByText('Runnerの記録').previousSibling).toHaveTextContent('2')
  })

  it('filters by the day the work was recorded, in JST', () => {
    render(<WorkSessionHistoryPage />)

    // 2026-11-19T01:45Z is 10:45 on the 19th in JST.
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-11-20' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-11-20' } })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(within(items[0]!).getByRole('link', { name: '序論を書く' })).toBeInTheDocument()
    expect(screen.getByText('記録数').previousSibling).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('opens the reflection editor for a session', () => {
    render(<WorkSessionHistoryPage />)

    const runner = within(screen.getAllByRole('listitem')[1]!)
    fireEvent.click(runner.getByRole('button', { name: '振り返りを編集' }))

    expect(screen.getByTestId('kpt-dialog')).toHaveTextContent('session-1')
  })

  it('says when there is nothing recorded yet', () => {
    records = { data: [], isLoading: false, error: null }

    render(<WorkSessionHistoryPage />)

    expect(screen.getByText('作業記録がありません')).toBeInTheDocument()
  })

  it('says when the filters leave nothing', () => {
    render(<WorkSessionHistoryPage />)

    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2027-01-01' } })

    expect(screen.getByText('該当する作業記録がありません')).toBeInTheDocument()
  })

  it('shows a failed load as a failure, not as an empty history', () => {
    records = { data: undefined, isLoading: false, error: new Error('offline') }

    render(<WorkSessionHistoryPage />)

    expect(screen.getByText('作業履歴の読み込みに失敗しました: offline')).toBeInTheDocument()
    expect(screen.queryByText('作業記録がありません')).not.toBeInTheDocument()
  })

  it('says when only the newest records are shown', () => {
    records = {
      data: Array.from({ length: 100 }, (_, index) =>
        entry({ log: log({ id: `log-${index}` }) }),
      ),
      isLoading: false,
      error: null,
    }

    render(<WorkSessionHistoryPage />)

    expect(screen.getByText('最新100件の記録を表示しています。')).toBeInTheDocument()
  })
})
