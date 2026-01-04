'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import { logger } from '@/lib/logger'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the hash fragment from the URL
        const hash = window.location.hash
        if (!hash) {
          throw new Error('No authentication data found')
        }

        // Handle the auth callback
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          logger.error('Authentication callback error', new Error(error.message), { component: 'AuthCallbackPage' })
          toast({
            title: '認証に失敗しました',
            description: error.message || 'メール認証に失敗しました',
            variant: 'destructive',
          })
          router.push('/login')
          return
        }

        if (data.session) {
          toast({
            title: '認証完了',
            description: 'メール認証が完了しました。ダッシュボードにリダイレクトしています。',
          })
          router.push('/dashboard')
        } else {
          // No active session, redirect to login
          router.push('/login')
        }
      } catch (error) {
        logger.error('Authentication callback failed', error instanceof Error ? error : new Error(String(error)), { component: 'AuthCallbackPage' })
        toast({
          title: '認証エラー',
          description: error instanceof Error ? error.message : '認証処理でエラーが発生しました',
          variant: 'destructive',
        })
        router.push('/login')
      }
    }

    handleAuthCallback()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" />
        <h1 className="text-xl font-semibold mb-2">認証を処理しています...</h1>
        <p className="text-gray-600 dark:text-gray-400">
          少々お待ちください
        </p>
      </div>
    </div>
  )
}
