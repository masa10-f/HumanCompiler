"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from 'lucide-react'
import type { TimelineOverviewData } from '@/types/timeline'

interface TimelineOverviewProps {
  data: TimelineOverviewData | null
  isLoading: boolean
  error?: string | null
  onProjectSelect: (projectId: string) => void
}

export function TimelineOverview({ data, isLoading, error, onProjectSelect }: TimelineOverviewProps) {

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p>タイムラインを読み込み中...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-red-500">エラー: {error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!data || !data.projects) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500">プロジェクトが見つかりません</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          プロジェクトタイムライン概要
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600 mb-4">プロジェクト数: {data.projects.length}個</p>
        <div className="mt-4">
          <h3 className="font-semibold mb-3">プロジェクト一覧:</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.projects.map((project, index) => (
              <div key={`${project.id}-${index}`} className="p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{project.title}</p>
                    <p className="text-sm text-gray-600 mt-1">{project.description || '説明なし'}</p>
                  </div>
                  <button
                    className="ml-3 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors"
                    onClick={() => onProjectSelect(project.id)}
                  >
                    詳細を見る
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
