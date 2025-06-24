'use client'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, Plus, Target, TrendingUp, Brain, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DashboardPage() {
  const { user, loading, signOut, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login')
    }
  }, [loading, isAuthenticated, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
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
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  ダッシュボード
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => router.push('/projects')}
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  プロジェクト
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => router.push('/ai-planning')}
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  AI計画
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => router.push('/scheduling')}
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  スケジューリング
                </Button>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {user?.email}
              </span>
              <Button variant="outline" onClick={signOut}>
                ログアウト
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            ダッシュボード
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            ようこそ！プロジェクトとタスクを管理しましょう。
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/projects')}
          >
            <CardHeader className="text-center pb-4">
              <Plus className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <CardTitle className="text-lg">プロジェクト管理</CardTitle>
              <CardDescription>プロジェクト・ゴール・タスクを管理</CardDescription>
            </CardHeader>
          </Card>

          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/ai-planning')}
          >
            <CardHeader className="text-center pb-4">
              <Brain className="h-8 w-8 text-purple-600 mx-auto mb-2" />
              <CardTitle className="text-lg">AI週間計画</CardTitle>
              <CardDescription>AIによる最適な週間計画生成</CardDescription>
            </CardHeader>
          </Card>

          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/scheduling')}
          >
            <CardHeader className="text-center pb-4">
              <Settings className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <CardTitle className="text-lg">スケジュール最適化</CardTitle>
              <CardDescription>OR-Toolsによる制約最適化</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Recent Projects */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>最近のプロジェクト</CardTitle>
              <CardDescription>
                進行中のプロジェクト一覧
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <p>まだプロジェクトがありません</p>
                <Button className="mt-4" onClick={() => router.push('/projects')}>
                  最初のプロジェクトを作成
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>今日のタスク</CardTitle>
              <CardDescription>
                本日予定されているタスク
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <p>本日のタスクはありません</p>
                <Button className="mt-4">
                  タスクを追加
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}