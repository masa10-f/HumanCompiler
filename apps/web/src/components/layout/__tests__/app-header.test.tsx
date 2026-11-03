// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, within } from '@testing-library/react'

import { AppHeader } from '../app-header'

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'user@example.com' }, signOut: jest.fn() }),
}))

const mockUseProposalSummary = jest.fn()

jest.mock('@/hooks/use-proposals', () => ({
  useProposalSummary: (...args: unknown[]) => mockUseProposalSummary(...args),
}))

jest.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => null,
}))

describe('AppHeader', () => {
  beforeEach(() => {
    mockUseProposalSummary.mockReset()
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 0, latest: [] } })
  })

  it('links the logo to the dashboard', () => {
    render(<AppHeader currentPage="tasks" />)

    const homeLink = screen.getByRole('link', { name: 'HumanCompiler ホーム（ダッシュボード）' })
    expect(homeLink).toHaveAttribute('href', '/dashboard')
    expect(homeLink).toContainElement(screen.getByAltText('HumanCompiler Logo'))
  })

  it('links to the inbox from the desktop nav', () => {
    render(<AppHeader currentPage="inbox" />)

    expect(screen.getByRole('link', { name: 'インボックス' })).toHaveAttribute('href', '/inbox')
  })

  it('asks for the summary only when signed in', () => {
    render(<AppHeader />)

    expect(mockUseProposalSummary).toHaveBeenCalledWith({ enabled: true })
  })

  it('shows the pending count on the inbox item', () => {
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 3, latest: [] } })

    render(<AppHeader />)

    const badge = screen.getByLabelText('未処理の提案 3 件')
    expect(badge).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /インボックス/ })).toContainElement(badge)
  })

  it('caps the badge text at 99+ but keeps the real number in the label', () => {
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 150, latest: [] } })

    render(<AppHeader />)

    expect(screen.getByLabelText('未処理の提案 150 件')).toHaveTextContent('99+')
  })

  it('shows no badge when nothing is pending', () => {
    render(<AppHeader />)

    expect(screen.queryByLabelText(/未処理の提案/)).not.toBeInTheDocument()
  })

  it('shows the badge in the mobile menu too', () => {
    mockUseProposalSummary.mockReturnValue({ data: { pending_count: 3, latest: [] } })

    render(<AppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))

    const dialog = within(screen.getByRole('dialog'))
    const link = dialog.getByRole('link', { name: /インボックス/ })
    expect(link).toHaveAttribute('href', '/inbox')
    expect(within(link).getByLabelText('未処理の提案 3 件')).toHaveTextContent('3')
  })
})
