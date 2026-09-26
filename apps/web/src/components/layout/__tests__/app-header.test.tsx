// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render, screen } from '@testing-library/react'

import { AppHeader } from '../app-header'

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'user@example.com' }, signOut: jest.fn() }),
}))

jest.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => null,
}))

describe('AppHeader', () => {
  it('links the logo to the dashboard', () => {
    render(<AppHeader currentPage="tasks" />)

    const homeLink = screen.getByRole('link', { name: 'HumanCompiler ホーム（ダッシュボード）' })
    expect(homeLink).toHaveAttribute('href', '/dashboard')
    expect(homeLink).toContainElement(screen.getByAltText('HumanCompiler Logo'))
  })
})
