// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AgentScopeCatalog } from '@/types/agent-token'
import { AgentTokenCreateDialog } from '../agent-token-create-dialog'

const catalog: AgentScopeCatalog = {
  scopes: [
    { scope: 'tasks:read', description: 'タスクの読み取り', broad: false },
    { scope: 'context:read', description: 'コンテキストの読み取り', broad: true },
    { scope: 'quick_tasks:write', description: 'クイックタスクの作成', broad: false },
    { scope: 'artifacts:write', description: '成果物の書き込み', broad: false },
  ],
  presets: [
    {
      key: 'read_only',
      label: '読み取り専用エージェント',
      description: 'すべての読み取り',
      scopes: ['tasks:read', 'context:read'],
    },
    {
      key: 'local_agent',
      label: 'ローカルエージェント',
      description: 'ローカルで動くエージェント',
      scopes: ['tasks:read', 'artifacts:write'],
    },
  ],
}

function renderDialog(onCreate: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  const onOpenChange = jest.fn()
  render(
    <AgentTokenCreateDialog
      open
      onOpenChange={onOpenChange}
      catalog={catalog}
      onCreate={onCreate}
    />,
  )
  return { onCreate, onOpenChange }
}

const scopeBox = (scope: string) => screen.getByRole('checkbox', { name: new RegExp(scope) })
const createButton = () => screen.getByRole('button', { name: '作成' })

describe('AgentTokenCreateDialog', () => {
  it('builds presets and scopes from the catalog', () => {
    renderDialog()

    expect(screen.getByRole('radio', { name: /ローカルエージェント/ })).toBeInTheDocument()
    expect(scopeBox('artifacts:write')).toBeInTheDocument()
  })

  it('starts with no scopes and the custom preset', () => {
    renderDialog()

    expect(screen.getByRole('radio', { name: /カスタム/ })).toBeChecked()
    for (const { scope } of catalog.scopes) {
      expect(scopeBox(scope)).not.toBeChecked()
    }
    expect(createButton()).toBeDisabled()
  })

  it('replaces the checked scopes when a preset is chosen', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: /読み取り専用エージェント/ }))

    expect(scopeBox('tasks:read')).toBeChecked()
    expect(scopeBox('context:read')).toBeChecked()
    expect(scopeBox('quick_tasks:write')).not.toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: /ローカルエージェント/ }))

    expect(scopeBox('context:read')).not.toBeChecked()
    expect(scopeBox('artifacts:write')).toBeChecked()
  })

  it('switches to custom when a scope is changed after a preset', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: /読み取り専用エージェント/ }))
    expect(screen.getByRole('radio', { name: /読み取り専用エージェント/ })).toBeChecked()

    fireEvent.click(scopeBox('quick_tasks:write'))

    expect(screen.getByRole('radio', { name: /カスタム/ })).toBeChecked()
  })

  it('marks broad scopes', () => {
    renderDialog()

    const contextRow = scopeBox('context:read').closest('div[data-scope-row]') as HTMLElement
    const tasksRow = scopeBox('tasks:read').closest('div[data-scope-row]') as HTMLElement

    expect(contextRow).toHaveTextContent('広い読み取り権限')
    expect(tasksRow).not.toHaveTextContent('広い読み取り権限')
  })

  it('submits the name, description and scopes', async () => {
    const { onCreate } = renderDialog()

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Research agent' } })
    fireEvent.change(screen.getByLabelText('説明（任意）'), {
      target: { value: 'ResearchDistillator' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /読み取り専用エージェント/ }))
    fireEvent.click(createButton())

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Research agent',
        description: 'ResearchDistillator',
        scopes: ['tasks:read', 'context:read'],
      }),
    )
  })

  it('omits the description when it is empty', async () => {
    const { onCreate } = renderDialog()

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Agent' } })
    fireEvent.click(scopeBox('artifacts:write'))
    fireEvent.click(scopeBox('tasks:read'))
    fireEvent.click(createButton())

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Agent',
        scopes: ['tasks:read', 'artifacts:write'],
      }),
    )
  })

  it('closes and resets the form after a successful creation', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Agent' } })
    fireEvent.click(scopeBox('tasks:read'))
    fireEvent.click(createButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByLabelText('名前')).toHaveValue('')
    expect(scopeBox('tasks:read')).not.toBeChecked()
  })

  it('keeps the input when creation fails', async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error('boom'))
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Agent' } })
    fireEvent.click(scopeBox('tasks:read'))
    fireEvent.click(createButton())

    expect(await screen.findByText('エージェントトークンの作成に失敗しました')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('名前')).toHaveValue('Agent')
    expect(scopeBox('tasks:read')).toBeChecked()
    expect(createButton()).toBeEnabled()
  })

  it('disables the create button while submitting', async () => {
    let resolveCreate: () => void = () => {}
    const onCreate = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Agent' } })
    fireEvent.click(scopeBox('tasks:read'))
    fireEvent.click(createButton())

    await waitFor(() => expect(createButton()).toBeDisabled())
    fireEvent.click(createButton())
    expect(onCreate).toHaveBeenCalledTimes(1)

    resolveCreate()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('ignores close requests while submitting and keeps the input on failure', async () => {
    let rejectCreate: (reason: Error) => void = () => {}
    const onCreate = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCreate = reject
        }),
    )
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'Agent' } })
    fireEvent.click(scopeBox('tasks:read'))
    fireEvent.click(createButton())

    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    await waitFor(() => expect(cancel).toBeDisabled())
    fireEvent.click(cancel)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()

    rejectCreate(new Error('boom'))

    expect(await screen.findByText('エージェントトークンの作成に失敗しました')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('名前')).toHaveValue('Agent')
    expect(scopeBox('tasks:read')).toBeChecked()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
  })
})
