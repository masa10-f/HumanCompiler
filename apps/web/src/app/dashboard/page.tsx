'use client'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, Plus, Target, TrendingUp } from 'lucide-react'
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
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                TaskAgent
              </h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="text-center pb-4">
              <Plus className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <CardTitle className="text-lg">新しいプロジェクト</CardTitle>
              <CardDescription>プロジェクトを作成する</CardDescription>
            </CardHeader>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="text-center pb-4">
              <Target className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <CardTitle className="text-lg">ゴール設定</CardTitle>
              <CardDescription>週間目標を設定する</CardDescription>
            </CardHeader>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="text-center pb-4">
              <Calendar className="h-8 w-8 text-purple-600 mx-auto mb-2" />
              <CardTitle className="text-lg">スケジュール</CardTitle>
              <CardDescription>日程を最適化する</CardDescription>
            </CardHeader>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="text-center pb-4">
              <TrendingUp className="h-8 w-8 text-orange-600 mx-auto mb-2" />
              <CardTitle className="text-lg">進捗レポート</CardTitle>
              <CardDescription>進捗を確認する</CardDescription>
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
                <Button className="mt-4">
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