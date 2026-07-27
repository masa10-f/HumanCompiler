'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuthContext } from '@/components/auth-provider'
import { useProjectOptions } from '@/hooks/use-project-query'

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

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
 * Replaces cached server data when the resolved user changes and warms project
 * metadata after sign-in. Normal navigation keeps component state.
 *
 * @param props - Component props
 * @param props.children - Child components to wrap with query context
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  const [{ queryClient, generation }, setQueryState] = useState(() => ({
    queryClient: createQueryClient(),
    generation: 0,
  }))
  const previousIdentity = useRef<string | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (loading) return

    const identity = user?.id ?? 'anonymous'
    if (
      previousIdentity.current !== null &&
      previousIdentity.current !== identity
    ) {
      setQueryState((previous) => ({
        queryClient: createQueryClient(),
        generation: previous.generation + 1,
      }))
    }
    previousIdentity.current = identity
  }, [loading, user?.id])

  return (
    <QueryClientProvider client={queryClient} key={generation}>
      <ProjectCacheWarmer enabled={!loading && Boolean(user)} />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
