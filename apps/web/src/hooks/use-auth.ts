'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
      setInitialLoad(false)
    }

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)

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
  }, [router, initialLoad, pathname])

  const signOut = async () => {
    try {
      setLoading(true)
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error: unknown) {
      toast({
        title: 'エラー',
        description: error instanceof Error ? error.message : 'エラーが発生しました',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return {
    user,
    loading,
    signOut,
    isAuthenticated: !!user,
  }
}