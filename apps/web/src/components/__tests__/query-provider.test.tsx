/**
 * @jest-environment jsdom
 */
import { useEffect } from 'react'
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

    authState = {
      user: { id: 'user-2' },
      loading: false,
    }
    view.rerender(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(queryClient?.getQueryData(['private-data'])).toBeUndefined()
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()

    view.unmount()
    expect(unmounted).toHaveBeenCalledTimes(1)
  })
})
