'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useProject } from '@/hooks/use-project-query';
import { useAuth } from '@/hooks/use-auth';
import { AppHeader } from '@/components/layout/app-header';
import { NotePageLayout } from '@/components/notes/note-page-layout';
import { Loader2 } from 'lucide-react';

export default function ProjectNotesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: project, isLoading: projectLoading } = useProject(projectId);

  if (authLoading || projectLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AppHeader currentPage="projects" />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      <div className="container mx-auto py-8 px-4">
        <NotePageLayout
          entityType="project"
          entityId={projectId}
          entityTitle={project?.title || 'Project'}
          breadcrumb={
            <span>
              <Link href="/projects" className="hover:text-blue-600">Projects</Link>
              {' / '}
              <Link href={`/projects/${projectId}`} className="hover:text-blue-600">
                {project?.title || 'Project'}
              </Link>
              {' / '}
              <span className="text-gray-700 dark:text-gray-300">Notes</span>
            </span>
          }
          backUrl={`/projects/${projectId}`}
        />
      </div>
    </div>
  );
}
