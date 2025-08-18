"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Calendar, Target, CheckCircle, TrendingUp, Eye } from 'lucide-react'
import type { TimelineOverviewData } from '@/types/timeline'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

interface TimelineOverviewProps {
  data: TimelineOverviewData | null
  isLoading: boolean
  error?: string | null
  onProjectSelect: (projectId: string) => void
}

export function TimelineOverview({ data, isLoading, error, onProjectSelect }: TimelineOverviewProps) {
  const formatDate = (dateString: string) => {
    return format(parseISO(dateString), 'MM/dd', { locale: ja })
  }

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-5 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                <div className="h-8 bg-gray-200 rounded"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン概要
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-500 mb-2">エラーが発生しました</p>
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン概要
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-center py-8">
            プロジェクトが見つかりません。まずはプロジェクトを作成してください。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            プロジェクトタイムライン概要
          </CardTitle>
          <p className="text-sm text-gray-500">
            期間: {format(parseISO(data.timeline.start_date), 'yyyy年MM月dd日', { locale: ja })} ～ {format(parseISO(data.timeline.end_date), 'yyyy年MM月dd日', { locale: ja })}
          </p>
        </CardHeader>
      </Card>

      {/* Projects Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.projects.map((project) => (
          <Card key={project.id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg line-clamp-2 mb-1">
                    {project.title}
                  </CardTitle>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {project.description || 'プロジェクトの説明がありません'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>作成: {formatDate(project.created_at)}</span>
                <span>•</span>
                <span>更新: {formatDate(project.updated_at)}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Goal Statistics */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Target className="w-4 h-4" />
                    ゴール進捗
                  </span>
                  <Badge variant="outline">
                    {project.statistics.completed_goals}/{project.statistics.total_goals}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <Progress
                    value={project.statistics.goals_completion_rate}
                    className="h-2"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{project.statistics.goals_completion_rate}% 完了</span>
                    <span>{project.statistics.in_progress_goals} 進行中</span>
                  </div>
                </div>
              </div>

              {/* Task Statistics */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    タスク進捗
                  </span>
                  <Badge variant="outline">
                    {project.statistics.completed_tasks}/{project.statistics.total_tasks}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <Progress
                    value={project.statistics.tasks_completion_rate}
                    className="h-2"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{project.statistics.tasks_completion_rate}% 完了</span>
                    <span>{project.statistics.in_progress_tasks} 進行中</span>
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {project.statistics.total_goals}
                  </div>
                  <div className="text-xs text-blue-600">ゴール数</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {project.statistics.total_tasks}
                  </div>
                  <div className="text-xs text-green-600">タスク数</div>
                </div>
              </div>

              {/* Action Button */}
              <Button
                onClick={() => onProjectSelect(project.id)}
                className="w-full mt-4"
                variant="outline"
              >
                <Eye className="w-4 h-4 mr-2" />
                タイムライン詳細
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            全体統計
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {data.projects.length}
              </div>
              <div className="text-sm text-gray-500">プロジェクト数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {data.projects.reduce((sum, p) => sum + p.statistics.total_goals, 0)}
              </div>
              <div className="text-sm text-gray-500">総ゴール数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {data.projects.reduce((sum, p) => sum + p.statistics.total_tasks, 0)}
              </div>
              <div className="text-sm text-gray-500">総タスク数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(
                  data.projects.reduce((sum, p) => sum + p.statistics.tasks_completion_rate, 0) /
                  data.projects.length
                )}%
              </div>
              <div className="text-sm text-gray-500">平均完了率</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
