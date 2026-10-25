// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'

import { agentTokensApi } from '@/lib/api'
import type { AgentAuditLog } from '@/types/agent-token'
import { AgentTokenAuditLog, AUDIT_LOG_LIMIT } from '../agent-token-audit-log'

jest.mock('@/lib/api', () => ({
  agentTokensApi: {
    getAuditLogs: jest.fn(),
  },
}))

const getAuditLogs = agentTokensApi.getAuditLogs as jest.MockedFunction<
  typeof agentTokensApi.getAuditLogs
>

function makeLog(overrides: Partial<AgentAuditLog> = {}): AgentAuditLog {
  return {
    id: 'log-1',
    token_id: 't1',
    token_prefix: 'hc_agent_' + 'a'.repeat(4),
    method: 'GET',
    route: '/api/agent/v1/tasks',
    required_scope: 'tasks:read',
    status_code: 200,
    duration_ms: 1234,
    client_ip: '203.0.113.5',
    created_at: '2026-10-20T03:04:05Z',
    ...overrides,
  }
}

describe('AgentTokenAuditLog', () => {
  beforeEach(() => {
    getAuditLogs.mockReset()
  })

  it('loads the latest 20 rows of the token', async () => {
    getAuditLogs.mockResolvedValue([makeLog()])

    render(<AgentTokenAuditLog tokenId="t1" />)

    await screen.findByText('GET /api/agent/v1/tasks')
    expect(AUDIT_LOG_LIMIT).toBe(20)
    expect(getAuditLogs).toHaveBeenCalledTimes(1)
    expect(getAuditLogs).toHaveBeenCalledWith('t1', 20)
  })

  it('shows time, request, status and IP', async () => {
    getAuditLogs.mockResolvedValue([makeLog()])

    render(<AgentTokenAuditLog tokenId="t1" />)

    expect(await screen.findByText('GET /api/agent/v1/tasks')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.5')).toBeInTheDocument()
    expect(
      screen.getByText(
        new Date('2026-10-20T03:04:05Z').toLocaleString('ja-JP', {
          dateStyle: 'medium',
          timeStyle: 'medium',
        }),
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('tasks:read')).not.toBeInTheDocument()
    expect(screen.queryByText(/1234/)).not.toBeInTheDocument()
  })

  it('shows a dash when the client IP is missing', async () => {
    getAuditLogs.mockResolvedValue([makeLog({ client_ip: null })])

    render(<AgentTokenAuditLog tokenId="t1" />)

    expect(await screen.findByText('—')).toBeInTheDocument()
  })

  it('highlights 401, 403 and 429', async () => {
    getAuditLogs.mockResolvedValue([
      makeLog({ id: 'ok', status_code: 200 }),
      makeLog({ id: 'unauthorized', status_code: 401 }),
      makeLog({ id: 'forbidden', status_code: 403 }),
      makeLog({ id: 'limited', status_code: 429 }),
    ])

    render(<AgentTokenAuditLog tokenId="t1" />)

    expect(await screen.findByText('403')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('401')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('429')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('200')).not.toHaveAttribute('data-variant', 'destructive')
  })

  it('shows a message when there are no rows', async () => {
    getAuditLogs.mockResolvedValue([])

    render(<AgentTokenAuditLog tokenId="t1" />)

    expect(
      await screen.findByText('まだ記録はありません（記録は 90 日で削除されます）'),
    ).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    getAuditLogs.mockRejectedValue(new Error('boom'))

    render(<AgentTokenAuditLog tokenId="t1" />)

    expect(await screen.findByText('監査ログを読み込めませんでした')).toBeInTheDocument()
  })
})
