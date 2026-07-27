// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

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

  it('does not remount children when initial authentication resolves', () => {
    const mounted = jest.fn()
    const unmounted = jest.fn()
    let queryClient: ReturnType<typeof useQueryClient> | undefined

    function Child() {
      queryClient = useQueryClient()
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return null
    }

    const view = render(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )
    const loadingClient = queryClient

    authState = { user: { id: 'user-1' }, loading: false }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient).toBe(loadingClient)
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('clears the same client when the authenticated identity changes', async () => {
    authState = { user: { id: 'user-1' }, loading: false }
    let queryClient: ReturnType<typeof useQueryClient> | undefined

    function Child() {
      queryClient = useQueryClient()
      const privateQuery = useQuery({
        queryKey: ['private-data'],
        queryFn: async () => 'fetched-data',
        enabled: false,
      })
      return <div>{privateQuery.data ?? 'empty'}</div>
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
    await waitFor(() => {
      expect(screen.getByText('user-1-data')).toBeInTheDocument()
    })

    authState = { user: { id: 'user-2' }, loading: false }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient).toBe(userOneClient)
    await waitFor(() => {
      expect(screen.getByText('empty')).toBeInTheDocument()
    })
  })
})
