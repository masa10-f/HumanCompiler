'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'
import { useOptionalAuthContext } from '@/components/auth-provider'

/**
 * Authentication hook for Supabase auth integration.
 * Manages user session state and provides sign out functionality.
 * Handles automatic redirects on auth state changes.
 *
 * @returns Authentication state and methods
 *
 * @example
 * ```tsx
 * const { user, loading, signOut, isAuthenticated } = useAuth();
 * if (loading) return <Loading />;
 * if (!isAuthenticated) redirect('/login');
 * ```
 */
export function useAuth() {
  const providerAuth = useOptionalAuthContext()
  const [localUser, setLocalUser] = useState<User | null>(null)
  const [localSession, setLocalSession] = useState<Session | null>(null)
  const [localLoading, setLocalLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (providerAuth) return

    // Get initial session
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setLocalUser(session?.user ?? null)
      setLocalSession(session)
      setLocalLoading(false)
      setInitialLoad(false)
    }

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setLocalUser(session?.user ?? null)
        setLocalSession(session)
        setLocalLoading(false)

        // Only redirect on actual sign in/out events, not on session restoration
        if (event === 'SIGNED_IN' && !initialLoad) {
          // Only redirect to dashboard if we're on login/signup pages
          const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/'
          if (isAuthPage) {
            toast({
              title: 'ログインしました',
              description: 'TaskAgentへようこそ！',
            })
            router.push('/dashboard')
          }
        } else if (event === 'SIGNED_OUT') {
          toast({
            title: 'ログアウトしました',
            description: 'またのご利用をお待ちしております。',
          })
          router.push('/')
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [providerAuth, router, initialLoad, pathname])

  const signOut = async () => {
    try {
      setIsSigningOut(true)
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      if (providerAuth) {
        toast({
          title: 'ログアウトしました',
          description: 'またのご利用をお待ちしております。',
        })
        router.push('/')
      }
    } catch (error: unknown) {
      toast({
        title: 'エラー',
        description: error instanceof Error ? error.message : 'エラーが発生しました',
        variant: 'destructive',
      })
    } finally {
      setIsSigningOut(false)
    }
  }

  const user = providerAuth?.user ?? localUser
  const session = providerAuth?.session ?? localSession
  const loading = (providerAuth?.loading ?? localLoading) || isSigningOut

  return {
    user,
    session,
    loading,
    signOut,
    isAuthenticated: !!user,
  }
}
