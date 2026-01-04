'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useProjectPageState } from '@/hooks/use-project-page-state'
import { AppHeader } from '@/components/layout/app-header'
import { ProjectHeader } from '@/components/projects/project-header'
import { ProjectProgressCard } from '@/components/progress/progress-card'
import { GoalList } from '@/components/goals/goal-list'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function ProjectDetailPage() {
  const params = useParams()
  const id = params.id as string

  const {
    project,
    projectLoading,
    projectError,
    refetchProject,
    goals,
    goalsLoading,
    goalsError,
    refetchGoals,
    projectProgress,
    router,
    isInitializing,
    shouldRedirect,
  } = useProjectPageState(id)

  useEffect(() => {
    if (shouldRedirect) {
      router.push('/login')
    }
  }, [shouldRedirect, router])

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (projectLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <div className="text-lg">プロジェクトを読み込み中...</div>
        </div>
      </div>
    )
  }

  if (projectError || (!projectLoading && !project)) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            エラー: {projectError?.message || 'プロジェクトが見つかりません'}
          </div>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => refetchProject()}>再試行</Button>
            <Button variant="outline" onClick={() => router.push('/projects')}>
              プロジェクト一覧に戻る
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      <div className="container mx-auto py-8">
        {/* Navigation */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="sm" onClick={() => router.push('/projects')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            プロジェクト一覧
          </Button>
        </div>

        {/* Project Info */}
        <ProjectHeader project={project} />

        {/* Progress Section */}
        {projectProgress && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">進捗状況</h2>
            <ProjectProgressCard progress={projectProgress} />
          </div>
        )}

        {/* Goals Section */}
        <GoalList
          projectId={id}
          goals={goals}
          isLoading={goalsLoading}
          error={goalsError}
          onRefetch={refetchGoals}
          onNavigateToGoal={(goalId) => router.push(`/projects/${id}/goals/${goalId}`)}
        />
      </div>
    </div>
  )
}
