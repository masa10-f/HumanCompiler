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
  // Debug: Add console logs to track re-renders
  console.log('🔍 [TimelineOverview] Render count:', Date.now())
  console.log('🔍 [TimelineOverview] Props:', { data, isLoading, error })

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

  // Temporary simplified rendering to test if the array map is the issue
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          プロジェクトタイムライン概要 (簡易版)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>プロジェクト数: {data.projects.length}</p>
        {/* Temporarily remove the problematic map to test */}
        <div className="mt-4">
          <h3>プロジェクト一覧:</h3>
          {data.projects.slice(0, 3).map((project, index) => (
            <div key={`${project.id}-${index}`} className="p-2 border rounded mt-2">
              <p className="font-medium">{project.title}</p>
              <p className="text-sm text-gray-600">{project.description || '説明なし'}</p>
              <button
                className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm"
                onClick={() => {
                  console.log('Button clicked for project:', project.id)
                  onProjectSelect(project.id)
                }}
              >
                詳細を見る
              </button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
