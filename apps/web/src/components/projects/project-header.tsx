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
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-bold">{project.title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/notes`}>
              <FileText className="h-4 w-4 mr-2" />
              Notes
            </Link>
          </Button>
          <ProjectStatusDropdown project={project} />
        </div>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        {project.description || 'プロジェクトの説明がありません'}
      </p>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}
        {project.updated_at !== project.created_at && (
          <span className="ml-4">
            更新日: {new Date(project.updated_at).toLocaleDateString('ja-JP')}
          </span>
        )}
      </div>
    </div>
  )
}
