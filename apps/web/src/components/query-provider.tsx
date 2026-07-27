'use client'

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useState } from 'react'
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
        refetchOnReconnect: true,
      },
    },
  })
}

function AuthenticatedQueryClient({
  children,
  warmProjects,
  cacheIdentity,
}: {
  children: React.ReactNode
  warmProjects: boolean
  cacheIdentity: string
}) {
  const [clientState, setClientState] = useState(() => ({
    queryClient: createQueryClient(),
    resolvedIdentity:
      cacheIdentity === 'auth-loading' ? null : cacheIdentity,
    generation: 0,
    retiredClients: [] as QueryClient[],
  }))

  // Derive the boundary during render. An effect would let children render
  // once with the previous user's cache. The initial auth resolution reuses
  // the empty client; later identity changes receive a fresh keyed provider.
  if (
    cacheIdentity !== 'auth-loading' &&
    clientState.resolvedIdentity !== cacheIdentity
  ) {
    const isInitialResolution =
      clientState.resolvedIdentity === null ||
      clientState.resolvedIdentity === 'anonymous'
    setClientState({
      queryClient: isInitialResolution
        ? clientState.queryClient
        : createQueryClient(),
      resolvedIdentity: cacheIdentity,
      generation: isInitialResolution
        ? clientState.generation
        : clientState.generation + 1,
      retiredClients: isInitialResolution
        ? clientState.retiredClients
        : [...clientState.retiredClients, clientState.queryClient],
    })
  }

  useEffect(() => {
    const retiredClients = clientState.retiredClients
    if (retiredClients.length === 0) return

    retiredClients.forEach((client) => client.clear())
    setClientState((current) => {
      const pendingRetiredClients = current.retiredClients.filter(
        (client) => !retiredClients.includes(client),
      )

      return pendingRetiredClients.length === current.retiredClients.length
        ? current
        : { ...current, retiredClients: pendingRetiredClients }
    })
  }, [clientState.retiredClients])

  return (
    <QueryClientProvider
      key={clientState.generation}
      client={clientState.queryClient}
    >
      <ProjectCacheWarmer enabled={warmProjects} />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

/**
 * React Query provider component.
 * Uses a fresh cache at resolved authentication boundaries so one user's data
 * can never be shown to another user, while avoiding a subtree remount during
 * the initial session lookup. Stable project metadata is warmed after sign-in.
 *
 * @param props - Component props
 * @param props.children - Child components to wrap with query context
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  const cacheIdentity = loading ? 'auth-loading' : (user?.id ?? 'anonymous')

  return (
    <AuthenticatedQueryClient
      cacheIdentity={cacheIdentity}
      warmProjects={!loading && Boolean(user)}
    >
      {children}
    </AuthenticatedQueryClient>
  )
}
