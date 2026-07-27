/**
 * @jest-environment jsdom
 */
import { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'

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

  it('waits for auth before mounting the application subtree', async () => {
    const mounted = jest.fn()

    function Child() {
      useEffect(() => {
        mounted()
      }, [])

      return <div>Application</div>
    }

    const view = render(
      <QueryProvider>
        <Child />
      </QueryProvider>,
    )

    expect(view.queryByText('Application')).not.toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()

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
    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledTimes(1)
    })
  })
})
