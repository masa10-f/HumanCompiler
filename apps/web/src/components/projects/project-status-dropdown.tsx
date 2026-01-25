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
  PROJECT_STATUS_CONFIG,
} from '@/constants/project-status'
import { getStatusUpdateError } from '@/lib/status-error-handler'
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
      const { title, message } = getStatusUpdateError(error as Error, 'project')
      toast({
        title,
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsUpdating(false)
    }
  }

  const currentStatus = project.status || 'pending'
  const statusConfig = PROJECT_STATUS_CONFIG[currentStatus as keyof typeof PROJECT_STATUS_CONFIG] || PROJECT_STATUS_CONFIG.pending

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${statusConfig.bgClassName} ${statusConfig.className} hover:opacity-80 border border-current/20`}
          disabled={isUpdating}
        >
          {getProjectStatusIcon(currentStatus)}
          <span>{getProjectStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {getAllProjectStatuses().map((status) => {
          const config = PROJECT_STATUS_CONFIG[status]
          const isSelected = currentStatus === status
          return (
            <DropdownMenuItem
              key={status}
              onClick={() => handleStatusChange(status)}
              className={`${isSelected ? config.bgClassName : ''} ${config.className} cursor-pointer`}
            >
              <div className="flex items-center gap-2">
                {getProjectStatusIcon(status)}
                <span>{getProjectStatusLabel(status)}</span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
