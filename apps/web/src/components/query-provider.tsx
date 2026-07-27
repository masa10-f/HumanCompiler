'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'
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

function AuthenticatedQueryClient({
  children,
  warmProjects,
}: {
  children: React.ReactNode
  warmProjects: boolean
}) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ProjectCacheWarmer enabled={warmProjects} />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

/**
 * React Query provider component.
 * Uses a fresh cache at authentication boundaries and warms project metadata
 * after sign-in. Normal client-side navigation keeps the same cache.
 *
 * @param props - Component props
 * @param props.children - Child components to wrap with query context
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  const cacheIdentity = loading ? 'auth-loading' : (user?.id ?? 'anonymous')

  return (
    <AuthenticatedQueryClient
      key={cacheIdentity}
      warmProjects={!loading && Boolean(user)}
    >
      {children}
    </AuthenticatedQueryClient>
  )
}
