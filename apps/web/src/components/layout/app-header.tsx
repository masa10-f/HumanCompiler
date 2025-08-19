"use client"

import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Key, TrendingUp } from 'lucide-react'

interface AppHeaderProps {
  currentPage?: 'dashboard' | 'projects' | 'ai-planning' | 'scheduling' | 'schedule-history' | 'timeline' | 'settings'
}

export function AppHeader({ currentPage }: AppHeaderProps) {
  const router = useRouter()
  const { user, signOut } = useAuth()

  const getPageClass = (page: string) => {
    return currentPage === page
      ? "text-gray-900 dark:text-white font-medium"
      : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
  }

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              TaskAgent
            </h1>
            <nav className="hidden md:flex space-x-4">
              <Button
                variant="ghost"
                onClick={() => router.push('/dashboard')}
                className={getPageClass('dashboard')}
              >
                ダッシュボード
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/projects')}
                className={getPageClass('projects')}
              >
                プロジェクト
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/ai-planning')}
                className={getPageClass('ai-planning')}
              >
                AI計画
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/scheduling')}
                className={getPageClass('scheduling')}
              >
                スケジューリング
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/schedule-history')}
                className={getPageClass('schedule-history')}
              >
                スケジュール履歴
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/timeline')}
                className={getPageClass('timeline')}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                タイムライン
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/settings')}
                className={getPageClass('settings')}
              >
                <Key className="h-4 w-4 mr-2" />
                設定
              </Button>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            {user?.email && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {user.email}
              </span>
            )}
            <Button variant="outline" onClick={signOut}>
              ログアウト
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
