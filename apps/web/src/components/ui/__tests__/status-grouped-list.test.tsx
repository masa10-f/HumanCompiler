// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { StatusGroupedList } from '../status-grouped-list'
import type { StatusGroup } from '@/lib/status-groups'

type Item = { id: string; title: string }

const STORAGE_KEY = 'humancompiler:status-groups:test:closed-open'

const groups = (
  inProgress: Item[],
  pending: Item[],
  closed: Item[],
): StatusGroup<Item>[] => [
  { key: 'in_progress', label: '進行中', items: inProgress },
  { key: 'pending', label: '未着手', items: pending },
  { key: 'closed', label: '完了・キャンセル', items: closed },
]

const renderList = (value: StatusGroup<Item>[]) =>
  render(
    <StatusGroupedList
      groups={value}
      storageKey="test"
      renderItem={(item) => <div>{item.title}</div>}
    />,
  )

describe('StatusGroupedList', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows active groups in order and collapses the closed group', () => {
    renderList(
      groups(
        [{ id: '1', title: '進行中のもの' }],
        [{ id: '2', title: '未着手のもの' }],
        [{ id: '3', title: '完了したもの' }],
      ),
    )

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings).toEqual(['進行中1', '未着手1', '完了・キャンセル1'])
    expect(screen.getByText('進行中のもの')).toBeInTheDocument()
    expect(screen.getByText('未着手のもの')).toBeInTheDocument()
    expect(screen.queryByText('完了したもの')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /完了・キャンセル/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('omits empty groups', () => {
    renderList(groups([], [{ id: '2', title: '未着手のもの' }], []))

    expect(screen.queryByRole('heading', { name: /進行中/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /完了・キャンセル/ })).not.toBeInTheDocument()
  })

  it('expands closed items on click and remembers the choice', async () => {
    renderList(
      groups([{ id: '1', title: '進行中のもの' }], [], [{ id: '3', title: '完了したもの' }]),
    )

    fireEvent.click(screen.getByRole('button', { name: /完了・キャンセル/ }))

    expect(await screen.findByText('完了したもの')).toBeInTheDocument()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('restores a remembered expanded state', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')

    renderList(
      groups([{ id: '1', title: '進行中のもの' }], [], [{ id: '3', title: '完了したもの' }]),
    )

    expect(await screen.findByText('完了したもの')).toBeInTheDocument()
  })

  it('opens the closed group when nothing else is left', async () => {
    renderList(groups([], [], [{ id: '3', title: '完了したもの' }]))

    await waitFor(() => {
      expect(screen.getByText('完了したもの')).toBeInTheDocument()
    })
  })

  it('opens the closed group once it becomes the only group left', async () => {
    const { rerender } = renderList(
      groups([{ id: '1', title: '進行中のもの' }], [], [{ id: '3', title: '完了したもの' }]),
    )
    expect(screen.queryByText('完了したもの')).not.toBeInTheDocument()

    rerender(
      <StatusGroupedList
        groups={groups(
          [],
          [],
          [
            { id: '1', title: '進行中のもの' },
            { id: '3', title: '完了したもの' },
          ],
        )}
        storageKey="test"
        renderItem={(item) => <div>{item.title}</div>}
      />,
    )

    expect(await screen.findByText('完了したもの')).toBeInTheDocument()
  })

  it('collapses the closed group again when open work comes back', async () => {
    const { rerender } = renderList(groups([], [], [{ id: '3', title: '完了したもの' }]))
    expect(await screen.findByText('完了したもの')).toBeInTheDocument()

    rerender(
      <StatusGroupedList
        groups={groups([], [{ id: '4', title: '新しいもの' }], [{ id: '3', title: '完了したもの' }])}
        storageKey="test"
        renderItem={(item) => <div>{item.title}</div>}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByText('完了したもの')).not.toBeInTheDocument()
    })
    expect(screen.getByText('新しいもの')).toBeInTheDocument()
  })

  it('keeps a stored expanded choice when open work comes back', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    const { rerender } = renderList(groups([], [], [{ id: '3', title: '完了したもの' }]))
    expect(await screen.findByText('完了したもの')).toBeInTheDocument()

    rerender(
      <StatusGroupedList
        groups={groups([], [{ id: '4', title: '新しいもの' }], [{ id: '3', title: '完了したもの' }])}
        storageKey="test"
        renderItem={(item) => <div>{item.title}</div>}
      />,
    )

    expect(screen.getByText('新しいもの')).toBeInTheDocument()
    expect(screen.getByText('完了したもの')).toBeInTheDocument()
  })

  it('keeps a stored collapsed choice when the closed group is the only one left', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'false')

    renderList(groups([], [], [{ id: '3', title: '完了したもの' }]))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /完了・キャンセル/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })
    expect(screen.queryByText('完了したもの')).not.toBeInTheDocument()
  })
})
