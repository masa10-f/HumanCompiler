'use client'

import { ProjectStatusDropdown } from './project-status-dropdown'
import type { Project } from '@/types/project'

interface ProjectHeaderProps {
  project: Project
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-bold">{project.title}</h1>
        <ProjectStatusDropdown project={project} />
      </div>
      <p className="text-gray-600 mb-4">
        {project.description || 'プロジェクトの説明がありません'}
      </p>
      <div className="text-sm text-gray-500">
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
