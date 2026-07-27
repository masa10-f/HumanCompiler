// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { StrictMode, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'

const mockGetAll = jest.fn()
let authState: {
  user: { id: string } | null
  loading: boolean
} = {
  user: null,
  loading: true,
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
    authState = {
      user: null,
      loading: true,
    }
    mockGetAll.mockResolvedValue([])
  })

  it('renders during auth loading without remounting when auth resolves', async () => {
    const mounted = jest.fn()
    const unmounted = jest.fn()
    let queryClient: ReturnType<typeof useQueryClient> | undefined

    function Child() {
      queryClient = useQueryClient()

      useEffect(() => {
        mounted()
        return unmounted
      }, [])

      return <div>Application</div>
    }

    const view = render(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(view.getByText('Application')).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(mockGetAll).not.toHaveBeenCalled()

    authState = {
      user: { id: 'user-1' },
      loading: false,
    }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(view.getByText('Application')).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledTimes(1)
    })

    act(() => {
      queryClient?.setQueryData(['private-data'], 'user-1-data')
    })
    const userOneQueryClient = queryClient

    authState = {
      user: { id: 'user-2' },
      loading: false,
    }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient).not.toBe(userOneQueryClient)
    expect(queryClient?.getQueryData(['private-data'])).toBeUndefined()
    expect(userOneQueryClient?.getQueryData(['private-data'])).toBeUndefined()
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(unmounted).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(unmounted).toHaveBeenCalledTimes(2)
  })

  it('does not clear the live cache during StrictMode effect replay', async () => {
    let queryClient: ReturnType<typeof useQueryClient> | undefined
    const project = {
      id: 'project-1',
      owner_id: 'user-1',
      title: 'Project',
      description: null,
      status: 'in_progress',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    authState = {
      user: { id: 'user-1' },
      loading: false,
    }
    mockGetAll.mockResolvedValue([project])

    function Child() {
      queryClient = useQueryClient()
      return null
    }

    render(
      <StrictMode>
        <QueryProvider>
          <Child />
        </QueryProvider>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(queryClient?.getQueryData(['projects', 'options'])).toEqual([
        project,
      ])
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  it('does not remount when an anonymous initial resolution is corrected', async () => {
    authState = {
      user: null,
      loading: false,
    }
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
    const anonymousQueryClient = queryClient

    authState = {
      user: { id: 'user-1' },
      loading: false,
    }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient).toBe(anonymousQueryClient)
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledTimes(1)
    })
  })

})
