'use client'

import { memo, useState } from 'react'
import { useUpdateProject } from '@/hooks/use-project-query'
import { toast } from '@/hooks/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getProjectStatusIcon,
  getProjectStatusLabel,
  getAllProjectStatuses,
} from '@/constants/project-status'
import { ApiError } from '@/lib/errors'
import type { Project, ProjectStatus } from '@/types/project'

interface ProjectStatusDropdownProps {
  project: Project
}

export const ProjectStatusDropdown = memo(function ProjectStatusDropdown({
  project,
}: ProjectStatusDropdownProps) {
  const updateProjectMutation = useUpdateProject()
  const [isUpdating, setIsUpdating] = useState(false)

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    if (newStatus === project.status || isUpdating) return

    setIsUpdating(true)
    try {
      await updateProjectMutation.mutateAsync({
        id: project.id,
        data: { status: newStatus },
      })

      toast({
        title: 'ステータスを更新しました',
        description: `プロジェクトのステータスを「${getProjectStatusLabel(newStatus)}」に変更しました。`,
      })
    } catch (error) {
      let errorMessage = 'ステータスの更新に失敗しました。'
      let errorTitle = 'エラー'

      const errorStatus = error instanceof ApiError ? error.statusCode : undefined

      if (errorStatus === 404) {
        errorTitle = 'プロジェクトが見つかりません'
        errorMessage = '更新対象のプロジェクトが削除されている可能性があります。'
      } else if (errorStatus === 403) {
        errorTitle = '権限エラー'
        errorMessage = 'このプロジェクトを更新する権限がありません。'
      } else if (errorStatus === 422) {
        errorTitle = '入力エラー'
        errorMessage = '無効なステータス値です。ページを再読み込みしてください。'
      } else if (errorStatus && errorStatus >= 500) {
        errorTitle = 'サーバーエラー'
        errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。'
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        errorTitle = 'ネットワークエラー'
        errorMessage = 'インターネット接続を確認してください。'
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsUpdating(false)
    }
  }

  const currentStatus = project.status || 'pending'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          disabled={isUpdating}
        >
          {getProjectStatusIcon(currentStatus)}
          <span className="text-sm">{getProjectStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getAllProjectStatuses().map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() => handleStatusChange(status)}
            className={currentStatus === status ? 'bg-gray-100' : ''}
          >
            <div className="flex items-center gap-2">
              {getProjectStatusIcon(status)}
              <span>{getProjectStatusLabel(status)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
