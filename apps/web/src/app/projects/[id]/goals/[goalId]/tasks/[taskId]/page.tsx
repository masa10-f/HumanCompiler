'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useProject } from '@/hooks/use-project-query';
import { useGoal } from '@/hooks/use-goals-query';
import { useTask } from '@/hooks/use-tasks-query';
import { useAuth } from '@/hooks/use-auth';
import { AppHeader } from '@/components/layout/app-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContextNoteEditor } from '@/components/notes/context-note-editor';
import { useTaskNote } from '@/hooks/use-notes';
import {
  ArrowLeft,
  Loader2,
  FileText,
  Clock,
  History,
  CheckCircle2,
  Circle,
  Timer,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

const statusConfig = {
  pending: { label: 'Pending', icon: Circle, color: 'text-gray-500' },
  in_progress: { label: 'In Progress', icon: Timer, color: 'text-blue-500' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-green-500' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-red-500' },
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const goalId = params.goalId as string;
  const taskId = params.taskId as string;

  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: goal, isLoading: goalLoading } = useGoal(goalId);
  const { data: task, isLoading: taskLoading } = useTask(taskId);
  const { note, loading: noteLoading, saving, updateNote } = useTaskNote(taskId);

  const [activeTab, setActiveTab] = useState('notes');

  const isLoading = authLoading || projectLoading || goalLoading || taskLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AppHeader currentPage="projects" />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !task) {
    return null;
  }

  const statusInfo = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        {/* Navigation */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/goals/${goalId}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Goal
          </Button>
          <div className="text-sm text-gray-500 dark:text-gray-400">
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
            <span className="text-gray-700 dark:text-gray-300">{task.title}</span>
          </div>
        </div>

        {/* Task Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {task.title}
              </h1>
              {task.description && (
                <p className="text-gray-600 dark:text-gray-400">{task.description}</p>
              )}
            </div>
            <div className={`flex items-center gap-2 ${statusInfo.color}`}>
              <StatusIcon className="h-5 w-5" />
              <span className="font-medium">{statusInfo.label}</span>
            </div>
          </div>

          {/* Task metadata */}
          <div className="flex flex-wrap gap-6 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Estimate: {task.estimate_hours}h</span>
            </div>
            {task.due_date && (
              <div className="flex items-center gap-2">
                <span>Due: {format(new Date(task.due_date), 'yyyy-MM-dd')}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span>Priority: {task.priority}</span>
            </div>
            {task.work_type && (
              <div className="flex items-center gap-2">
                <span>Type: {task.work_type.replace('_', ' ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="notes" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="sessions" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Sessions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notes" className="mt-6">
            {noteLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : (
              <div>
                <ContextNoteEditor
                  content={note?.content || ''}
                  onUpdate={(content) => {
                    if (note) {
                      updateNote({ content });
                    }
                  }}
                  saving={saving}
                  placeholder="Write context notes for this task..."
                />
                {note && (
                  <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                    Last updated: {format(new Date(note.updated_at), 'yyyy-MM-dd HH:mm')}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                Work logs are displayed here. View the goal page for full log management.
              </p>
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/projects/${projectId}/goals/${goalId}`)}
                >
                  View in Goal Page
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sessions" className="mt-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                Work session history will be displayed here.
              </p>
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => router.push('/work-session-history')}
                >
                  View Session History
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
