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
const mockGetFallbackApiEndpoint = jest.fn()

jest.mock('@/lib/config', () => ({
  getApiEndpoint: () => mockGetApiEndpoint(),
  getFallbackApiEndpoint: () => mockGetFallbackApiEndpoint(),
}))

import { AgentTokenUsageGuide } from '../agent-token-usage-guide'

describe('AgentTokenUsageGuide', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('is collapsed until the usage toggle is clicked', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)

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

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText(`POST ${window.location.origin}/api/hooks/quick-tasks`)
    ).toBeInTheDocument()
  })

  it('shows how to check a token with /api/agent/v1/me', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText(
        'curl -H "Authorization: Bearer <AGENT_TOKEN>" https://api.example.com/api/agent/v1/me'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('X-HumanCompiler-Agent-Token: <AGENT_TOKEN>')).toBeInTheDocument()
  })

  it('shows a list request with paging', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText(
        'curl -H "Authorization: Bearer <AGENT_TOKEN>" "https://api.example.com/api/agent/v1/tasks?limit=50"'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/items.*next_cursor/)).toBeInTheDocument()
    expect(screen.getByText(/cursor=<next_cursor>/)).toBeInTheDocument()
    expect(screen.getByText(/updated_since/)).toBeInTheDocument()
  })

  it('lists the agent API error responses', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(screen.getAllByText(/^401:/).length).toBeGreaterThan(0)
    expect(screen.getByText(/^403:.*Missing required scope/)).toBeInTheDocument()
    expect(screen.getByText(/^429:.*Retry-After/)).toBeInTheDocument()
  })

  it('keeps the quick task hook example with an agent token', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(
      screen.getByText('POST https://api.example.com/api/hooks/quick-tasks')
    ).toBeInTheDocument()
    expect(screen.getByText(/curl -X POST .*\/api\/hooks\/quick-tasks/)).toHaveTextContent(
      '<AGENT_TOKEN>'
    )
    expect(screen.getByText(/quick_tasks:write/)).toBeInTheDocument()
    expect(screen.getByText('X-HumanCompiler-Hook-Token: <AGENT_TOKEN>')).toBeInTheDocument()
  })

  it('points to the API host docs, not the web origin, when the API base is relative', () => {
    mockGetApiEndpoint.mockReturnValue('')
    mockGetFallbackApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(screen.getByText(/https:\/\/api\.example\.com\/docs/)).toBeInTheDocument()
    expect(screen.queryByText(`${window.location.origin}/docs`, { exact: false })).not.toBeInTheDocument()
  })

  it('points to the configured API base docs', () => {
    mockGetApiEndpoint.mockReturnValue('https://api.example.com')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(screen.getByText(/https:\/\/api\.example\.com\/docs/)).toBeInTheDocument()
  })

  it('omits the docs pointer when no API host is known', () => {
    mockGetApiEndpoint.mockReturnValue('')
    mockGetFallbackApiEndpoint.mockReturnValue('')

    render(<AgentTokenUsageGuide />)
    fireEvent.click(screen.getByRole('button', { name: /使用方法/ }))

    expect(screen.queryByText(/\/docs/)).not.toBeInTheDocument()
  })
})
