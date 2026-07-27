// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { useQueryClient } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'

const mockGetAll = jest.fn()
let authState: {
  user: { id: string } | null
  loading: boolean
}

jest.mock('@/components/auth-provider', () => ({
  useAuthContext: () => authState,
}))

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: (...args: unknown[]) => mockGetAll(...args),
  },
}))

import { QueryProvider } from '@/components/query-provider'

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authState = { user: null, loading: true }
    mockGetAll.mockResolvedValue([])
  })

  it('warms the shared project cache after authentication', async () => {
    const view = render(
      <QueryProvider>
        <div>Application</div>
      </QueryProvider>,
    )

    expect(mockGetAll).not.toHaveBeenCalled()

    authState = { user: { id: 'user-1' }, loading: false }
    view.rerender(
      <QueryProvider>
        <div>Application</div>
      </QueryProvider>,
    )

    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledWith(0, 100)
    })
  })

  it('keeps one client during normal navigation', () => {
    authState = { user: { id: 'user-1' }, loading: false }
    const clients: ReturnType<typeof useQueryClient>[] = []

    function Child() {
      clients.push(useQueryClient())
      return null
    }

    const view = render(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(clients[0]).toBe(clients.at(-1))
  })

  it('uses a fresh cache when the authenticated identity changes', () => {
    authState = { user: { id: 'user-1' }, loading: false }
    let queryClient: ReturnType<typeof useQueryClient> | undefined

    function Child() {
      queryClient = useQueryClient()
      return null
    }

    const view = render(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )
    const userOneClient = queryClient
    act(() => {
      userOneClient?.setQueryData(['private-data'], 'user-1-data')
    })

    authState = { user: { id: 'user-2' }, loading: false }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient).not.toBe(userOneClient)
    expect(queryClient?.getQueryData(['private-data'])).toBeUndefined()
  })
})
