// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render, screen } from '@testing-library/react'

import { InboxCard } from '../inbox-card'

const mockUseProposalSummary = jest.fn()

jest.mock('@/hooks/use-proposals', () => ({
  useProposalSummary: (...args: unknown[]) => mockUseProposalSummary(...args),
}))

const latest = [
  { id: 'p1', kind: 'quick_task', title: '図3を作り直す', agent_name: 'a', created_at: '2026-11-03T00:00:00Z' },
  { id: 'p2', kind: 'experiment', title: '追加実験を回す', agent_name: 'a', created_at: '2026-11-02T00:00:00Z' },
  { id: 'p3', kind: 'goal', title: '新しい Goal', agent_name: 'a', created_at: '2026-11-01T00:00:00Z' },
]

describe('InboxCard', () => {
  beforeEach(() => {
    mockUseProposalSummary.mockReset()
  })

  it('shows only the empty line when nothing is pending', () => {
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 0, latest: [] }, isLoading: false, isError: false })

    render(<InboxCard />)

    expect(screen.getByText('インボックス')).toBeInTheDocument()
    expect(screen.getByText('未処理の提案はありません')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the count, the latest rows as links and the see-all link', () => {
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 4, latest }, isLoading: false, isError: false })

    render(<InboxCard />)

    expect(screen.getByText('4')).toBeInTheDocument()
    for (const item of latest) {
      const link = screen.getByRole('link', { name: new RegExp(item.title) })
      expect(link).toHaveAttribute('href', '/inbox')
    }
    expect(screen.getByText('クイックタスク')).toBeInTheDocument()
    expect(screen.getByText('実験')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'すべて見る' })).toHaveAttribute('href', '/inbox')
  })

  it('shows a skeleton while loading', () => {
    mockUseProposalSummary.mockReturnValue({ data: undefined, isLoading: true, isError: false })

    render(<InboxCard />)

    expect(screen.getByText('インボックス')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-card-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('未処理の提案はありません')).not.toBeInTheDocument()
  })

  it('does not break on error and keeps the title and the link', () => {
    mockUseProposalSummary.mockReturnValue({ data: undefined, isLoading: false, isError: true })

    render(<InboxCard />)

    expect(screen.getByText('インボックス')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'すべて見る' })).toHaveAttribute('href', '/inbox')
    expect(screen.queryByText('未処理の提案はありません')).not.toBeInTheDocument()
  })
})
