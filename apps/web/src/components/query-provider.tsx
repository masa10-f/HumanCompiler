'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAuthContext } from '@/components/auth-provider'
import { useProjectOptions } from '@/hooks/use-project-query'

function ProjectCacheWarmer({ enabled }: { enabled: boolean }) {
  useProjectOptions({ enabled })
  return null
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/**
 * React Query provider component.
 * Clears cached server data when the resolved identity changes and warms
 * project metadata after sign-in. Normal navigation keeps component state.
 *
 * @param props - Component props
 * @param props.children - Child components to wrap with query context
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  const [queryClient] = useState(createQueryClient)
  const previousIdentity = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (loading) return

    const identity = user?.id ?? 'anonymous'
    if (
      previousIdentity.current !== null &&
      previousIdentity.current !== identity
    ) {
      queryClient.getMutationCache().clear()
      void queryClient.resetQueries()
    }
    previousIdentity.current = identity
  }, [loading, queryClient, user?.id])

  return (
    <QueryClientProvider client={queryClient}>
      <ProjectCacheWarmer enabled={!loading && Boolean(user)} />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
