'use client'

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useState } from 'react'
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
}: {
  children: React.ReactNode
  warmProjects: boolean
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
 * Recreates the cache at authentication boundaries so one user's data can
 * never be shown to another user, and warms stable project metadata after
 * sign-in for instant client-side navigation.
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
