import React from 'react'
import { renderHook, type RenderHookOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a fresh QueryClient for each test with test-friendly settings
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

// Wrapper component with QueryClient
export const createWrapper = (queryClient?: QueryClient) => {
  const client = queryClient || createTestQueryClient()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

// Custom renderHook with QueryClient - returns both the hook result and the queryClient
export const renderHookWithClient = <TResult, TProps>(
  render: (initialProps: TProps) => TResult,
  options?: RenderHookOptions<TProps> & { queryClient?: QueryClient }
) => {
  const { queryClient, ...renderOptions } = options || {}
  const client = queryClient || createTestQueryClient()

  return {
    ...renderHook(render, {
      wrapper: createWrapper(client),
      ...renderOptions,
    }),
    queryClient: client,
  }
}

// Wait for a hook's loading state to complete
export const waitForLoadingToFinish = async (
  result: { current: { isLoading?: boolean; loading?: boolean; isPending?: boolean } },
  options?: { timeout?: number }
) => {
  const { waitFor } = await import('@testing-library/react')
  await waitFor(
    () => {
      const isLoading = result.current.isLoading ?? result.current.loading ?? result.current.isPending
      expect(isLoading).toBe(false)
    },
    { timeout: options?.timeout ?? 5000 }
  )
}

// Wait for mutation to complete (useful for useMutation hooks)
export const waitForMutationToSettle = async (
  result: { current: { isPending?: boolean; isLoading?: boolean } },
  options?: { timeout?: number }
) => {
  const { waitFor } = await import('@testing-library/react')
  await waitFor(
    () => {
      const isPending = result.current.isPending ?? result.current.isLoading
      expect(isPending).toBe(false)
    },
    { timeout: options?.timeout ?? 5000 }
  )
}

// Helper to wait for next tick (useful for async state updates)
export const waitForNextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

// Helper to flush all promises (cross-platform compatible)
export const flushPromises = () => Promise.resolve()
