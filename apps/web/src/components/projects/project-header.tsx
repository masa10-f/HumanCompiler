'use client'

import Link from 'next/link'
import { FileText } from 'lucide-react'
import { ProjectStatusDropdown } from './project-status-dropdown'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types/project'

interface ProjectHeaderProps {
  project: Project
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="min-w-0 text-3xl font-bold">{project.title}</h1>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/notes`}>
              <FileText className="h-4 w-4 mr-2" />
              Notes
            </Link>
          </Button>
          <ProjectStatusDropdown project={project} />
        </div>
      </div>
      <p className="mb-4 break-words text-gray-600 dark:text-gray-400">
        {project.description || 'プロジェクトの説明がありません'}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
        作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}
        {project.updated_at !== project.created_at && (
          <span>
            更新日: {new Date(project.updated_at).toLocaleDateString('ja-JP')}
          </span>
        )}
      </div>
    </div>
  )
}
