// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { agentTokensApi } from '@/lib/api'
import type {
  AgentScopeCatalog,
  AgentToken,
  AgentTokenCreated,
} from '@/types/agent-token'
import { AgentTokensCard } from '../agent-tokens-card'

jest.mock('@/lib/api', () => ({
  agentTokensApi: {
    getAll: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
    getScopes: jest.fn(),
    getAuditLogs: jest.fn(),
  },
}))

jest.mock('@/lib/logger', () => ({
  log: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

const getAll = agentTokensApi.getAll as jest.MockedFunction<typeof agentTokensApi.getAll>
const create = agentTokensApi.create as jest.MockedFunction<typeof agentTokensApi.create>
const revoke = agentTokensApi.revoke as jest.MockedFunction<typeof agentTokensApi.revoke>
const getScopes = agentTokensApi.getScopes as jest.MockedFunction<
  typeof agentTokensApi.getScopes
>
const getAuditLogs = agentTokensApi.getAuditLogs as jest.MockedFunction<
  typeof agentTokensApi.getAuditLogs
>

const clipboardWriteText = jest.fn()

const catalog: AgentScopeCatalog = {
  scopes: [
    { scope: 'tasks:read', description: 'タスクを読む', broad: false },
    { scope: 'quick_tasks:write', description: 'クイックタスクを追加', broad: false },
    { scope: 'context:read', description: '広く読む', broad: true },
  ],
  presets: [
    {
      key: 'quick_task_hook',
      label: 'Quick task hook',
      description: 'hook から追加',
      scopes: ['quick_tasks:write'],
    },
  ],
}

function makeToken(overrides: Partial<AgentToken> = {}): AgentToken {
  return {
    id: 't1',
    name: 'Research agent',
    description: null,
    scopes: ['tasks:read'],
    token_prefix: 'hc_agent_' + 'a'.repeat(8),
    last_used_at: null,
    created_at: '2026-10-20T03:04:05Z',
    updated_at: '2026-10-20T03:04:05Z',
    ...overrides,
  }
}

const formatDate = (value: string) =>
  new Date(value).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

describe('AgentTokensCard', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    })
    clipboardWriteText.mockResolvedValue(undefined)
    getAll.mockResolvedValue([])
    getScopes.mockResolvedValue(catalog)
    getAuditLogs.mockResolvedValue([])
  })

  it('lists tokens with name, prefix, scope chips and dates', async () => {
    getAll.mockResolvedValue([
      makeToken({ description: '論文を調べる' }),
      makeToken({
        id: 't2',
        name: 'Used agent',
        token_prefix: 'hc_agent_' + 'c'.repeat(8),
        last_used_at: '2026-10-21T01:02:03Z',
      }),
    ])

    render(<AgentTokensCard />)

    expect(await screen.findByText('Research agent')).toBeInTheDocument()
    expect(screen.getByText('論文を調べる')).toBeInTheDocument()
    expect(screen.getByText('hc_agent_' + 'a'.repeat(8) + '…')).toBeInTheDocument()
    expect(screen.getAllByText('tasks:read')).toHaveLength(2)
    expect(screen.getAllByText(`作成: ${formatDate('2026-10-20T03:04:05Z')}`)).toHaveLength(2)
    expect(screen.getByText('最終使用: 未使用')).toBeInTheDocument()
    expect(screen.getByText(`最終使用: ${formatDate('2026-10-21T01:02:03Z')}`)).toBeInTheDocument()
  })

  it('orders scope chips by the catalog with unknown scopes last', async () => {
    getAll.mockResolvedValue([
      makeToken({
        scopes: ['runs:execute', 'context:read', 'zeta:write', 'tasks:read'],
      }),
    ])

    render(<AgentTokensCard />)

    const chips = within(await screen.findByRole('list', { name: 'スコープ' })).getAllByRole(
      'listitem',
    )
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'tasks:read',
      'context:read',
      'runs:execute',
      'zeta:write',
    ])
  })

  it('marks broad scope chips', async () => {
    getAll.mockResolvedValue([makeToken({ scopes: ['tasks:read', 'context:read'] })])

    render(<AgentTokensCard />)

    expect(await screen.findByText('context:read')).toHaveAttribute('title', '広い読み取り権限')
    expect(screen.getByText('tasks:read')).not.toHaveAttribute('title')
  })

  it('shows unknown scopes as plain chips', async () => {
    getAll.mockResolvedValue([makeToken({ scopes: ['runs:execute'] })])

    render(<AgentTokensCard />)

    const chip = await screen.findByText('runs:execute')
    expect(chip).toBeInTheDocument()
    expect(chip).not.toHaveAttribute('title')
  })

  it('creates a token and shows the secret once for copying', async () => {
    const secret = 'hc_agent_' + 'd'.repeat(32)
    const secret2 = 'hc_agent_' + 'e'.repeat(32)
    getAll.mockResolvedValue([makeToken()])
    create.mockImplementation(async (data) => ({
      ...makeToken({
        id: data.name === 'First' ? 't-new-1' : 't-new-2',
        name: data.name,
        scopes: data.scopes,
        token_prefix: 'hc_agent_' + 'd'.repeat(8),
      }),
      token: data.name === 'First' ? secret : secret2,
    }) satisfies AgentTokenCreated)

    render(<AgentTokensCard />)
    await screen.findByText('Research agent')

    const createToken = async (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'トークンを作成' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('名前'), { target: { value: name } })
      fireEvent.click(within(dialog).getByRole('radio', { name: /Quick task hook/ }))
      fireEvent.click(within(dialog).getByRole('button', { name: '作成' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }

    await createToken('First')

    expect(create).toHaveBeenCalledWith({ name: 'First', scopes: ['quick_tasks:write'] })
    expect(screen.getByText(secret)).toBeInTheDocument()
    expect(screen.getByText('この値は今だけ表示されます。安全な場所に保存してください。')).toBeInTheDocument()
    const names = screen.getAllByRole('listitem').filter((el) => el.hasAttribute('data-token-row'))
    expect(names.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'First',
      'Research agent',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(secret))
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()

    await createToken('Second')

    expect(screen.getByText(secret2)).toBeInTheDocument()
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })

  it('lists a migrated hook token and revokes it', async () => {
    getAll.mockResolvedValue([
      makeToken({
        id: 'hook-1',
        name: 'Paper intake',
        scopes: ['quick_tasks:write'],
        token_prefix: 'hc_hook_' + 'b'.repeat(8),
      }),
    ])
    revoke.mockResolvedValue(undefined)

    render(<AgentTokensCard />)

    expect(await screen.findByText('hc_hook_' + 'b'.repeat(8) + '…')).toBeInTheDocument()
    expect(screen.getByText('quick_tasks:write')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '失効' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(
        'このエージェントトークンを失効してもよろしいですか？ 失効はすぐに反映され、元に戻せません。',
      ),
    ).toBeInTheDocument()
    expect(revoke).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '失効' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('hook-1'))
    await waitFor(() => expect(screen.queryByText('Paper intake')).not.toBeInTheDocument())
    expect(await screen.findByText('エージェントトークンを失効しました')).toBeInTheDocument()
  })

  it('keeps the token and shows an error when revoking fails', async () => {
    getAll.mockResolvedValue([makeToken()])
    revoke.mockRejectedValue(new Error('boom'))

    render(<AgentTokensCard />)
    await screen.findByText('Research agent')

    fireEvent.click(screen.getByRole('button', { name: '失効' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '失効' }))

    expect(await screen.findByText('エージェントトークンの失効に失敗しました')).toBeInTheDocument()
    expect(screen.getByText('Research agent')).toBeInTheDocument()
  })

  it('expands the audit log of a token', async () => {
    getAll.mockResolvedValue([makeToken()])

    render(<AgentTokensCard />)
    await screen.findByText('Research agent')

    expect(getAuditLogs).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '監査ログ' }))

    await waitFor(() => expect(getAuditLogs).toHaveBeenCalledWith('t1', 20))
    expect(
      await screen.findByText('まだ記録はありません（記録は 90 日で削除されます）'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '監査ログ' }))
    await waitFor(() =>
      expect(
        screen.queryByText('まだ記録はありません（記録は 90 日で削除されます）'),
      ).not.toBeInTheDocument(),
    )
  })

  it('keeps the list usable when the scope catalog fails to load', async () => {
    getAll.mockResolvedValue([makeToken()])
    getScopes.mockRejectedValue(new Error('old api'))
    revoke.mockResolvedValue(undefined)

    render(<AgentTokensCard />)

    expect(await screen.findByText('スコープを読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'トークンを作成' })).toBeDisabled()
    expect(screen.getByText('Research agent')).toBeInTheDocument()
    expect(screen.getByText('tasks:read')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '失効' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '失効' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByText('Research agent')).not.toBeInTheDocument())
  })

  it('shows an error when the token list fails to load', async () => {
    getAll.mockRejectedValue(new Error('boom'))

    render(<AgentTokensCard />)

    expect(await screen.findByText('エージェントトークンを読み込めませんでした')).toBeInTheDocument()
    expect(screen.queryByText('有効なエージェントトークンはありません')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no tokens', async () => {
    render(<AgentTokensCard />)

    expect(await screen.findByText('有効なエージェントトークンはありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'トークンを作成' })).toBeEnabled()
  })
})
