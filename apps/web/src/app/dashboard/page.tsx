'use client'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Plus, Brain, Settings, Clock, ExternalLink, History } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { schedulingApi } from '@/lib/api'
import Link from 'next/link'

export default function DashboardPage() {
  const { user, loading, signOut, isAuthenticated } = useAuth()
  const router = useRouter()
  const [todaySchedule, setTodaySchedule] = useState<{
    plan_json: {
      assignments: Array<{
        task_title: string;
        start_time: string;
        duration_hours: number;
        slot_kind: string;
        project_id: string;
        goal_id: string;
      }>;
      total_scheduled_hours: number;
      unscheduled_tasks: Array<unknown>;
    };
  } | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(true)

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login')
    }
  }, [loading, isAuthenticated, router])

  useEffect(() => {
    const fetchTodaySchedule = async () => {
      if (!isAuthenticated) return
      
      try {
        const today = new Date().toISOString().split('T')[0]
        const schedule = await schedulingApi.getByDate(today as string)
        setTodaySchedule(schedule)
      } catch (error) {
        console.log('No schedule found for today')
      } finally {
        setScheduleLoading(false)
      }
    }
    
    fetchTodaySchedule()
  }, [isAuthenticated])

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
                <Button 
                  variant="ghost" 
                  onClick={() => router.push('/schedule-history')}
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  スケジュール履歴
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/schedule-history')}
          >
            <CardHeader className="text-center pb-4">
              <History className="h-8 w-8 text-orange-600 mx-auto mb-2" />
              <CardTitle className="text-lg">スケジュール履歴</CardTitle>
              <CardDescription>過去のスケジュールを確認</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Today's Schedule */}
        {!scheduleLoading && todaySchedule && todaySchedule.plan_json?.assignments?.length > 0 && (
          <div className="mb-8">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-blue-600" />
                      本日のスケジュール
                    </CardTitle>
                    <CardDescription>
                      {new Date().toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric', 
                        weekday: 'long' 
                      })}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => router.push('/schedule-history')}
                      className="flex items-center gap-1"
                    >
                      <History className="h-3 w-3" />
                      履歴
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => router.push('/scheduling')}
                    >
                      スケジュール編集
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {todaySchedule.plan_json.assignments.map((assignment, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold text-gray-600">
                          {assignment.start_time}
                        </div>
                        <div>
                          <div className="font-medium">{assignment.task_title}</div>
                          <div className="text-sm text-gray-500 flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            {assignment.duration_hours.toFixed(1)}時間
                            <span className="text-gray-400">•</span>
                            <Badge variant="outline" className="text-xs">
                              {assignment.slot_kind === 'deep' ? '集中作業' :
                               assignment.slot_kind === 'light' ? '軽作業' :
                               assignment.slot_kind === 'study' ? '学習' : '会議'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {assignment.project_id && assignment.goal_id && (
                        <Link 
                          href={`/projects/${assignment.project_id}/goals/${assignment.goal_id}`}
                          className="text-blue-500 hover:text-blue-700 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">総スケジュール時間</span>
                    <span className="font-semibold">
                      {todaySchedule.plan_json.total_scheduled_hours.toFixed(1)}時間
                    </span>
                  </div>
                  {todaySchedule.plan_json.unscheduled_tasks?.length > 0 && (
                    <div className="mt-2 text-sm text-orange-600">
                      未スケジュール: {todaySchedule.plan_json.unscheduled_tasks.length}個のタスク
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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