'use client'

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from '@/components/auth-provider'
import {
  projectKeys,
  useProjectOptions,
} from '@/hooks/use-project-query'

function ProjectCacheWarmer({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const { data: projects } = useProjectOptions({ enabled })

  useEffect(() => {
    projects?.forEach((project) => {
      if (!queryClient.getQueryData(projectKeys.detail(project.id))) {
        queryClient.setQueryData(projectKeys.detail(project.id), project)
      }
    })
  }, [projects, queryClient])

  return null
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 60 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
        },
      }),
  )
  const previousCacheIdentity = useRef(cacheIdentity)

  // This must happen during render: an effect would let children render once
  // with the previous user's cache before the identity boundary was applied.
  if (previousCacheIdentity.current !== cacheIdentity) {
    queryClient.clear()
    previousCacheIdentity.current = cacheIdentity
  }

  useEffect(() => () => queryClient.clear(), [queryClient])

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
 * Clears the cache at authentication boundaries so one user's data can never
 * be shown to another user without remounting the application subtree, and
 * warms stable project metadata after sign-in for instant client navigation.
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
