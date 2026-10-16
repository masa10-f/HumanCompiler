// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render } from '@testing-library/react'

import { RedirectIfAuthenticated } from '../redirect-if-authenticated'

const mockReplace = jest.fn()
const mockUseAuth = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}))

describe('RedirectIfAuthenticated', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockUseAuth.mockReset()
  })

  it('redirects signed-in users to the dashboard', () => {
    mockUseAuth.mockReturnValue({ loading: false, isAuthenticated: true })

    render(<RedirectIfAuthenticated />)

    expect(mockReplace).toHaveBeenCalledWith('/dashboard')
  })

  it('waits until the session has loaded', () => {
    mockUseAuth.mockReturnValue({ loading: true, isAuthenticated: false })

    render(<RedirectIfAuthenticated />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('stays on the page for signed-out users', () => {
    mockUseAuth.mockReturnValue({ loading: false, isAuthenticated: false })

    render(<RedirectIfAuthenticated />)

    expect(mockReplace).not.toHaveBeenCalled()
  })
})
