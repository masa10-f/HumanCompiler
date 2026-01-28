'use client';

import { useParams } from 'next/navigation';
import { useProject } from '@/hooks/use-project-query';
import { useGoal } from '@/hooks/use-goals';
import { useAuth } from '@/hooks/use-auth';
import { AppHeader } from '@/components/layout/app-header';
import { NotePageLayout } from '@/components/notes/note-page-layout';
import { Loader2 } from 'lucide-react';

export default function GoalNotesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const goalId = params.goalId as string;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { goal, loading: goalLoading } = useGoal(goalId);

  if (authLoading || projectLoading || goalLoading) {
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
          entityType="goal"
          entityId={goalId}
          entityTitle={goal?.title || 'Goal'}
          breadcrumb={
            <span>
              <a href="/projects" className="hover:text-blue-600">Projects</a>
              {' / '}
              <a href={`/projects/${projectId}`} className="hover:text-blue-600">
                {project?.title || 'Project'}
              </a>
              {' / '}
              <a href={`/projects/${projectId}/goals/${goalId}`} className="hover:text-blue-600">
                {goal?.title || 'Goal'}
              </a>
              {' / '}
              <span className="text-gray-700 dark:text-gray-300">Notes</span>
            </span>
          }
          backUrl={`/projects/${projectId}/goals/${goalId}`}
        />
      </div>
    </div>
  );
}
