// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'

const mockGetApiEndpoint = jest.fn()

jest.mock('@/lib/config', () => ({
  getApiEndpoint: () => mockGetApiEndpoint(),
}))

import { HookTokenUsageGuide } from '../hook-token-usage-guide'

describe('HookTokenUsageGuide', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is collapsed until the usage toggle is clicked', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<HookTokenUsageGuide />)

    expect(
      screen.queryByText('POST https://api.example.com/api/hooks/quick-tasks')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText('POST https://api.example.com/api/hooks/quick-tasks')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/curl -X POST https:\/\/api\.example\.com\/api\/hooks\/quick-tasks/)
    ).toBeInTheDocument()
  })

  it('falls back to the current origin when the API base is relative', () => {
    mockGetApiEndpoint.mockReturnValue('')

    render(<HookTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText(`POST ${window.location.origin}/api/hooks/quick-tasks`)
    ).toBeInTheDocument()
  })
})
